package com.nexttyproa.service;

import com.nexttyproa.dto.CreateFolderRequest;
import com.nexttyproa.dto.FileOperationDto;
import com.nexttyproa.dto.MovePathRequest;
import com.nexttyproa.dto.RenamePathRequest;
import com.nexttyproa.dto.TreeNodeDto;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.List;

@Service
public class FileSystemService {

    private final WorkspaceService workspaceService;
    private final FileService fileService;
    private final IndexService indexService;

    public FileSystemService(WorkspaceService workspaceService, FileService fileService, IndexService indexService) {
        this.workspaceService = workspaceService;
        this.fileService = fileService;
        this.indexService = indexService;
    }

    public FileOperationDto createFolder(CreateFolderRequest request) throws IOException {
        Path vaultRoot = requireVault();
        String normalized = normalizePath(request.getPath());
        Path folder = resolveSafe(vaultRoot, normalized);
        rejectRoot(vaultRoot, folder, "Cannot create the vault root");
        if (Files.exists(folder, LinkOption.NOFOLLOW_LINKS)) {
            throw new ConflictException("Path already exists: " + normalized);
        }
        Files.createDirectories(folder);
        return new FileOperationDto(fileService.relativePathString(vaultRoot, folder), true);
    }

    public FileOperationDto deletePath(String path) throws IOException {
        Path vaultRoot = requireVault();
        String normalized = normalizePath(path);
        Path target = resolveSafe(vaultRoot, normalized);
        rejectRoot(vaultRoot, target, "Cannot delete the vault root");
        if (!Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new NotFoundException("Path not found: " + path);
        }

        boolean directory = Files.isDirectory(target, LinkOption.NOFOLLOW_LINKS);
        if (directory) {
            deleteDirectory(target);
            indexService.reindexVault(vaultRoot);
        } else {
            Files.delete(target);
            if (fileService.isMarkdownPath(normalized)) {
                indexService.removeNote(normalized);
            }
        }
        return new FileOperationDto(normalized, directory);
    }

    public FileOperationDto renamePath(RenamePathRequest request) throws IOException {
        Path vaultRoot = requireVault();
        String normalized = normalizePath(request.getPath());
        String newName = validateRenameTarget(request.getNewName());
        Path source = resolveSafe(vaultRoot, normalized);
        rejectRoot(vaultRoot, source, "Cannot rename the vault root");
        if (!Files.exists(source, LinkOption.NOFOLLOW_LINKS)) {
            throw new NotFoundException("Path not found: " + request.getPath());
        }

        Path target = source.resolveSibling(newName).normalize();
        if (!target.startsWith(vaultRoot)) {
            throw new BadRequestException("Path traversal detected: " + newName);
        }
        if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new ConflictException("Path already exists: " + fileService.relativePathString(vaultRoot, target));
        }

        boolean directory = Files.isDirectory(source, LinkOption.NOFOLLOW_LINKS);
        Files.move(source, target);
        String newRelativePath = fileService.relativePathString(vaultRoot, target);
        if (directory) {
            indexService.reindexVault(vaultRoot);
        } else {
            indexService.syncRenamedFile(vaultRoot, normalized, newRelativePath);
        }
        return new FileOperationDto(newRelativePath, directory);
    }

    public FileOperationDto movePath(MovePathRequest request) throws IOException {
        Path vaultRoot = requireVault();
        String normalized = normalizePath(request.getPath());
        String normalizedTargetFolder = normalizePath(request.getTargetFolder());
        Path source = resolveSafe(vaultRoot, normalized);
        Path targetFolder = resolveSafe(vaultRoot, normalizedTargetFolder);
        rejectRoot(vaultRoot, source, "Cannot move the vault root");

        if (!Files.exists(source, LinkOption.NOFOLLOW_LINKS)) {
            throw new NotFoundException("Path not found: " + request.getPath());
        }
        if (!Files.exists(targetFolder, LinkOption.NOFOLLOW_LINKS)) {
            throw new NotFoundException("Target folder not found: " + request.getTargetFolder());
        }
        if (!Files.isDirectory(targetFolder, LinkOption.NOFOLLOW_LINKS)) {
            throw new BadRequestException("Target folder is not a directory: " + request.getTargetFolder());
        }

        Path target = targetFolder.resolve(source.getFileName()).normalize();
        if (!target.startsWith(vaultRoot)) {
            throw new BadRequestException("Path traversal detected: " + request.getTargetFolder());
        }
        if (source.equals(target)) {
            throw new BadRequestException("Cannot move a path to itself");
        }

        boolean directory = Files.isDirectory(source, LinkOption.NOFOLLOW_LINKS);
        if (directory && targetFolder.startsWith(source)) {
            throw new BadRequestException("Cannot move a directory into itself or its child");
        }
        if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new ConflictException("Path already exists: " + fileService.relativePathString(vaultRoot, target));
        }

        Files.move(source, target);
        String newRelativePath = fileService.relativePathString(vaultRoot, target);
        if (directory) {
            indexService.reindexVault(vaultRoot);
        } else {
            indexService.syncRenamedFile(vaultRoot, normalized, newRelativePath);
        }
        return new FileOperationDto(newRelativePath, directory);
    }

    public List<TreeNodeDto> refreshTree() throws IOException {
        Path vaultRoot = requireVault();
        indexService.reindexVault(vaultRoot);
        return workspaceService.buildTree();
    }

    private void deleteDirectory(Path directory) throws IOException {
        Files.walkFileTree(directory, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                Files.delete(file);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult postVisitDirectory(Path dir, IOException exc) throws IOException {
                if (exc != null) {
                    throw exc;
                }
                Files.delete(dir);
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private Path requireVault() {
        Path vaultRoot = workspaceService.getVaultRoot();
        if (vaultRoot == null) {
            throw new BadRequestException("Workspace not configured. Set a vault path first.");
        }
        return vaultRoot;
    }

    private Path resolveSafe(Path vaultRoot, String relativePath) throws IOException {
        try {
            return fileService.resolveSafe(vaultRoot, relativePath);
        } catch (SecurityException e) {
            throw new BadRequestException(e.getMessage());
        }
    }

    private void rejectRoot(Path vaultRoot, Path target, String message) {
        if (vaultRoot.equals(target)) {
            throw new BadRequestException(message);
        }
    }

    private String normalizePath(String path) {
        return FileService.normalizePathSeparators(path);
    }

    private String validateRenameTarget(String newName) {
        if (newName == null || newName.isBlank()) {
            throw new BadRequestException("New name must not be empty");
        }
        if (".".equals(newName) || "..".equals(newName)) {
            throw new BadRequestException("New name must not be . or ..");
        }
        if (newName.contains("/") || newName.contains("\\")) {
            throw new BadRequestException("New name must not contain path separators");
        }
        return newName;
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
}
