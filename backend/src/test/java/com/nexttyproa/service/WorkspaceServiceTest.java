package com.nexttyproa.service;

import com.nexttyproa.config.AppProperties;
import com.nexttyproa.dto.TreeNodeDto;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class WorkspaceServiceTest {

    private final FileService fileService = new FileService();

    @Test
    void buildsSortedTreeSkippingHiddenAndAssets(@TempDir Path vaultRoot) throws Exception {
        Files.writeString(vaultRoot.resolve("b.md"), "b");
        Files.writeString(vaultRoot.resolve("A.md"), "a");
        Files.writeString(vaultRoot.resolve(".hidden.md"), "h");
        Files.createDirectories(vaultRoot.resolve(".git"));
        Files.createDirectories(vaultRoot.resolve("x.assets"));
        Files.createDirectories(vaultRoot.resolve("zeta"));
        Files.writeString(Files.createDirectories(vaultRoot.resolve("Alpha")).resolve("n.md"), "n");

        List<TreeNodeDto> tree = workspaceService(vaultRoot).buildTree();

        assertEquals(List.of("Alpha", "zeta", "A.md", "b.md"), names(tree));
        assertEquals(List.of("Alpha/n.md"), tree.get(0).getChildren().stream().map(TreeNodeDto::getPath).toList());
        assertEquals(true, tree.get(0).isDirectory());
        assertEquals(false, tree.get(2).isDirectory());
    }

    @Test
    void reusesListingWhileDirectoryMtimeUnchanged(@TempDir Path vaultRoot) throws Exception {
        Path notes = Files.createDirectories(vaultRoot.resolve("notes"));
        Files.writeString(notes.resolve("a.md"), "a");
        FileTime old = FileTime.from(Instant.now().minus(1, ChronoUnit.HOURS));
        Files.setLastModifiedTime(notes, old);
        Files.setLastModifiedTime(vaultRoot, old);
        WorkspaceService service = workspaceService(vaultRoot);
        assertEquals(List.of("a.md"), names(service.buildTree().get(0).getChildren()));

        Files.writeString(notes.resolve("b.md"), "b");
        Files.setLastModifiedTime(notes, old);

        // The folder looks untouched, so its cached listing is served without re-listing it.
        assertEquals(List.of("a.md"), names(service.buildTree().get(0).getChildren()));
    }

    @Test
    void picksUpExternalChangesWhenMtimeChanges(@TempDir Path vaultRoot) throws Exception {
        Path notes = Files.createDirectories(vaultRoot.resolve("notes"));
        Files.writeString(notes.resolve("a.md"), "a");
        FileTime old = FileTime.from(Instant.now().minus(1, ChronoUnit.HOURS));
        Files.setLastModifiedTime(notes, old);
        Files.setLastModifiedTime(vaultRoot, old);
        WorkspaceService service = workspaceService(vaultRoot);
        assertEquals(List.of("notes"), names(service.buildTree()));

        Files.writeString(notes.resolve("b.md"), "b");
        Files.delete(notes.resolve("a.md"));
        Files.writeString(vaultRoot.resolve("root.md"), "r");

        List<TreeNodeDto> tree = service.buildTree();
        assertEquals(List.of("notes", "root.md"), names(tree));
        assertEquals(List.of("b.md"), names(tree.get(0).getChildren()));
    }

    private WorkspaceService workspaceService(Path vaultRoot) {
        AppProperties appProperties = new AppProperties();
        appProperties.setVaultPath(vaultRoot.toString());
        return new WorkspaceService(appProperties, fileService, new IndexService(fileService));
    }

    private static List<String> names(List<TreeNodeDto> nodes) {
        return nodes.stream().map(TreeNodeDto::getName).toList();
    }
}
