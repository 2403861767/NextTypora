package com.nexttyproa.service;

import com.nexttyproa.dto.SearchResultDto;
import com.nexttyproa.dto.SearchStatusDto;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
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
}
