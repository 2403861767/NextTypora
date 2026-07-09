package com.nexttyproa.service;

import com.nexttyproa.dto.SearchStatusDto;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;

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
}
