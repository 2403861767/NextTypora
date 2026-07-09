package com.nexttyproa.dto;

import jakarta.validation.constraints.NotBlank;

public class CreateNoteRequest {

    @NotBlank
    private String path;

    private String content = "";

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
}
