package com.nexttyproa.controller;

import com.nexttyproa.dto.ExportHtmlDto;
import com.nexttyproa.dto.ExportHtmlRequest;
import com.nexttyproa.service.ExportService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

@RestController
@RequestMapping("/api/export")
public class ExportController {

    private final ExportService exportService;

    public ExportController(ExportService exportService) {
        this.exportService = exportService;
    }

    @PostMapping("/html")
    public ExportHtmlDto exportHtml(@Valid @RequestBody ExportHtmlRequest request) throws IOException {
        return exportService.exportHtml(request);
    }
}
