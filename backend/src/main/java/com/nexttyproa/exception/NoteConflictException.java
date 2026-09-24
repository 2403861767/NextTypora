package com.nexttyproa.exception;

import java.time.Instant;

public class NoteConflictException extends RuntimeException {
    private final String path;
    private final String currentHash;
    private final Instant currentUpdatedAt;

    public NoteConflictException(String message, String path, String currentHash, Instant currentUpdatedAt) {
        super(message);
        this.path = path;
        this.currentHash = currentHash;
        this.currentUpdatedAt = currentUpdatedAt;
    }

    public String getPath() {
        return path;
    }

    public String getCurrentHash() {
        return currentHash;
    }

    public Instant getCurrentUpdatedAt() {
        return currentUpdatedAt;
    }
}
