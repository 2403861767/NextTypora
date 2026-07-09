package com.nexttyproa.dto;

import jakarta.validation.constraints.NotBlank;

public class SaveNoteRequest {

    @NotBlank
    private String path;

    private String content = "";
    private String baseHash;
    private boolean force;
    private String encoding;
    private Boolean hasBom;

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public String getBaseHash() {
        return baseHash;
    }

    public void setBaseHash(String baseHash) {
        this.baseHash = baseHash;
    }

    public boolean isForce() {
        return force;
    }

    public void setForce(boolean force) {
        this.force = force;
    }

    public String getEncoding() {
        return encoding;
    }

    public void setEncoding(String encoding) {
        this.encoding = encoding;
    }

    public Boolean getHasBom() {
        return hasBom;
    }

    public void setHasBom(Boolean hasBom) {
        this.hasBom = hasBom;
    }
}
