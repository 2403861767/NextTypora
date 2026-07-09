package com.nexttyproa.controller;

import com.nexttyproa.service.AssetService;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class AssetController {

    private final AssetService assetService;

    public AssetController(AssetService assetService) {
        this.assetService = assetService;
    }

    @PostMapping(value = "/asset", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, String> uploadAsset(
            @RequestParam String notePath,
            @RequestParam("file") MultipartFile file) throws IOException {
        AssetService.UploadResult result = assetService.uploadAsset(notePath, file);
        return Map.of(
                "path", result.path(),
                "markdownRef", result.markdownRef()
        );
    }

    @GetMapping("/asset")
    public ResponseEntity<Resource> getAsset(@RequestParam String path) throws IOException {
        Resource resource = assetService.readAsset(path);
        Path filePath = Path.of(resource.getURI());
        MediaType mediaType = assetService.mediaTypeFor(filePath);
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=3600")
                .contentType(mediaType)
                .body(resource);
    }
}
