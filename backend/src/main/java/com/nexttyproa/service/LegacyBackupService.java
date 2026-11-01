package com.nexttyproa.service;

import com.nexttyproa.dto.LegacyBackupScanDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 找出工作区里 1.0.3 之前留下的 {@code .nexttyproa-backups/} 目录。
 *
 * <p>保存时备份已经移除（见 {@code docs/adr/0001-no-save-time-backups.md}），但老工作区里那些
 * 目录不会自己消失，而且我们刻意不自动删除用户金库里的东西。这个服务只负责**报告**，真正的删除
 * 由渲染进程交给 Electron 的 {@code shell.trashItem} 走系统回收站，因此是可撤销的。
 */
@Service
public class LegacyBackupService {

    static final String BACKUP_DIR_NAME = ".nexttyproa-backups";

    private static final Logger log = LoggerFactory.getLogger(LegacyBackupService.class);

    private final WorkspaceService workspaceService;

    public LegacyBackupService(WorkspaceService workspaceService) {
        this.workspaceService = workspaceService;
    }

    /** 只扫当前工作区，不碰用户别的磁盘位置。没有打开工作区时返回空结果而不是报错。 */
    public LegacyBackupScanDto scan() throws IOException {
        Path vaultRoot = workspaceService.getVaultRoot();
        if (vaultRoot == null || !Files.isDirectory(vaultRoot)) {
            return new LegacyBackupScanDto(List.of(), 0L);
        }

        List<LegacyBackupScanDto.Entry> found = new ArrayList<>();
        Files.walkFileTree(vaultRoot, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                // 重解析点（junction / 符号链接）可能指向工作区外，不跟进去，也不报告
                if (attrs.isOther() || attrs.isSymbolicLink()) {
                    return FileVisitResult.SKIP_SUBTREE;
                }
                if (dir.equals(vaultRoot) || !BACKUP_DIR_NAME.equals(dir.getFileName().toString())) {
                    return FileVisitResult.CONTINUE;
                }
                found.add(measure(vaultRoot, dir));
                // 备份目录内部不需要再往下走
                return FileVisitResult.SKIP_SUBTREE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException e) {
                log.warn("Skipped unreadable path while scanning for legacy backups: {}", file, e);
                return FileVisitResult.CONTINUE;
            }
        });

        found.sort(Comparator.comparing(LegacyBackupScanDto.Entry::getPath));
        long totalBytes = found.stream().mapToLong(LegacyBackupScanDto.Entry::getBytes).sum();
        return new LegacyBackupScanDto(List.copyOf(found), totalBytes);
    }

    /** 统计一个备份目录的文件数与总字节数。单个文件读不到时跳过，不让整次扫描失败。 */
    private static LegacyBackupScanDto.Entry measure(Path vaultRoot, Path backupDir) {
        long bytes = 0L;
        int fileCount = 0;
        try (var entries = Files.walk(backupDir)) {
            for (Path entry : (Iterable<Path>) entries::iterator) {
                if (!Files.isRegularFile(entry)) {
                    continue;
                }
                fileCount += 1;
                try {
                    bytes += Files.size(entry);
                } catch (IOException e) {
                    log.warn("Could not size backup file {}", entry, e);
                }
            }
        } catch (IOException e) {
            log.warn("Could not walk backup directory {}", backupDir, e);
        }
        String relative = FileService.normalizePathSeparators(vaultRoot.relativize(backupDir).toString());
        return new LegacyBackupScanDto.Entry(relative, fileCount, bytes);
    }
}
