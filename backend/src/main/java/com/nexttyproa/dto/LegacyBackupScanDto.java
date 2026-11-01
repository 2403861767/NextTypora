package com.nexttyproa.dto;

import java.util.List;

/**
 * 工作区里残留的 {@code .nexttyproa-backups/} 目录清单。只用于"先报数再动手"：
 * 删除动作由渲染进程交给系统回收站，后端不删任何东西。
 */
public class LegacyBackupScanDto {

    private List<Entry> directories;
    private long totalBytes;

    public LegacyBackupScanDto() {
    }

    public LegacyBackupScanDto(List<Entry> directories, long totalBytes) {
        this.directories = directories;
        this.totalBytes = totalBytes;
    }

    public List<Entry> getDirectories() {
        return directories;
    }

    public void setDirectories(List<Entry> directories) {
        this.directories = directories;
    }

    public long getTotalBytes() {
        return totalBytes;
    }

    public void setTotalBytes(long totalBytes) {
        this.totalBytes = totalBytes;
    }

    public static class Entry {

        private String path;
        private int fileCount;
        private long bytes;

        public Entry() {
        }

        public Entry(String path, int fileCount, long bytes) {
            this.path = path;
            this.fileCount = fileCount;
            this.bytes = bytes;
        }

        /** 相对于工作区根目录，正斜杠分隔——可以直接交给 file:trashItem。 */
        public String getPath() {
            return path;
        }

        public void setPath(String path) {
            this.path = path;
        }

        public int getFileCount() {
            return fileCount;
        }

        public void setFileCount(int fileCount) {
            this.fileCount = fileCount;
        }

        public long getBytes() {
            return bytes;
        }

        public void setBytes(long bytes) {
            this.bytes = bytes;
        }
    }
}
