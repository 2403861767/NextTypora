package com.nexttyproa.service;

import com.google.common.util.concurrent.Striped;
import com.nexttyproa.dto.CreateNoteRequest;
import com.nexttyproa.dto.NoteDto;
import com.nexttyproa.dto.SaveNoteRequest;
import com.nexttyproa.exception.BadRequestException;
import com.nexttyproa.exception.ConflictException;
import com.nexttyproa.exception.NotFoundException;
import com.nexttyproa.exception.NoteConflictException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.concurrent.locks.Lock;

@Service
public class NoteService {

    private static final Logger log = LoggerFactory.getLogger(NoteService.class);
    private static final Logger audit = LoggerFactory.getLogger("com.nexttyproa.audit");

    private final WorkspaceService workspaceService;
    private final FileService fileService;
    private final IndexService indexService;
    private final Striped<Lock> pathLocks = Striped.lock(128);

    public NoteService(WorkspaceService workspaceService, FileService fileService, IndexService indexService) {
        this.workspaceService = workspaceService;
        this.fileService = fileService;
        this.indexService = indexService;
    }

    public NoteDto getNote(String relativePath) throws IOException {
        Path vaultRoot = requireVault();
        String normalized = FileService.normalizePathSeparators(relativePath);
        requireMarkdownPath(normalized);
        Path file = fileService.resolveSafe(vaultRoot, normalized);
        if (!fileService.exists(file)) {
            throw new NotFoundException("Note not found: " + relativePath);
        }
        FileService.ReadFileResult read = fileService.readFileWithEncoding(file);
        return toDto(vaultRoot, file, read);
    }

    public NoteDto saveNote(SaveNoteRequest request) throws IOException {
        Path vaultRoot = requireVault();
        String relativePath = FileService.normalizePathSeparators(request.getPath());
        requireMarkdownPath(relativePath);
        Lock lock = lockFor(relativePath);
        lock.lock();
        try {
            Path file = fileService.resolveSafe(vaultRoot, relativePath);
            String nextContent = request.getContent() == null ? "" : request.getContent();
            FileService.ReadFileResult currentRead = fileService.exists(file)
                    ? fileService.readFileWithEncoding(file)
                    : new FileService.ReadFileResult("", "UTF-8", false);

            // 对已存在的文件执行冲突检测（除非明确设置 force=true）
            if (fileService.exists(file)) {
                if (request.isForce()) {
                    // force=true 明确跳过冲突检测，允许强制覆盖
                } else if (request.getBaseHash() == null || request.getBaseHash().isBlank()) {
                    // 缺少 baseHash 视为潜在冲突，要求前端提供 baseHash 或使用 force=true
                    String currentHash = fileService.hashContent(currentRead.content());
                    throw new NoteConflictException(
                            "Cannot save without baseHash (file may have been modified externally)",
                            relativePath,
                            currentHash,
                            Files.getLastModifiedTime(file).toInstant()
                    );
                } else {
                    // 正常的 baseHash 冲突检测
                    String currentHash = fileService.hashContent(currentRead.content());
                    if (!currentHash.equals(request.getBaseHash())) {
                        throw new NoteConflictException(
                                "Note was modified outside NextTyproa",
                                relativePath,
                                currentHash,
                                Files.getLastModifiedTime(file).toInstant()
                        );
                    }
                }
            }

            String encoding = request.getEncoding() == null || request.getEncoding().isBlank()
                    ? currentRead.encoding()
                    : request.getEncoding();
            boolean hasBom = request.getHasBom() == null ? currentRead.hasBom() : request.getHasBom();
            boolean existed = fileService.exists(file);
            fileService.writeFileAtomic(file, nextContent, encoding, hasBom, existed);
            if (existed && request.isForce()) {
                audit.warn("Force-saved note, overwriting any external changes: {}", relativePath);
            }

            // 更新搜索索引（失败不影响保存操作，但记录错误日志）
            try {
                indexService.indexNote(vaultRoot, relativePath, nextContent);
            } catch (Exception e) {
                log.error("Failed to update search index after saving file: {} - Index may be inconsistent", relativePath, e);
            }

            return toDto(vaultRoot, file, new FileService.ReadFileResult(nextContent, fileService.normalizeEncodingName(encoding), hasBom));
        } finally {
            lock.unlock();
        }
    }

    public NoteDto createNote(CreateNoteRequest request) throws IOException {
        Path vaultRoot = requireVault();
        String relativePath = FileService.normalizePathSeparators(request.getPath());
        String content = request.getContent() == null ? "" : request.getContent();
        if (!fileService.isMarkdownPath(relativePath)) {
            if (hasExtension(relativePath)) {
                throw new BadRequestException("Only Markdown files are supported: " + relativePath);
            }
            relativePath = relativePath + ".md";
        }
        FileService.validateNewPath(relativePath);
        Path file = fileService.resolveSafe(vaultRoot, relativePath);
        if (fileService.exists(file)) {
            throw new ConflictException("Note already exists: " + relativePath);
        }
        fileService.writeFileAtomic(file, content);
        audit.info("Created note: {}", relativePath);

        // 更新搜索索引（失败不影响创建操作，但记录错误日志）
        try {
            indexService.indexNote(vaultRoot, relativePath, content);
        } catch (Exception e) {
            log.error("Failed to update search index after creating file: {} - Index may be inconsistent", relativePath, e);
        }

        return toDto(vaultRoot, file, new FileService.ReadFileResult(content, "UTF-8", false));
    }

    public void deleteNote(String relativePath) throws IOException {
        Path vaultRoot = requireVault();
        String normalized = FileService.normalizePathSeparators(relativePath);
        requireMarkdownPath(normalized);
        Path file = fileService.resolveSafe(vaultRoot, normalized);
        if (!fileService.exists(file)) {
            throw new NotFoundException("Note not found: " + relativePath);
        }
        fileService.deleteFile(file);
        fileService.deleteEmptyParents(vaultRoot, file);
        audit.info("Deleted note: {}", normalized);
        indexService.removeNote(normalized);
    }

    private NoteDto toDto(Path vaultRoot, Path file, FileService.ReadFileResult read) throws IOException {
        String relativePath = fileService.relativePathString(vaultRoot, file);
        String content = read.content();
        NoteDto dto = new NoteDto();
        dto.setPath(relativePath);
        dto.setTitle(FileService.extractTitle(relativePath, content));
        dto.setContent(content);
        dto.setTags("");
        dto.setUpdatedAt(fileService.exists(file) ? Files.getLastModifiedTime(file).toInstant() : Instant.now());
        dto.setContentHash(fileService.hashContent(content));
        dto.setEncoding(read.encoding());
        dto.setHasBom(read.hasBom());
        return dto;
    }

    private Path requireVault() {
        Path vaultRoot = workspaceService.getVaultRoot();
        if (vaultRoot == null) {
            throw new BadRequestException("Workspace not configured. Set a vault path first.");
        }
        return vaultRoot;
    }

    private boolean hasExtension(String path) {
        String fileName = path.substring(path.lastIndexOf('/') + 1);
        int dotIndex = fileName.lastIndexOf('.');
        return dotIndex > 0 && dotIndex < fileName.length() - 1;
    }

    private void requireMarkdownPath(String path) {
        if (!fileService.isMarkdownPath(path)) {
            throw new BadRequestException("Only Markdown files are supported: " + path);
        }
    }

    private Lock lockFor(String relativePath) {
        return pathLocks.get(relativePath);
    }
}
