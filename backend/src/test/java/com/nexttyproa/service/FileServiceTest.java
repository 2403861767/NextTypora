package com.nexttyproa.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
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
    void resolveSafeNormalizesSeparatorsAndInnerDotSegments(@TempDir Path vaultRoot) throws Exception {
        Path expected = vaultRoot.resolve("notes/sub/x.md").toAbsolutePath().normalize();

        assertEquals(expected, fileService.resolveSafe(vaultRoot, "notes\\sub\\x.md"));
        assertEquals(expected, fileService.resolveSafe(vaultRoot, "/notes/sub/x.md"));
        assertEquals(expected, fileService.resolveSafe(vaultRoot, "notes/other/../sub/./x.md"));
    }

    @Test
    void resolveSafeRejectsTraversalInAnySeparatorStyle(@TempDir Path vaultRoot) {
        for (String path : List.of("..\\outside.md", "notes/../../outside.md", "notes\\..\\..\\outside.md", "./../outside.md")) {
            assertThrows(SecurityException.class, () -> fileService.resolveSafe(vaultRoot, path), path);
        }
    }

    @Test
    void resolveSafeNeverResolvesAbsolutePathOutsideVault(@TempDir Path parent) throws Exception {
        Path vaultRoot = Files.createDirectory(parent.resolve("vault"));
        Path outside = parent.resolve("outside").resolve("secret.md").toAbsolutePath();

        // Windows 盘符路径会被拒绝；POSIX 绝对路径去掉前导 / 后被限制在 vault 内，两种结果都不能逃逸
        try {
            Path resolved = fileService.resolveSafe(vaultRoot, outside.toString());
            assertTrue(resolved.startsWith(vaultRoot.toAbsolutePath().normalize()), resolved.toString());
        } catch (SecurityException expected) {
            // rejected
        }
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
    void windowsFileNameRulesRejectReservedCharactersNamesAndTrailingDotOrSpace() {
        for (String name : List.of("test<>file.md", "a:b.md", "what?.md", "star*.md", "pipe|.md", "quote\".md", "tab\t.md",
                "CON.md", "con", "Nul.txt", "COM1.md", "lpt9.markdown", "AUX .md", "note.", "note ")) {
            assertThrows(com.nexttyproa.exception.BadRequestException.class,
                    () -> FileService.validateWindowsFileName(name, true), name);
        }
    }

    @Test
    void windowsFileNameRulesAllowOrdinaryAndCjkNames() {
        for (String name : List.of("hello.md", "中文 space-!@.md", "CONSOLE.md", "COM10.md", "my.con.md", ".hidden", "a b.c.md")) {
            FileService.validateWindowsFileName(name, true);
        }
    }

    @Test
    void windowsFileNameRulesAreSkippedOnOtherPlatforms() {
        FileService.validateWindowsFileName("what?.md", false);
        FileService.validateWindowsFileName("CON.md", false);
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

    // BUG_BACKLOG_REAL_WORLD.md RW-P2-005：记事本“Unicode”格式（带 BOM 的 UTF-16）每个 ASCII 字符后都有 0x00，
    // 被当成二进制文件拒绝打开（HTTP 500）；保存时也只会写 UTF-8 的 BOM
    @Test
    void readsAndPreservesUtf16LeWithBom(@TempDir Path vaultRoot) throws Exception {
        assertUtf16RoundTrip(vaultRoot, StandardCharsets.UTF_16LE, new byte[] {(byte) 0xFF, (byte) 0xFE}, "UTF-16LE");
    }

    @Test
    void readsAndPreservesUtf16BeWithBom(@TempDir Path vaultRoot) throws Exception {
        assertUtf16RoundTrip(vaultRoot, StandardCharsets.UTF_16BE, new byte[] {(byte) 0xFE, (byte) 0xFF}, "UTF-16BE");
    }

    private void assertUtf16RoundTrip(Path vaultRoot, Charset charset, byte[] bom, String expectedEncoding) throws Exception {
        Path file = vaultRoot.resolve("utf16.md");
        String content = "# UTF-16 编码测试\n中文内容 abc";
        Files.write(file, concat(bom, content.getBytes(charset)));

        FileService.ReadFileResult read = fileService.readFileWithEncoding(file);

        assertEquals(expectedEncoding, read.encoding());
        assertTrue(read.hasBom());
        assertEquals(content, read.content());

        fileService.writeFileAtomic(file, read.content() + "\n追加", read.encoding(), read.hasBom(), true);
        byte[] saved = Files.readAllBytes(file);
        assertArrayEquals(bom, Arrays.copyOf(saved, bom.length));
        assertEquals(content + "\n追加", new String(saved, bom.length, saved.length - bom.length, charset));
        assertTrue(Files.exists(vaultRoot.resolve(".nexttyproa-backups")));
        assertEquals(content + "\n追加", fileService.readFileWithEncoding(file).content());
    }

    @Test
    void stillRejectsNulBytesWithoutAUtf16Bom(@TempDir Path vaultRoot) throws Exception {
        Path file = vaultRoot.resolve("binary.md");
        Files.write(file, new byte[] {(byte) 0x89, 'P', 'N', 'G', 0, 0, 0, 13});

        IOException error = assertThrows(IOException.class, () -> fileService.readFileWithEncoding(file));

        assertTrue(error.getMessage().contains("binary"), error.getMessage());
    }

    @Test
    void rejectsUtf32LeInsteadOfOpeningItAsUtf16(@TempDir Path vaultRoot) throws Exception {
        // UTF-32LE 的 BOM（FF FE 00 00）以 UTF-16LE 的 BOM 开头：不能当 UTF-16 打开成一串 NUL 字符
        Path file = vaultRoot.resolve("utf32.md");
        Files.write(file, concat(new byte[] {(byte) 0xFF, (byte) 0xFE, 0, 0}, "# Title".getBytes(Charset.forName("UTF-32LE"))));

        IOException error = assertThrows(IOException.class, () -> fileService.readFileWithEncoding(file));

        assertTrue(error.getMessage().contains("binary"), error.getMessage());
    }

    private static byte[] concat(byte[] first, byte[] second) {
        byte[] result = Arrays.copyOf(first, first.length + second.length);
        System.arraycopy(second, 0, result, first.length, second.length);
        return result;
    }

    @Test
    void extractTitleNeverReturnsTheFrontmatterFence() {
        String note = """
                ---
                title: 人月神话
                tags:
                  - 读书
                ---

                # 人月神话
                """;

        assertEquals("人月神话", FileService.extractTitle("读书笔记/人月神话.md", note));
    }

    @Test
    void extractTitlePrefersTheFrontmatterTitleLikeSearchAndExport() {
        assertEquals("神话与现实", FileService.extractTitle("a.md",
                "---\ntitle: \"神话与现实\"\n---\n\n# 人月神话\n"));
        assertEquals("代码大全（第二版）", FileService.extractTitle("a.md",
                "---\nTitle: '代码大全（第二版）'\ntags: [读书]\n---\n\n只有正文，没有一级标题。\n"));
    }

    @Test
    void extractTitleSkipsFrontmatterWithoutTitleAndUsesTheBody() {
        assertEquals("设计模式", FileService.extractTitle("a.md",
                "---\ntags: [读书]\nauthor: GoF\n---\n\n# 设计模式\n\n正文"));
        assertEquals("正文第一段", FileService.extractTitle("a.md",
                "---\ntags: [读书]\n---\n\n\n正文第一段\n"));
        assertEquals("设计模式", FileService.extractTitle("a.md",
                "---\ntitle:\n---\n# 设计模式\n"));
        assertEquals("CRLF 标题", FileService.extractTitle("a.md",
                "---\r\ntags: [a]\r\n---\r\n\r\n# CRLF 标题\r\n"));
        assertEquals("空元数据", FileService.extractTitle("dir/空元数据.md",
                "---\ntags: [a]\n---\n"));
    }

    @Test
    void extractTitleKeepsTheExistingRulesForNotesWithoutFrontmatter() {
        assertEquals("普通笔记标题", FileService.extractTitle("普通笔记.md", "# 普通笔记标题\n\n正文"));
        assertEquals("没有一级标题的正文。", FileService.extractTitle("a.md", "没有一级标题的正文。\n\n## 二级标题"));
        assertEquals("第二行才有标题", FileService.extractTitle("dir/第二行才有标题.md", "\n# 标题\n"));
        assertEquals("空白", FileService.extractTitle("空白.md", "  \n\n"));
        assertEquals("readme", FileService.extractTitle("docs/readme.markdown", ""));
        assertEquals("x".repeat(80), FileService.extractTitle("a.md", "x".repeat(100)));
        // 以分隔线开头、但没有闭合的 ---，不是 frontmatter：保持原规则
        assertEquals("---", FileService.extractTitle("分隔线开头.md", "---\n\n分隔线之后的第一段正文。\n"));
        // ----- 不是 frontmatter 的分隔符
        assertEquals("-----", FileService.extractTitle("a.md", "-----\ntitle: x\n-----\n正文"));
    }
}
