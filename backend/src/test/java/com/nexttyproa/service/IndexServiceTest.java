package com.nexttyproa.service;

import com.nexttyproa.dto.SearchResponseDto;
import com.nexttyproa.dto.SearchResultDto;
import com.nexttyproa.dto.SearchStatusDto;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class IndexServiceTest {

    @Test
    void reindexSkipsOversizedMarkdownFiles(@TempDir Path vaultRoot) throws Exception {
        FileService fileService = new FileService();
        IndexService indexService = new IndexService(fileService);
        Files.writeString(vaultRoot.resolve("small.md"), "# Small\nhello");
        Files.write(vaultRoot.resolve("large.md"), new byte[2 * 1024 * 1024 + 1]);

        indexService.reindexVault(vaultRoot);
        SearchStatusDto status = indexService.status();

        assertEquals(2, status.getTotalFiles());
        assertEquals(1, status.getIndexedFiles());
        assertEquals(1, status.getSkippedFiles());
        assertEquals(0, status.getFailedFiles());
    }

    @Test
    void reindexOnlyRereadsChangedFiles(@TempDir Path vaultRoot) throws Exception {
        AtomicInteger reads = new AtomicInteger();
        FileService fileService = new FileService() {
            @Override
            public String readFile(Path file) throws IOException {
                reads.incrementAndGet();
                return super.readFile(file);
            }
        };
        IndexService indexService = new IndexService(fileService);
        Files.writeString(vaultRoot.resolve("a.md"), "# A\nalpha");
        Files.createDirectories(vaultRoot.resolve("sub"));
        Files.writeString(vaultRoot.resolve("sub/b.md"), "# B\nbravo");
        Files.writeString(vaultRoot.resolve("sub/中文.md"), "# 中文\n测试");

        indexService.reindexVault(vaultRoot);
        assertEquals(3, reads.get());

        reads.set(0);
        indexService.reindexVault(vaultRoot);
        assertEquals(0, reads.get());
        assertEquals(3, indexService.status().getIndexedFiles());

        Files.writeString(vaultRoot.resolve("sub/b.md"), "# B\nbravo updated externally");
        reads.set(0);
        indexService.reindexVault(vaultRoot);
        assertEquals(1, reads.get());
        List<SearchResultDto> results = indexService.search("updated externally");
        assertEquals(1, results.size());
        assertEquals("sub/b.md", results.get(0).getPath());
    }

    @Test
    void reindexRemovesDeletedFiles(@TempDir Path vaultRoot) throws Exception {
        IndexService indexService = new IndexService(new FileService());
        Files.writeString(vaultRoot.resolve("keep.md"), "# Keep\nshared");
        Files.writeString(vaultRoot.resolve("gone.md"), "# Gone\nshared");
        indexService.reindexVault(vaultRoot);
        assertEquals(2, indexService.search("shared").size());

        Files.delete(vaultRoot.resolve("gone.md"));
        indexService.reindexVault(vaultRoot);

        List<SearchResultDto> results = indexService.search("shared");
        assertEquals(1, results.size());
        assertEquals("keep.md", results.get(0).getPath());
        assertEquals(1, indexService.status().getIndexedFiles());
        assertEquals(1, indexService.status().getTotalFiles());
    }

    @Test
    void removeNotesUnderDropsOnlyEntriesInsideDirectory(@TempDir Path vaultRoot) throws Exception {
        IndexService indexService = new IndexService(new FileService());
        Files.createDirectories(vaultRoot.resolve("docs/nested"));
        Files.createDirectories(vaultRoot.resolve("docs-other"));
        Files.writeString(vaultRoot.resolve("docs/a.md"), "# A\nshared");
        Files.writeString(vaultRoot.resolve("docs/nested/中文.md"), "# 中文\nshared");
        Files.writeString(vaultRoot.resolve("docs-other/b.md"), "# B\nshared");
        Files.writeString(vaultRoot.resolve("root.md"), "# Root\nshared");
        indexService.reindexVault(vaultRoot);
        assertEquals(4, indexService.search("shared").size());

        indexService.removeNotesUnder("docs");

        List<String> paths = indexService.search("shared").stream()
                .map(SearchResultDto::getPath)
                .sorted()
                .toList();
        assertEquals(List.of("docs-other/b.md", "root.md"), paths);
        assertEquals(2, indexService.status().getIndexedFiles());
    }

    @Test
    void reindexClearsEntriesWhenVaultChanges(@TempDir Path tempDir) throws Exception {
        IndexService indexService = new IndexService(new FileService());
        Path vaultA = Files.createDirectories(tempDir.resolve("vaultA"));
        Path vaultB = Files.createDirectories(tempDir.resolve("vaultB"));
        Files.writeString(vaultA.resolve("note.md"), "# Note\nfrom vault a");
        Files.writeString(vaultB.resolve("other.md"), "# Other\nfrom vault b");

        indexService.reindexVault(vaultA);
        assertEquals(1, indexService.search("vault a").size());

        indexService.reindexVault(vaultB);
        assertTrue(indexService.search("vault a").isEmpty());
        assertEquals(1, indexService.search("vault b").size());
        assertEquals(1, indexService.status().getIndexedFiles());
    }

    @Test
    void snippetUsesOriginalCasingAndLineNumber(@TempDir Path vaultRoot) throws Exception {
        IndexService indexService = new IndexService(new FileService());
        Files.writeString(vaultRoot.resolve("note.md"), "# Title\n\nSome Mixed CASE text");
        indexService.reindexVault(vaultRoot);

        List<SearchResultDto> results = indexService.search("case");

        assertEquals(1, results.size());
        assertTrue(results.get(0).getSnippet().contains("<mark>CASE</mark>"));
        assertEquals(3, results.get(0).getLineNumber());
    }

    @Test
    void searchReadsFilesOnlyForReturnedPage(@TempDir Path vaultRoot) throws Exception {
        AtomicInteger reads = new AtomicInteger();
        FileService fileService = new FileService() {
            @Override
            public String readFile(Path file) throws IOException {
                reads.incrementAndGet();
                return super.readFile(file);
            }
        };
        IndexService indexService = new IndexService(fileService);
        for (int i = 0; i < 5; i++) {
            Files.writeString(vaultRoot.resolve("note" + i + ".md"), "# Note " + i + "\npaged-keyword");
        }
        indexService.reindexVault(vaultRoot);

        reads.set(0);
        SearchResponseDto page = indexService.searchPage("paged-keyword", null, null, 2, 0);

        assertEquals(5, page.getTotal());
        assertEquals(2, page.getResults().size());
        assertEquals(2, reads.get());
    }

    @Test
    void snippetFallsBackToIndexedTextWhenFileIsGone(@TempDir Path vaultRoot) throws Exception {
        IndexService indexService = new IndexService(new FileService());
        Files.writeString(vaultRoot.resolve("gone.md"), "# Gone\nvanishing-keyword here");
        indexService.reindexVault(vaultRoot);
        Files.delete(vaultRoot.resolve("gone.md"));

        List<SearchResultDto> results = indexService.search("vanishing-keyword");

        assertEquals(1, results.size());
        assertTrue(results.get(0).getSnippet().contains("<mark>vanishing-keyword</mark>"));
    }

    @Test
    void snippetEscapesMarkupFromTitleAndBody(@TempDir Path vaultRoot) throws Exception {
        IndexService indexService = new IndexService(new FileService());
        Files.writeString(vaultRoot.resolve("xss.md"),
                "# <script>alert('XSS')</script>\n\n<img src=x onerror=\"alert(1)\"> payload-keyword");
        indexService.reindexVault(vaultRoot);

        for (String query : List.of("payload-keyword", "script")) {
            List<SearchResultDto> results = indexService.search(query);
            assertEquals(1, results.size());
            String snippet = results.get(0).getSnippet();
            String withoutMarks = snippet.replace("<mark>", "").replace("</mark>", "");
            assertTrue(snippet.contains("<mark>"), snippet);
            assertTrue(withoutMarks.chars().noneMatch(c -> c == '<' || c == '>' || c == '"' || c == '\''), snippet);
        }
        assertTrue(indexService.search("script").get(0).getSnippet().contains("&lt;<mark>script</mark>&gt;"));
    }

    @Test
    void scopesLimitWhichFieldsAreMatched(@TempDir Path vaultRoot) throws Exception {
        IndexService indexService = new IndexService(new FileService());
        Files.createDirectories(vaultRoot.resolve("folder-gamma"));
        Files.writeString(vaultRoot.resolve("folder-gamma/scoped.md"),
                "---\ntitle: Alpha Guide\nauthor: delta\ntags: [epsilon]\n---\nbeta content");
        indexService.reindexVault(vaultRoot);

        assertEquals(1, total(indexService, "alpha", "title"));
        assertEquals(0, total(indexService, "alpha", "path"));
        assertEquals(1, total(indexService, "beta", "body"));
        assertEquals(1, total(indexService, "beta", "content"));
        assertEquals(0, total(indexService, "beta", "title"));
        assertEquals(1, total(indexService, "gamma", "path"));
        assertEquals(0, total(indexService, "gamma", "title,body,tags,frontmatter"));
        assertEquals(1, total(indexService, "delta", "metadata"));
        assertEquals(0, total(indexService, "delta", "title,tags"));
        assertEquals(1, total(indexService, "epsilon", "tag"));
        assertEquals(0, total(indexService, "epsilon", "title, path"));
        // 未知或空的 scope 回退为全部字段
        assertEquals(1, total(indexService, "gamma", "bogus"));
        assertEquals(1, total(indexService, "gamma", "all"));
        assertEquals(1, total(indexService, "gamma", " "));
    }

    @Test
    void relevanceRanksTitleThenTagsThenBodyOccurrences(@TempDir Path vaultRoot) throws Exception {
        IndexService indexService = new IndexService(new FileService());
        Files.writeString(vaultRoot.resolve("a.md"), "# Rocket Science\nlaunch notes");
        Files.writeString(vaultRoot.resolve("b.md"), "# Other\nwe built a rocket");
        Files.writeString(vaultRoot.resolve("c.md"), "# Tagged\nsee #rocket");
        Files.writeString(vaultRoot.resolve("d.md"), "# Many\nrocket rocket rocket");
        indexService.reindexVault(vaultRoot);

        List<SearchResultDto> results = indexService.search("rocket");

        assertEquals(List.of("a.md", "c.md", "d.md", "b.md"), paths(results));
        for (int i = 1; i < results.size(); i++) {
            assertTrue(results.get(i - 1).getScore() > results.get(i).getScore(), paths(results).toString());
        }
    }

    @Test
    void sortModesOrderByRelevanceUpdatedAtOrPath(@TempDir Path vaultRoot) throws Exception {
        IndexService indexService = sortFixture(vaultRoot);

        SearchResponseDto relevance = indexService.searchPage("shared", null, null, 10, 0);
        assertEquals(List.of("z.md", "y.md", "x.md"), paths(relevance.getResults()));
        assertEquals("relevance", relevance.getSort());

        for (String alias : List.of("updated", "updatedAt", "updated_at")) {
            SearchResponseDto updated = indexService.searchPage("shared", null, alias, 10, 0);
            assertEquals(List.of("y.md", "x.md", "z.md"), paths(updated.getResults()), alias);
            assertEquals("updatedAt", updated.getSort());
        }

        SearchResponseDto byPath = indexService.searchPage("shared", null, " PATH ", 10, 0);
        assertEquals(List.of("x.md", "y.md", "z.md"), paths(byPath.getResults()));
        assertEquals("path", byPath.getSort());

        assertEquals("relevance", indexService.searchPage("shared", null, "unknown", 10, 0).getSort());
    }

    @Test
    void paginationClampsLimitAndOffsetButReportsFullTotal(@TempDir Path vaultRoot) throws Exception {
        IndexService indexService = sortFixture(vaultRoot);

        SearchResponseDto clamped = indexService.searchPage("shared", null, null, 1000, -5);
        assertEquals(100, clamped.getLimit());
        assertEquals(0, clamped.getOffset());
        assertEquals(3, clamped.getResults().size());

        SearchResponseDto secondPage = indexService.searchPage("shared", null, "path", 1, 1);
        assertEquals(List.of("y.md"), paths(secondPage.getResults()));
        assertEquals(3, secondPage.getTotal());

        SearchResponseDto pastEnd = indexService.searchPage("shared", null, null, 2, 5);
        assertTrue(pastEnd.getResults().isEmpty());
        assertEquals(3, pastEnd.getTotal());

        SearchResponseDto zeroLimit = indexService.searchPage("shared", null, null, -1, 0);
        assertEquals(0, zeroLimit.getLimit());
        assertTrue(zeroLimit.getResults().isEmpty());
        assertEquals(3, zeroLimit.getTotal());
    }

    @Test
    void blankQueriesReturnNothing(@TempDir Path vaultRoot) throws Exception {
        IndexService indexService = sortFixture(vaultRoot);

        assertTrue(indexService.search(null).isEmpty());
        SearchResponseDto blank = indexService.searchPage("   ", null, "path", 10, 0);
        assertTrue(blank.getResults().isEmpty());
        assertEquals(0, blank.getTotal());
        assertEquals("path", blank.getSort());
    }

    @Test
    void matchingIsCaseInsensitiveAndSupportsCjk(@TempDir Path vaultRoot) throws Exception {
        IndexService indexService = new IndexService(new FileService());
        Files.createDirectories(vaultRoot.resolve("笔记"));
        Files.writeString(vaultRoot.resolve("笔记/中文.md"), "# 中文 Title\n\n正文包含关键字");
        indexService.reindexVault(vaultRoot);

        assertEquals(1, indexService.search("  TITLE ").size());
        assertEquals(1, total(indexService, "笔记", "path"));

        List<SearchResultDto> results = indexService.search("关键字");
        assertEquals(1, results.size());
        assertEquals("笔记/中文.md", results.get(0).getPath());
        assertEquals("中文 Title", results.get(0).getTitle());
        assertEquals(3, results.get(0).getLineNumber());
        assertTrue(results.get(0).getSnippet().contains("<mark>关键字</mark>"));
    }

    @Test
    void frontmatterTitleAndTagsAreParsed(@TempDir Path vaultRoot) throws Exception {
        IndexService indexService = new IndexService(new FileService());
        Files.writeString(vaultRoot.resolve("meta.md"),
                "---\ntitle: \"Quoted Title\"\ntags: [one, \"two\", #three]\n---\nplain body");
        indexService.reindexVault(vaultRoot);

        List<SearchResultDto> results = indexService.search("quoted");
        assertEquals(1, results.size());
        assertEquals("Quoted Title", results.get(0).getTitle());
        assertEquals(1, total(indexService, "two", "tags"));
        assertEquals(1, total(indexService, "three", "tags"));
        assertEquals(0, total(indexService, "plain", "tags"));
    }

    @Test
    void indexNoteAndRemoveNoteKeepIndexInSync(@TempDir Path vaultRoot) throws Exception {
        IndexService indexService = new IndexService(new FileService());
        Files.writeString(vaultRoot.resolve("live.md"), "fresh-keyword");

        indexService.indexNote(vaultRoot, "live.md", "fresh-keyword");
        assertEquals(1, indexService.search("fresh-keyword").size());

        indexService.syncRenamedFile(vaultRoot, "live.md", "notes.txt");
        assertTrue(indexService.search("fresh-keyword").isEmpty());

        indexService.indexNote(vaultRoot, "../escape.md", "escape-keyword");
        assertTrue(indexService.search("escape-keyword").isEmpty());
        assertEquals(1, indexService.status().getFailedFiles());
    }

    /** x/y/z share a keyword; z matches twice (most relevant), y is newest, x is middle-aged. */
    private static IndexService sortFixture(Path vaultRoot) throws IOException {
        Instant now = Instant.now();
        writeWithMtime(vaultRoot.resolve("x.md"), "# X\nshared", now.minus(2, ChronoUnit.HOURS));
        writeWithMtime(vaultRoot.resolve("y.md"), "# Y\nshared", now.minus(1, ChronoUnit.HOURS));
        writeWithMtime(vaultRoot.resolve("z.md"), "# Z\nshared shared", now.minus(3, ChronoUnit.HOURS));
        IndexService indexService = new IndexService(new FileService());
        indexService.reindexVault(vaultRoot);
        return indexService;
    }

    private static void writeWithMtime(Path file, String content, Instant mtime) throws IOException {
        Files.writeString(file, content);
        Files.setLastModifiedTime(file, FileTime.from(mtime));
    }

    private static int total(IndexService indexService, String query, String scope) {
        return indexService.searchPage(query, scope, null, 10, 0).getTotal();
    }

    private static List<String> paths(List<SearchResultDto> results) {
        return results.stream().map(SearchResultDto::getPath).toList();
    }
}
