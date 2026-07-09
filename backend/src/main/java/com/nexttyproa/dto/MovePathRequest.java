package com.nexttyproa.dto;

import jakarta.validation.constraints.NotBlank;

public class MovePathRequest {

    @NotBlank
    private String path;

    private String targetFolder = "";

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public String getTargetFolder() {
        return targetFolder;
    }

    public void setTargetFolder(String targetFolder) {
        this.targetFolder = targetFolder;
    }
}
