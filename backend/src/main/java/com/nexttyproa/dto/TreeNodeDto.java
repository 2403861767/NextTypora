package com.nexttyproa.dto;

import java.util.ArrayList;
import java.util.List;

public class TreeNodeDto {

    private String name;
    private String path;
    private boolean directory;
    private List<TreeNodeDto> children = new ArrayList<>();

    public TreeNodeDto() {
    }

    public TreeNodeDto(String name, String path, boolean directory) {
        this.name = name;
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

    public List<TreeNodeDto> getChildren() {
        return children;
    }

    public void setChildren(List<TreeNodeDto> children) {
        this.children = children;
    }
}
