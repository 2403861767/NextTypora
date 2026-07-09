package com.nexttyproa.dto;

public class FileOperationDto {

    private String name;
    private String path;
    private boolean directory;

    public FileOperationDto() {
    }

    public FileOperationDto(String path, boolean directory) {
        this.name = path.contains("/") ? path.substring(path.lastIndexOf('/') + 1) : path;
        this.path = path;
        this.directory = directory;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public boolean isDirectory() {
        return directory;
    }

    public void setDirectory(boolean directory) {
        this.directory = directory;
    }
}
