package com.nexttyproa.service;

import com.nexttyproa.config.AppProperties;
import com.nexttyproa.dto.TreeNodeDto;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.attribute.FileTime;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

@Service
public class WorkspaceService {

    private static final Duration RACY_MTIME_WINDOW = Duration.ofSeconds(2);

    private final AppProperties appProperties;
    private final FileService fileService;
    private final IndexService indexService;
    private Map<Path, CachedListing> listingCache = new HashMap<>();

    public WorkspaceService(AppProperties appProperties, FileService fileService, IndexService indexService) {
        this.appProperties = appProperties;
        this.fileService = fileService;
        this.indexService = indexService;
    }

    public Path getVaultRoot() {
        String vaultPath = appProperties.getVaultPath();
        if (vaultPath == null || vaultPath.isBlank()) {
            return null;
        }
        return Paths.get(vaultPath).normalize().toAbsolutePath();
    }

    public void setVaultPath(String path) throws IOException {
        Path vaultRoot = Paths.get(path).normalize().toAbsolutePath();
        Files.createDirectories(vaultRoot);
        Path current = getVaultRoot();
        appProperties.setVaultPath(vaultRoot.toString());
        if (current != null && current.equals(vaultRoot)) {
            return;
        }
        indexService.reindexVault(vaultRoot);
    }

    public String getVaultPathString() {
        Path root = getVaultRoot();
        return root == null ? "" : root.toString();
    }

    /**
     * Folder listings are cached and reused while the folder's mtime is unchanged. Adding, removing or
     * renaming an entry bumps its parent folder's mtime, so this also catches changes made outside the
     * app; an unchanged folder then costs one stat instead of a listing plus a stat per entry.
     */
    public synchronized List<TreeNodeDto> buildTree() throws IOException {
        Path vaultRoot = getVaultRoot();
        if (vaultRoot == null || !Files.exists(vaultRoot)) {
            listingCache = new HashMap<>();
            return List.of();
        }
        // Only folders visited in this build are carried over, so deleted folders drop out of the cache.
        Map<Path, CachedListing> next = new HashMap<>();
        List<TreeNodeDto> children = buildTreeNode(vaultRoot, vaultRoot, true, next).getChildren();
        listingCache = next;
        return children;
    }

    private TreeNodeDto buildTreeNode(Path vaultRoot, Path current, boolean isDir, Map<Path, CachedListing> next) throws IOException {
        String relative = vaultRoot.equals(current) ? "" : fileService.relativePathString(vaultRoot, current);
        String name = vaultRoot.equals(current)
                ? (vaultRoot.getFileName() != null ? vaultRoot.getFileName().toString() : vaultRoot.toString())
                : current.getFileName().toString();

        TreeNodeDto node = new TreeNodeDto(name, relative, isDir);
        if (!isDir) {
            return node;
        }

        for (TreeEntry entry : listEntries(current, next)) {
            node.getChildren().add(buildTreeNode(vaultRoot, entry.path(), entry.directory(), next));
        }
        return node;
    }

    private List<TreeEntry> listEntries(Path dir, Map<Path, CachedListing> next) throws IOException {
        // Read the mtime before listing, so a change made during the listing yields a newer mtime.
        FileTime modified = Files.getLastModifiedTime(dir);
        CachedListing cached = listingCache.get(dir);
        if (cached != null && cached.reusable() && cached.modified().equals(modified)) {
            next.put(dir, cached);
            return cached.entries();
        }

        List<TreeEntry> entries = new ArrayList<>();
        try (Stream<Path> stream = Files.list(dir)) {
            stream.forEach(p -> {
                String fileName = p.getFileName().toString();
                if (fileName.startsWith(".")) {
                    return;
                }
                boolean directory = Files.isDirectory(p);
                if (!(directory && fileName.endsWith(".assets"))) {
                    entries.add(new TreeEntry(p, fileName, directory));
                }
            });
        }

        entries.sort(Comparator
                .comparing((TreeEntry e) -> !e.directory())
                .thenComparing(e -> e.name().toLowerCase()));

        // A second change within the same timestamp tick would leave the mtime unchanged, so only
        // trust listings of folders that have been quiet for a while (the "racy git" problem).
        boolean reusable = modified.toInstant().isBefore(Instant.now().minus(RACY_MTIME_WINDOW));
        next.put(dir, new CachedListing(modified, reusable, List.copyOf(entries)));
        return entries;
    }

    private record TreeEntry(Path path, String name, boolean directory) {
    }

    private record CachedListing(FileTime modified, boolean reusable, List<TreeEntry> entries) {
    }
}
