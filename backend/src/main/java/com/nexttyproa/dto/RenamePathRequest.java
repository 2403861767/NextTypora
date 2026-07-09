package com.nexttyproa.dto;

import jakarta.validation.constraints.NotBlank;

public class RenamePathRequest {

    @NotBlank
    private String path;

    @NotBlank
    private String newName;

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public String getNewName() {
        return newName;
    }

    public void setNewName(String newName) {
        this.newName = newName;
    }
}
