package com.nexttyproa.dto;

import java.time.Instant;

public class NoteDto {

    private String path;
    private String title;
    private String content;
    private String tags;
    private Instant updatedAt;
    private String contentHash;
    private String encoding;
    private boolean hasBom;

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public String getTags() {
        return tags;
    }

    public void setTags(String tags) {
        this.tags = tags;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    public String getContentHash() {
        return contentHash;
    }

    public void setContentHash(String contentHash) {
        this.contentHash = contentHash;
    }

    public String getEncoding() {
        return encoding;
    }

    public void setEncoding(String encoding) {
        this.encoding = encoding;
    }

    public boolean isHasBom() {
        return hasBom;
    }

    public void setHasBom(boolean hasBom) {
        this.hasBom = hasBom;
    }
}
