package com.nexttyproa.dto;

import java.time.Instant;

public class SearchResultDto {

    private String path;
    private String title;
    private String snippet;
    private int lineNumber;
    private double score;
    private Instant updatedAt;

    public SearchResultDto() {
    }

    public SearchResultDto(String path, String title, String snippet, Instant updatedAt) {
        this(path, title, snippet, 1, 0.0, updatedAt);
    }

    public SearchResultDto(String path, String title, String snippet, int lineNumber, double score, Instant updatedAt) {
        this.path = path;
        this.title = title;
        this.snippet = snippet;
        this.lineNumber = lineNumber;
        this.score = score;
        this.updatedAt = updatedAt;
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

    public String getSnippet() {
        return snippet;
    }

    public void setSnippet(String snippet) {
        this.snippet = snippet;
    }

    public int getLineNumber() {
        return lineNumber;
    }

    public void setLineNumber(int lineNumber) {
        this.lineNumber = lineNumber;
    }

    public double getScore() {
        return score;
    }

    public void setScore(double score) {
        this.score = score;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
