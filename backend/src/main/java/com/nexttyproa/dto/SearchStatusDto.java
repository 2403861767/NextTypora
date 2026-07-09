package com.nexttyproa.dto;

import java.time.Instant;

public class SearchStatusDto {

    private boolean indexing;
    private int indexedFiles;
    private int totalFiles;
    private int failedFiles;
    private int skippedFiles;
    private Instant lastIndexedAt;

    public SearchStatusDto() {
    }

    public SearchStatusDto(boolean indexing, int indexedFiles, int totalFiles, Instant lastIndexedAt) {
        this.indexing = indexing;
        this.indexedFiles = indexedFiles;
        this.totalFiles = totalFiles;
        this.lastIndexedAt = lastIndexedAt;
    }

    public SearchStatusDto(boolean indexing, int indexedFiles, int totalFiles, int failedFiles, int skippedFiles, Instant lastIndexedAt) {
        this.indexing = indexing;
        this.indexedFiles = indexedFiles;
        this.totalFiles = totalFiles;
        this.failedFiles = failedFiles;
        this.skippedFiles = skippedFiles;
        this.lastIndexedAt = lastIndexedAt;
    }

    public boolean isIndexing() {
        return indexing;
    }

    public void setIndexing(boolean indexing) {
        this.indexing = indexing;
    }

    public int getIndexedFiles() {
        return indexedFiles;
    }

    public void setIndexedFiles(int indexedFiles) {
        this.indexedFiles = indexedFiles;
    }

    public int getTotalFiles() {
        return totalFiles;
    }

    public void setTotalFiles(int totalFiles) {
        this.totalFiles = totalFiles;
    }

    public int getFailedFiles() {
        return failedFiles;
    }

    public void setFailedFiles(int failedFiles) {
        this.failedFiles = failedFiles;
    }

    public int getSkippedFiles() {
        return skippedFiles;
    }

    public void setSkippedFiles(int skippedFiles) {
        this.skippedFiles = skippedFiles;
    }

    public Instant getLastIndexedAt() {
        return lastIndexedAt;
    }

    public void setLastIndexedAt(Instant lastIndexedAt) {
        this.lastIndexedAt = lastIndexedAt;
    }
}
