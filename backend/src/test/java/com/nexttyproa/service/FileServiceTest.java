package com.nexttyproa.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class FileServiceTest {

    private final FileService fileService = new FileService();

    @Test
    void resolveSafeAllowsNestedFile(@TempDir Path vaultRoot) throws Exception {
        Path file = fileService.resolveSafe(vaultRoot, "notes/hello.md");
        assertEquals(vaultRoot.resolve("notes/hello.md").normalize(), file);
    }

    @Test
    void resolveSafeRejectsTraversal(@TempDir Path vaultRoot) {
        assertThrows(SecurityException.class, () -> fileService.resolveSafe(vaultRoot, "../outside.md"));
    }

    @Test
    void resolveSafeRejectsSiblingPrefix(@TempDir Path parent) {
        Path vaultRoot = parent.resolve("notes");
        assertThrows(SecurityException.class, () -> fileService.resolveSafe(vaultRoot, "../notes2/secret.md"));
    }

    @Test
    void resolveSafeRejectsSymlinkPathSegment(@TempDir Path parent) throws Exception {
        Path vaultRoot = Files.createDirectory(parent.resolve("vault"));
        Path outside = Files.createDirectory(parent.resolve("outside"));
        Path link = vaultRoot.resolve("link");
        try {
            Files.createSymbolicLink(link, outside);
        } catch (UnsupportedOperationException | java.io.IOException | SecurityException e) {
            assumeTrue(false);
        }

        assertThrows(SecurityException.class, () -> fileService.resolveSafe(vaultRoot, "link/secret.md"));
    }

    @Test
    void readsAndPreservesGbkMarkdown(@TempDir Path vaultRoot) throws Exception {
        Path file = vaultRoot.resolve("gbk.md");
        Files.write(file, "# 标题\n中文内容".getBytes(Charset.forName("GBK")));

        FileService.ReadFileResult read = fileService.readFileWithEncoding(file);

        assertEquals("GBK", read.encoding());
        assertFalse(read.hasBom());
        assertEquals("# 标题\n中文内容", read.content());

        fileService.writeFileAtomic(file, read.content() + "\n追加", read.encoding(), read.hasBom(), true);
        assertEquals("# 标题\n中文内容\n追加", new String(Files.readAllBytes(file), Charset.forName("GBK")));
        assertTrue(Files.exists(vaultRoot.resolve(".nexttyproa-backups")));
    }

    @Test
    void readsAndWritesUtf8Bom(@TempDir Path vaultRoot) throws Exception {
        Path file = vaultRoot.resolve("bom.md");
        byte[] content = "Hello".getBytes(StandardCharsets.UTF_8);
        byte[] withBom = new byte[] {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF, content[0], content[1], content[2], content[3], content[4]};
        Files.write(file, withBom);

        FileService.ReadFileResult read = fileService.readFileWithEncoding(file);

        assertEquals("UTF-8", read.encoding());
        assertTrue(read.hasBom());
        assertEquals("Hello", read.content());

        fileService.writeFileAtomic(file, "World", read.encoding(), read.hasBom(), true);
        byte[] saved = Files.readAllBytes(file);
        assertEquals((byte) 0xEF, saved[0]);
        assertEquals((byte) 0xBB, saved[1]);
        assertEquals((byte) 0xBF, saved[2]);
        assertEquals("World", new String(saved, 3, saved.length - 3, StandardCharsets.UTF_8));
    }
}
