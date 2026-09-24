package com.nexttyproa.service;

import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.net.MalformedURLException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;

@Service
public class AssetService {

    private static final Set<String> ALLOWED_EXTENSIONS = Set.of(
            ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"
    );

    private final WorkspaceService workspaceService;
    private final FileService fileService;

    public AssetService(WorkspaceService workspaceService, FileService fileService) {
        this.workspaceService = workspaceService;
        this.fileService = fileService;
    }

    public UploadResult uploadAsset(String notePath, MultipartFile file) throws IOException {
        Path vaultRoot = requireVault();
        String normalizedNote = normalizePath(notePath);
        Path noteFile = fileService.resolveSafe(vaultRoot, normalizedNote);
        if (!fileService.exists(noteFile)) {
            throw new NotFoundException("Note not found: " + notePath);
        }

        String originalName = file.getOriginalFilename();
        if (originalName == null || originalName.isBlank()) {
            originalName = "image.png";
        }
        String safeName = generateAssetFileName(originalName);
        String assetDir = assetDirForNote(normalizedNote);
        String relativeAssetPath = assetDir + "/" + safeName;

        Path target = fileService.resolveSafe(vaultRoot, relativeAssetPath);
        Files.createDirectories(target.getParent());
        file.transferTo(target.toFile());

        String markdownRef = markdownRefForNote(normalizedNote, relativeAssetPath);
        return new UploadResult(relativeAssetPath, markdownRef);
    }

    public Resource readAsset(String relativePath) throws IOException {
        Path vaultRoot = requireVault();
        String normalized = normalizePath(relativePath);
        Path file = fileService.resolveSafe(vaultRoot, normalized);
        if (!fileService.exists(file) || !Files.isRegularFile(file)) {
            throw new NotFoundException("Asset not found: " + relativePath);
        }
        try {
            Resource resource = new UrlResource(file.toUri());
            if (!resource.exists() || !resource.isReadable()) {
                throw new NotFoundException("Asset not readable: " + relativePath);
            }
            return resource;
        } catch (MalformedURLException e) {
            throw new NotFoundException("Asset not found: " + relativePath);
        }
    }

    public MediaType mediaTypeFor(Path file) throws IOException {
        String probe = Files.probeContentType(file);
        if (probe != null) {
            return MediaType.parseMediaType(probe);
        }
        String name = file.getFileName().toString().toLowerCase(Locale.ROOT);
        if (name.endsWith(".png")) return MediaType.IMAGE_PNG;
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return MediaType.IMAGE_JPEG;
        if (name.endsWith(".gif")) return MediaType.IMAGE_GIF;
        if (name.endsWith(".webp")) return MediaType.parseMediaType("image/webp");
        if (name.endsWith(".svg")) return MediaType.parseMediaType("image/svg+xml");
        return MediaType.APPLICATION_OCTET_STREAM;
    }

    public static String assetDirForNote(String notePath) {
        String normalized = FileService.normalizePathSeparators(notePath);
        int dot = normalized.lastIndexOf('.');
        String base = dot > 0 ? normalized.substring(0, dot) : normalized;
        return base + ".assets";
    }

    public static String markdownRefForNote(String notePath, String relativeAssetPath) {
        String normalizedNote = FileService.normalizePathSeparators(notePath);
        String normalizedAsset = FileService.normalizePathSeparators(relativeAssetPath);
        int lastSlash = normalizedNote.lastIndexOf('/');
        if (lastSlash >= 0) {
            String noteDir = normalizedNote.substring(0, lastSlash + 1);
            if (normalizedAsset.startsWith(noteDir)) {
                return normalizedAsset.substring(noteDir.length());
            }
        }
        return normalizedAsset;
    }

    static String generateAssetFileName(String originalName) {
        String ext = extractExtension(originalName);
        int random = ThreadLocalRandom.current().nextInt(100000, 1_000_000);
        return System.currentTimeMillis() + "-" + random + ext;
    }

    private static String extractExtension(String originalName) {
        if (originalName == null || originalName.isBlank()) {
            return ".png";
        }
        String cleaned = FileService.normalizePathSeparators(originalName);
        int slash = cleaned.lastIndexOf('/');
        if (slash >= 0) {
            cleaned = cleaned.substring(slash + 1);
        }
        int dot = cleaned.lastIndexOf('.');
        if (dot <= 0 || dot == cleaned.length() - 1) {
            return ".png";
        }
        String ext = cleaned.substring(dot).toLowerCase(Locale.ROOT);
        boolean allowed = ALLOWED_EXTENSIONS.stream().anyMatch(ext::endsWith);
        return allowed ? ext : ".png";
    }

    private Path requireVault() {
        Path vaultRoot = workspaceService.getVaultRoot();
        if (vaultRoot == null) {
            throw new BadRequestException("Workspace not configured. Set a vault path first.");
        }
        return vaultRoot;
    }

    private String normalizePath(String path) {
        return FileService.normalizePathSeparators(path);
    }

    public record UploadResult(String path, String markdownRef) {}

    public static class NotFoundException extends RuntimeException {
        public NotFoundException(String message) {
            super(message);
        }
    }

    public static class BadRequestException extends RuntimeException {
        public BadRequestException(String message) {
            super(message);
        }
    }
}
