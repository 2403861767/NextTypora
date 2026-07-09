package com.nexttyproa.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AssetServiceTest {

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
    }

    @Test
    void generateAssetFileNameUsesTimestampRandomAndExtension() {
        String name = AssetService.generateAssetFileName("photo.jpg");
        assertTrue(name.matches("\\d{13}-\\d{6}\\.jpg"));

        String fromUnknown = AssetService.generateAssetFileName("blob");
        assertTrue(fromUnknown.matches("\\d{13}-\\d{6}\\.png"));
    }
}
