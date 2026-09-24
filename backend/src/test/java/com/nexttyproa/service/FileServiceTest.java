package com.nexttyproa.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

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
    void keepsOnlyNewestBackups(@TempDir Path vaultRoot) throws Exception {
        Path file = vaultRoot.resolve("a.md");
        Files.writeString(file, "v0", StandardCharsets.UTF_8);
        Path backupDir = Files.createDirectory(vaultRoot.resolve(".nexttyproa-backups"));
        for (int i = 0; i < 15; i++) {
            Files.writeString(backupDir.resolve(fakeBackupName(i)), "old" + i);
        }
        Path otherFileBackup = Files.writeString(backupDir.resolve("a.md.old.md.2019-01-01T000000Z.bak"), "other");

        fileService.writeFileAtomic(file, "v1", "UTF-8", false, true);

        List<String> remaining;
        try (Stream<Path> entries = Files.list(backupDir)) {
            remaining = entries.map(p -> p.getFileName().toString())
                    .filter(name -> name.startsWith("a.md.") && !name.startsWith("a.md.old.md."))
                    .toList();
        }
        assertEquals(10, remaining.size());
        for (int i = 0; i < 6; i++) {
            assertFalse(remaining.contains(fakeBackupName(i)), fakeBackupName(i));
        }
        for (int i = 6; i < 15; i++) {
            assertTrue(remaining.contains(fakeBackupName(i)), fakeBackupName(i));
        }
        assertTrue(remaining.stream().anyMatch(name -> !name.startsWith("a.md.2020-")), "new backup is kept");
        assertTrue(Files.exists(otherFileBackup));
    }

    /**
     * Fake i is 0.5s newer than fake i-1, alternating between whole and fractional seconds. The cut
     * between #5 ("000003Z") and #6 ("000003-5Z") falls inside one second, where string order is wrong.
     */
    private static String fakeBackupName(int i) {
        return String.format("a.md.2020-01-01T0000%02d%sZ.bak", (i + 1) / 2, i % 2 == 0 ? "-5" : "");
    }

    @Test
    void detectsShortGbkThatIsAlsoValidUtf8(@TempDir Path vaultRoot) throws Exception {
        Path file = vaultRoot.resolve("short-gbk.md");
        byte[] bytes = "学习".getBytes(Charset.forName("GBK"));
        assertEquals("ѧϰ", new String(bytes, StandardCharsets.UTF_8));
        Files.write(file, bytes);

        FileService.ReadFileResult read = fileService.readFileWithEncoding(file);

        assertEquals("GBK", read.encoding());
        assertEquals("学习", read.content());
    }

    @Test
    void readsAndPreservesBig5Markdown(@TempDir Path vaultRoot) throws Exception {
        Path file = vaultRoot.resolve("big5.md");
        String content = "# 筆記\n這是一個繁體中文的測試文件，內容包含標點符號。";
        Files.write(file, content.getBytes(Charset.forName("Big5")));

        FileService.ReadFileResult read = fileService.readFileWithEncoding(file);

        assertEquals("Big5", read.encoding());
        assertEquals(content, read.content());

        fileService.writeFileAtomic(file, read.content() + "\n測試", read.encoding(), read.hasBom(), false);
        assertEquals(content + "\n測試", new String(Files.readAllBytes(file), Charset.forName("Big5")));
    }

    @Test
    void detectsShiftJisMarkdown(@TempDir Path vaultRoot) throws Exception {
        Path file = vaultRoot.resolve("sjis.md");
        String content = "# メモ\n日本語のテストファイルです。";
        Files.write(file, content.getBytes(Charset.forName("Shift_JIS")));

        FileService.ReadFileResult read = fileService.readFileWithEncoding(file);

        assertEquals("Shift_JIS", read.encoding());
        assertEquals(content, read.content());
    }

    @Test
    void keepsUtf8ForNonAsciiText(@TempDir Path vaultRoot) throws Exception {
        String[] samples = {"café", "Größe über Maß", "Привет мир", "Καλημέρα", "nǐ hǎo", "# 学习笔记\n中文内容", "done 👍"};
        for (int i = 0; i < samples.length; i++) {
            Path file = vaultRoot.resolve("utf8-" + i + ".md");
            Files.write(file, samples[i].getBytes(StandardCharsets.UTF_8));

            FileService.ReadFileResult read = fileService.readFileWithEncoding(file);

            assertEquals("UTF-8", read.encoding(), samples[i]);
            assertEquals(samples[i], read.content());
        }
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
