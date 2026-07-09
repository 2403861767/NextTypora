package com.nexttyproa.service;

import com.nexttyproa.config.AppProperties;
import com.nexttyproa.dto.TreeNodeDto;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

@Service
public class WorkspaceService {

    private final AppProperties appProperties;
    private final FileService fileService;
    private final IndexService indexService;

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

    public List<TreeNodeDto> buildTree() throws IOException {
        Path vaultRoot = getVaultRoot();
        if (vaultRoot == null || !Files.exists(vaultRoot)) {
            return List.of();
        }
        return buildTreeNode(vaultRoot, vaultRoot).getChildren();
    }

    private TreeNodeDto buildTreeNode(Path vaultRoot, Path current) throws IOException {
        String relative = vaultRoot.equals(current) ? "" : fileService.relativePathString(vaultRoot, current);
        String name = vaultRoot.equals(current)
                ? (vaultRoot.getFileName() != null ? vaultRoot.getFileName().toString() : vaultRoot.toString())
                : current.getFileName().toString();
        boolean isDir = Files.isDirectory(current);

        TreeNodeDto node = new TreeNodeDto(name, relative, isDir);
        if (!isDir) {
            return node;
        }

        List<Path> entries = new ArrayList<>();
        try (Stream<Path> stream = Files.list(current)) {
            stream.filter(p -> {
                String fileName = p.getFileName().toString();
                boolean directory = Files.isDirectory(p);
                return !fileName.startsWith(".")
                        && !(directory && fileName.endsWith(".assets"));
            }).forEach(entries::add);
        }

        entries.sort(Comparator
                .comparing((Path p) -> !Files.isDirectory(p))
                .thenComparing(p -> p.getFileName().toString().toLowerCase()));

        for (Path entry : entries) {
            node.getChildren().add(buildTreeNode(vaultRoot, entry));
        }
        return node;
    }
}
