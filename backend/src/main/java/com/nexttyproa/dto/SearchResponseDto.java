package com.nexttyproa.dto;

import java.util.List;

public class SearchResponseDto {

    private List<SearchResultDto> results;
    private int total;
    private int limit;
    private int offset;
    private String sort;

    public SearchResponseDto() {
    }

    public SearchResponseDto(List<SearchResultDto> results, int total, int limit, int offset, String sort) {
        this.results = results;
        this.total = total;
        this.limit = limit;
        this.offset = offset;
        this.sort = sort;
    }

    public List<SearchResultDto> getResults() {
        return results;
    }

    public void setResults(List<SearchResultDto> results) {
        this.results = results;
    }

    public int getTotal() {
        return total;
    }

    public void setTotal(int total) {
        this.total = total;
    }

    public int getLimit() {
        return limit;
    }

    public void setLimit(int limit) {
        this.limit = limit;
    }

    public int getOffset() {
        return offset;
    }

    public void setOffset(int offset) {
        this.offset = offset;
    }

    public String getSort() {
        return sort;
    }

    public void setSort(String sort) {
        this.sort = sort;
    }
}
