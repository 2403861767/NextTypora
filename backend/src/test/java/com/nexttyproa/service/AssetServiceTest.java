package com.nexttyproa.service;

import com.nexttyproa.config.AppProperties;
import com.nexttyproa.exception.BadRequestException;
import com.nexttyproa.exception.NotFoundException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AssetServiceTest {

    private final FileService fileService = new FileService();

    @Test
    void markdownRefIsRelativeToNoteDirectory() {
        assertEquals(
                "hello.assets/photo.png",
                AssetService.markdownRefForNote("hello.md", "hello.assets/photo.png")
        );
        assertEquals(
                "hello.assets/photo.png",
                AssetService.markdownRefForNote("notes/hello.md", "notes/hello.assets/photo.png")
        );
        assertEquals(
                "page.assets/image.png",
                AssetService.markdownRefForNote("docs/sub/page.md", "docs/sub/page.assets/image.png")
        );
        assertEquals(
                "other/image.png",
                AssetService.markdownRefForNote("docs\\page.md", "other\\image.png")
        );
    }

    @Test
    void assetDirSitsNextToNote() {
        assertEquals("notes/中文.assets", AssetService.assetDirForNote("notes\\中文.md"));
        assertEquals("noext.assets", AssetService.assetDirForNote("noext"));
        assertEquals(".hidden.assets", AssetService.assetDirForNote(".hidden"));
    }

    @Test
    void generateAssetFileNameUsesTimestampRandomAndExtension() {
        String name = AssetService.generateAssetFileName("photo.jpg");
        assertTrue(name.matches("\\d{13}-\\d{6}\\.jpg"));

        String fromUnknown = AssetService.generateAssetFileName("blob");
        assertTrue(fromUnknown.matches("\\d{13}-\\d{6}\\.png"));

        assertTrue(AssetService.generateAssetFileName("dir\\Photo.JPEG").endsWith(".jpeg"));
        assertTrue(AssetService.generateAssetFileName("evil.exe").endsWith(".png"));
        assertTrue(AssetService.generateAssetFileName("trailing.").endsWith(".png"));
        assertTrue(AssetService.generateAssetFileName(" ").endsWith(".png"));
    }

    @Test
    void uploadStoresFileInNoteAssetsFolder(@TempDir Path vaultRoot) throws Exception {
        Files.createDirectories(vaultRoot.resolve("notes"));
        Files.writeString(vaultRoot.resolve("notes/page.md"), "# Page");
        byte[] bytes = {1, 2, 3};

        AssetService.UploadResult result = assetService(vaultRoot)
                .uploadAsset("notes\\page.md", new MockMultipartFile("file", "shot.PNG", "image/png", bytes));

        assertTrue(result.path().matches("notes/page\\.assets/\\d{13}-\\d{6}\\.png"), result.path());
        assertEquals(result.path().substring("notes/".length()), result.markdownRef());
        assertArrayEquals(bytes, Files.readAllBytes(vaultRoot.resolve(result.path())));
    }

    @Test
    void uploadWithoutOriginalNameDefaultsToPng(@TempDir Path vaultRoot) throws Exception {
        Files.writeString(vaultRoot.resolve("a.md"), "a");

        AssetService.UploadResult result = assetService(vaultRoot)
                .uploadAsset("a.md", new MockMultipartFile("file", "", "image/png", new byte[] {9}));

        assertTrue(result.path().startsWith("a.assets/") && result.path().endsWith(".png"), result.path());
    }

    @Test
    void uploadRejectsMissingNoteAndTraversal(@TempDir Path vaultRoot) {
        AssetService service = assetService(vaultRoot);
        MockMultipartFile file = new MockMultipartFile("file", "x.png", "image/png", new byte[] {1});

        assertThrows(NotFoundException.class, () -> service.uploadAsset("missing.md", file));
        assertThrows(SecurityException.class, () -> service.uploadAsset("../outside.md", file));
    }

    @Test
    void readAssetReturnsReadableFileOnly(@TempDir Path vaultRoot) throws Exception {
        Path asset = Files.createDirectories(vaultRoot.resolve("a.assets")).resolve("img.png");
        Files.write(asset, new byte[] {7, 7});
        AssetService service = assetService(vaultRoot);

        Resource resource = service.readAsset("a.assets\\img.png");

        assertTrue(resource.exists());
        assertArrayEquals(new byte[] {7, 7}, resource.getContentAsByteArray());
        assertThrows(NotFoundException.class, () -> service.readAsset("a.assets/missing.png"));
        assertThrows(NotFoundException.class, () -> service.readAsset("a.assets"));
        assertThrows(SecurityException.class, () -> service.readAsset("../secret.png"));
    }

    @Test
    void mediaTypeFallsBackToExtensionOrOctetStream(@TempDir Path dir) throws Exception {
        AssetService service = assetService(dir);

        assertEquals(MediaType.IMAGE_PNG, service.mediaTypeFor(Files.write(dir.resolve("a.png"), new byte[] {1})));
        assertEquals(MediaType.APPLICATION_OCTET_STREAM,
                service.mediaTypeFor(Files.write(dir.resolve("c.nexttyproa-unknown"), new byte[] {1})));
    }

    @Test
    void operationsRequireConfiguredWorkspace() {
        AssetService service = new AssetService(
                new WorkspaceService(new AppProperties(), fileService, new IndexService(fileService)), fileService);

        assertThrows(BadRequestException.class, () -> service.readAsset("a.png"));
        assertThrows(BadRequestException.class,
                () -> service.uploadAsset("a.md", new MockMultipartFile("file", "a.png", "image/png", new byte[] {1})));
    }

    private AssetService assetService(Path vaultRoot) {
        AppProperties appProperties = new AppProperties();
        appProperties.setVaultPath(vaultRoot.toString());
        WorkspaceService workspaceService = new WorkspaceService(appProperties, fileService, new IndexService(fileService));
        return new AssetService(workspaceService, fileService);
    }
}
