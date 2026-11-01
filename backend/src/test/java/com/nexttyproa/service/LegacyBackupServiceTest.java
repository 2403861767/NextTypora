package com.nexttyproa.service;

import com.nexttyproa.config.AppProperties;
import com.nexttyproa.dto.LegacyBackupScanDto;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LegacyBackupServiceTest {

    private LegacyBackupService serviceFor(Path vaultRoot) {
        AppProperties appProperties = new AppProperties();
        if (vaultRoot != null) {
            appProperties.setVaultPath(vaultRoot.toString());
        }
        FileService fileService = new FileService();
        WorkspaceService workspaceService =
                new WorkspaceService(appProperties, fileService, new IndexService(fileService));
        return new LegacyBackupService(workspaceService);
    }

    private static void writeBackup(Path dir, String name, String content) throws IOException {
        Files.createDirectories(dir);
        Files.writeString(dir.resolve(name), content, StandardCharsets.UTF_8);
    }

    @Test
    void reportsEveryBackupDirectoryWithItsFileCountAndSize(@TempDir Path vaultRoot) throws Exception {
        writeBackup(vaultRoot.resolve("项目2026/.nexttyproa-backups"), "需求.md.2026-09-25T000000Z.bak", "12345");
        writeBackup(vaultRoot.resolve("项目2026/.nexttyproa-backups"), "需求.md.2026-09-26T000000Z.bak", "678");
        writeBackup(vaultRoot.resolve("日记/深层/.nexttyproa-backups"), "a.md.2026-09-25T000000Z.bak", "x");
        Files.writeString(vaultRoot.resolve("项目2026/需求.md"), "正文");

        LegacyBackupScanDto result = serviceFor(vaultRoot).scan();

        assertEquals(List.of("日记/深层/.nexttyproa-backups", "项目2026/.nexttyproa-backups"),
                result.getDirectories().stream().map(LegacyBackupScanDto.Entry::getPath).toList());
        // 路径用正斜杠，可以直接交给 file:trashItem
        assertTrue(result.getDirectories().stream().noneMatch(entry -> entry.getPath().contains("\\")));
        assertEquals(2, entryFor(result, "项目2026/.nexttyproa-backups").getFileCount());
        assertEquals(8, entryFor(result, "项目2026/.nexttyproa-backups").getBytes());
        assertEquals(1, entryFor(result, "日记/深层/.nexttyproa-backups").getFileCount());
        assertEquals(9, result.getTotalBytes());
    }

    @Test
    void reportsNothingWhenTheWorkspaceIsClean(@TempDir Path vaultRoot) throws Exception {
        Files.writeString(vaultRoot.resolve("note.md"), "正文");
        Files.createDirectories(vaultRoot.resolve(".assets"));

        LegacyBackupScanDto result = serviceFor(vaultRoot).scan();

        assertEquals(List.of(), result.getDirectories());
        assertEquals(0, result.getTotalBytes());
    }

    // 没有打开工作区时返回空结果，而不是抛异常——设置面板里点"扫描"不该因此报错
    @Test
    void returnsAnEmptyResultWithoutAWorkspace() throws Exception {
        LegacyBackupScanDto result = serviceFor(null).scan();

        assertEquals(List.of(), result.getDirectories());
        assertEquals(0, result.getTotalBytes());
    }

    @Test
    void doesNotDescendIntoABackupDirectoryLookingForNestedOnes(@TempDir Path vaultRoot) throws Exception {
        Path outer = vaultRoot.resolve("a/.nexttyproa-backups");
        writeBackup(outer, "a.md.2026-09-25T000000Z.bak", "1");
        writeBackup(outer.resolve("嵌套/.nexttyproa-backups"), "b.md.2026-09-25T000000Z.bak", "22");

        LegacyBackupScanDto result = serviceFor(vaultRoot).scan();

        assertEquals(List.of("a/.nexttyproa-backups"),
                result.getDirectories().stream().map(LegacyBackupScanDto.Entry::getPath).toList());
        // 嵌套的那个不单独报告，但它的字节数算在外层里（整个目录会被一起移走）
        assertEquals(3, result.getTotalBytes());
    }

    // 扫描只报告、不删除：这个服务永远不该碰用户的文件
    @Test
    void scanningNeverRemovesAnything(@TempDir Path vaultRoot) throws Exception {
        Path backupDir = vaultRoot.resolve(".nexttyproa-backups");
        writeBackup(backupDir, "note.md.2026-09-25T000000Z.bak", "old");

        serviceFor(vaultRoot).scan();

        assertTrue(Files.isDirectory(backupDir));
        assertEquals("old", Files.readString(backupDir.resolve("note.md.2026-09-25T000000Z.bak")));
    }

    private static LegacyBackupScanDto.Entry entryFor(LegacyBackupScanDto result, String path) {
        return result.getDirectories().stream()
                .filter(entry -> entry.getPath().equals(path))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no entry for " + path));
    }
}
