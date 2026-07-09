package com.nexttyproa.dto;

public class ExportHtmlDto {

    private String path;
    private String title;
    private String html;

    public ExportHtmlDto() {
    }

    public ExportHtmlDto(String path, String title, String html) {
        this.path = path;
        this.title = title;
        this.html = html;
    }

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

    public String getHtml() {
        return html;
    }

    public void setHtml(String html) {
        this.html = html;
    }
}
