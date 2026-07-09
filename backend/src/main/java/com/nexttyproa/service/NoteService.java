package com.nexttyproa.service;

import com.nexttyproa.dto.CreateNoteRequest;
import com.nexttyproa.dto.NoteDto;
import com.nexttyproa.dto.SaveNoteRequest;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class NoteService {

    private final WorkspaceService workspaceService;
    private final FileService fileService;
    private final IndexService indexService;
    private final Map<String, Object> pathLocks = new ConcurrentHashMap<>();

    public NoteService(WorkspaceService workspaceService, FileService fileService, IndexService indexService) {
        this.workspaceService = workspaceService;
        this.fileService = fileService;
        this.indexService = indexService;
    }

    public NoteDto getNote(String relativePath) throws IOException {
        Path vaultRoot = requireVault();
        String normalized = normalizePath(relativePath);
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
        String relativePath = normalizePath(request.getPath());
        requireMarkdownPath(relativePath);
        synchronized (lockFor(relativePath)) {
            Path file = fileService.resolveSafe(vaultRoot, relativePath);
            String nextContent = request.getContent() == null ? "" : request.getContent();
            FileService.ReadFileResult currentRead = fileService.exists(file)
                    ? fileService.readFileWithEncoding(file)
                    : new FileService.ReadFileResult("", "UTF-8", false);

            if (fileService.exists(file) && !request.isForce() && request.getBaseHash() != null && !request.getBaseHash().isBlank()) {
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

            String encoding = request.getEncoding() == null || request.getEncoding().isBlank()
                    ? currentRead.encoding()
                    : request.getEncoding();
            boolean hasBom = request.getHasBom() == null ? currentRead.hasBom() : request.getHasBom();
            fileService.writeFileAtomic(file, nextContent, encoding, hasBom, fileService.exists(file));
            indexService.indexNote(vaultRoot, relativePath, nextContent);

            return toDto(vaultRoot, file, new FileService.ReadFileResult(nextContent, fileService.normalizeEncodingName(encoding), hasBom));
        }
    }

    public NoteDto createNote(CreateNoteRequest request) throws IOException {
        Path vaultRoot = requireVault();
        String relativePath = normalizePath(request.getPath());
        String content = request.getContent() == null ? "" : request.getContent();
        if (!fileService.isMarkdownPath(relativePath)) {
            if (hasExtension(relativePath)) {
                throw new BadRequestException("Only Markdown files are supported: " + relativePath);
            }
            relativePath = relativePath + ".md";
        }
        Path file = fileService.resolveSafe(vaultRoot, relativePath);
        if (fileService.exists(file)) {
            throw new ConflictException("Note already exists: " + relativePath);
        }
        fileService.writeFileAtomic(file, content);
        indexService.indexNote(vaultRoot, relativePath, content);

        return toDto(vaultRoot, file, new FileService.ReadFileResult(content, "UTF-8", false));
    }

    public void deleteNote(String relativePath) throws IOException {
        Path vaultRoot = requireVault();
        String normalized = normalizePath(relativePath);
        requireMarkdownPath(normalized);
        Path file = fileService.resolveSafe(vaultRoot, normalized);
        if (!fileService.exists(file)) {
            throw new NotFoundException("Note not found: " + relativePath);
        }
        fileService.deleteFile(file);
        fileService.deleteEmptyParents(vaultRoot, file);
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

    private String normalizePath(String path) {
        return path.replace('\\', '/').replaceAll("^/+", "");
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

    private Object lockFor(String relativePath) {
        return pathLocks.computeIfAbsent(relativePath, ignored -> new Object());
    }

    public static class NotFoundException extends RuntimeException {
        public NotFoundException(String message) {
            super(message);
        }
    }

    public static class ConflictException extends RuntimeException {
        public ConflictException(String message) {
            super(message);
        }
    }

    public static class BadRequestException extends RuntimeException {
        public BadRequestException(String message) {
            super(message);
        }
    }

    public static class NoteConflictException extends RuntimeException {
        private final String path;
        private final String currentHash;
        private final Instant currentUpdatedAt;

        public NoteConflictException(String message, String path, String currentHash, Instant currentUpdatedAt) {
            super(message);
            this.path = path;
            this.currentHash = currentHash;
            this.currentUpdatedAt = currentUpdatedAt;
        }

        public String getPath() {
            return path;
        }

        public String getCurrentHash() {
            return currentHash;
        }

        public Instant getCurrentUpdatedAt() {
            return currentUpdatedAt;
        }
    }
}
