package com.nexttyproa.service;

import com.nexttyproa.config.AppProperties;
import com.nexttyproa.dto.CreateNoteRequest;
import com.nexttyproa.dto.NoteDto;
import com.nexttyproa.dto.SaveNoteRequest;
import com.nexttyproa.exception.BadRequestException;
import com.nexttyproa.exception.ConflictException;
import com.nexttyproa.exception.NotFoundException;
import com.nexttyproa.exception.NoteConflictException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class NoteServiceTest {

    private final FileService fileService = new FileService();
    private final IndexService indexService = new IndexService(fileService);

    @Test
    void saveWithCurrentBaseHashWritesContentAndReturnsNewHash(@TempDir Path vaultRoot) throws Exception {
        NoteService noteService = noteService(vaultRoot);
        NoteDto created = noteService.createNote(createRequest("hello.md", "# Hello\nv1"));

        NoteDto saved = noteService.saveNote(saveRequest("hello.md", "# Hello\nv2", created.getContentHash(), false));

        assertEquals("# Hello\nv2", Files.readString(vaultRoot.resolve("hello.md")));
        assertEquals(fileService.hashContent("# Hello\nv2"), saved.getContentHash());
        assertEquals("hello.md", saved.getPath());
    }

    @Test
    void saveWithStaleBaseHashIsRejectedAndLeavesExternalEditIntact(@TempDir Path vaultRoot) throws Exception {
        NoteService noteService = noteService(vaultRoot);
        NoteDto created = noteService.createNote(createRequest("note.md", "original"));
        Files.writeString(vaultRoot.resolve("note.md"), "edited externally");

        NoteConflictException conflict = assertThrows(NoteConflictException.class,
                () -> noteService.saveNote(saveRequest("note.md", "from editor", created.getContentHash(), false)));

        assertEquals("note.md", conflict.getPath());
        assertEquals(fileService.hashContent("edited externally"), conflict.getCurrentHash());
        assertEquals("edited externally", Files.readString(vaultRoot.resolve("note.md")));
    }

    @Test
    void saveWithoutBaseHashOnExistingFileIsRejected(@TempDir Path vaultRoot) throws Exception {
        NoteService noteService = noteService(vaultRoot);
        noteService.createNote(createRequest("note.md", "original"));

        assertThrows(NoteConflictException.class, () -> noteService.saveNote(saveRequest("note.md", "x", null, false)));
        assertThrows(NoteConflictException.class, () -> noteService.saveNote(saveRequest("note.md", "x", "  ", false)));
        assertEquals("original", Files.readString(vaultRoot.resolve("note.md")));
    }

    @Test
    void forceSaveOverwritesExternalEditAndKeepsBackup(@TempDir Path vaultRoot) throws Exception {
        NoteService noteService = noteService(vaultRoot);
        noteService.createNote(createRequest("note.md", "original"));
        Files.writeString(vaultRoot.resolve("note.md"), "edited externally");

        noteService.saveNote(saveRequest("note.md", "forced", "stale-hash", true));

        assertEquals("forced", Files.readString(vaultRoot.resolve("note.md")));
        assertEquals(List.of("edited externally"), backupContents(vaultRoot, "note.md"));
    }

    @Test
    void saveToMissingFileCreatesItWithoutBaseHash(@TempDir Path vaultRoot) throws Exception {
        NoteService noteService = noteService(vaultRoot);

        noteService.saveNote(saveRequest("new/中文笔记.md", "内容", null, false));

        assertEquals("内容", Files.readString(vaultRoot.resolve("new/中文笔记.md")));
        assertTrue(backupContents(vaultRoot.resolve("new"), "中文笔记.md").isEmpty());
    }

    @Test
    void savePreservesDetectedGbkEncoding(@TempDir Path vaultRoot) throws Exception {
        Charset gbk = Charset.forName("GBK");
        Path file = vaultRoot.resolve("gbk.md");
        Files.write(file, "# 标题\n中文内容，用于编码检测".getBytes(gbk));
        NoteService noteService = noteService(vaultRoot);
        NoteDto loaded = noteService.getNote("gbk.md");
        assertEquals("GBK", loaded.getEncoding());

        NoteDto saved = noteService.saveNote(saveRequest("gbk.md", "# 标题\n修改后的内容", loaded.getContentHash(), false));

        assertEquals("GBK", saved.getEncoding());
        assertEquals("# 标题\n修改后的内容", new String(Files.readAllBytes(file), gbk));
    }

    @Test
    void saveUpdatesSearchIndex(@TempDir Path vaultRoot) throws Exception {
        NoteService noteService = noteService(vaultRoot);
        NoteDto created = noteService.createNote(createRequest("idx.md", "before-keyword"));
        assertEquals(1, indexService.search("before-keyword").size());

        noteService.saveNote(saveRequest("idx.md", "after-keyword", created.getContentHash(), false));

        assertTrue(indexService.search("before-keyword").isEmpty());
        assertEquals(1, indexService.search("after-keyword").size());
    }

    @Test
    void concurrentSavesWithSameBaseHashLetExactlyOneWin(@TempDir Path vaultRoot) throws Exception {
        NoteService noteService = noteService(vaultRoot);
        String baseHash = noteService.createNote(createRequest("race.md", "base")).getContentHash();
        int writers = 8;
        ExecutorService pool = Executors.newFixedThreadPool(writers);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Boolean>> results = new ArrayList<>();
        try {
            for (int i = 0; i < writers; i++) {
                String content = "writer-" + i;
                Callable<Boolean> task = () -> {
                    start.await();
                    try {
                        noteService.saveNote(saveRequest("race.md", content, baseHash, false));
                        return true;
                    } catch (NoteConflictException e) {
                        return false;
                    }
                };
                results.add(pool.submit(task));
            }
            start.countDown();
            int successes = 0;
            for (Future<Boolean> result : results) {
                if (result.get(10, TimeUnit.SECONDS)) successes++;
            }
            assertEquals(1, successes);
        } finally {
            pool.shutdownNow();
        }
        assertTrue(Files.readString(vaultRoot.resolve("race.md")).startsWith("writer-"));
    }

    @Test
    void saveRejectsNonMarkdownAndTraversalPaths(@TempDir Path vaultRoot) {
        NoteService noteService = noteService(vaultRoot);

        assertThrows(BadRequestException.class, () -> noteService.saveNote(saveRequest("notes.txt", "x", null, true)));
        assertThrows(SecurityException.class, () -> noteService.saveNote(saveRequest("../outside.md", "x", null, true)));
        assertFalse(Files.exists(vaultRoot.getParent().resolve("outside.md")));
    }

    @Test
    void createAppendsMarkdownExtensionAndRejectsOtherExtensions(@TempDir Path vaultRoot) throws Exception {
        NoteService noteService = noteService(vaultRoot);

        NoteDto created = noteService.createNote(createRequest("docs\\untitled", null));

        assertEquals("docs/untitled.md", created.getPath());
        assertEquals("", Files.readString(vaultRoot.resolve("docs/untitled.md")));
        assertEquals(1, indexService.status().getIndexedFiles());
        assertThrows(BadRequestException.class, () -> noteService.createNote(createRequest("image.png", "")));
    }

    @Test
    void createRejectsExistingNote(@TempDir Path vaultRoot) throws Exception {
        NoteService noteService = noteService(vaultRoot);
        noteService.createNote(createRequest("dup.md", "first"));

        assertThrows(ConflictException.class, () -> noteService.createNote(createRequest("dup.md", "second")));
        assertEquals("first", Files.readString(vaultRoot.resolve("dup.md")));
    }

    @Test
    void getAndDeleteReportMissingNotes(@TempDir Path vaultRoot) {
        NoteService noteService = noteService(vaultRoot);

        assertThrows(NotFoundException.class, () -> noteService.getNote("missing.md"));
        assertThrows(NotFoundException.class, () -> noteService.deleteNote("missing.md"));
        assertThrows(BadRequestException.class, () -> noteService.getNote("readme.txt"));
    }

    @Test
    void deleteRemovesFileEmptyParentsAndIndexEntry(@TempDir Path vaultRoot) throws Exception {
        NoteService noteService = noteService(vaultRoot);
        noteService.createNote(createRequest("a/b/gone.md", "delete-keyword"));
        assertEquals(1, indexService.search("delete-keyword").size());

        noteService.deleteNote("a/b/gone.md");

        assertFalse(Files.exists(vaultRoot.resolve("a/b/gone.md")));
        assertFalse(Files.exists(vaultRoot.resolve("a")));
        assertTrue(indexService.search("delete-keyword").isEmpty());
    }

    @Test
    void operationsRequireConfiguredWorkspace() {
        NoteService noteService = new NoteService(
                new WorkspaceService(new AppProperties(), fileService, indexService), fileService, indexService);

        assertThrows(BadRequestException.class, () -> noteService.getNote("a.md"));
        assertThrows(BadRequestException.class, () -> noteService.saveNote(saveRequest("a.md", "x", null, true)));
        assertThrows(BadRequestException.class, () -> noteService.createNote(createRequest("a.md", "x")));
        assertThrows(BadRequestException.class, () -> noteService.deleteNote("a.md"));
    }

    private NoteService noteService(Path vaultRoot) {
        AppProperties appProperties = new AppProperties();
        appProperties.setVaultPath(vaultRoot.toString());
        WorkspaceService workspaceService = new WorkspaceService(appProperties, fileService, indexService);
        return new NoteService(workspaceService, fileService, indexService);
    }

    private static SaveNoteRequest saveRequest(String path, String content, String baseHash, boolean force) {
        SaveNoteRequest request = new SaveNoteRequest();
        request.setPath(path);
        request.setContent(content);
        request.setBaseHash(baseHash);
        request.setForce(force);
        return request;
    }

    private static CreateNoteRequest createRequest(String path, String content) {
        CreateNoteRequest request = new CreateNoteRequest();
        request.setPath(path);
        request.setContent(content);
        return request;
    }

    private static List<String> backupContents(Path dir, String fileName) throws Exception {
        Path backupDir = dir.resolve(".nexttyproa-backups");
        if (!Files.isDirectory(backupDir)) {
            return List.of();
        }
        try (Stream<Path> entries = Files.list(backupDir)) {
            List<Path> backups = entries
                    .filter(p -> p.getFileName().toString().startsWith(fileName + ".") && p.toString().endsWith(".bak"))
                    .toList();
            List<String> contents = new ArrayList<>();
            for (Path backup : backups) {
                contents.add(Files.readString(backup, StandardCharsets.UTF_8));
            }
            return contents;
        }
    }
}
