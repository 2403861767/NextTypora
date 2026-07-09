package com.nexttyproa.dto;

import jakarta.validation.constraints.NotBlank;

public class ExportHtmlRequest {

    @NotBlank
    private String path;

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }
}
