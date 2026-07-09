package com.nexttyproa.controller;

import com.nexttyproa.dto.CreateFolderRequest;
import com.nexttyproa.dto.FileOperationDto;
import com.nexttyproa.dto.MovePathRequest;
import com.nexttyproa.dto.RenamePathRequest;
import com.nexttyproa.dto.TreeNodeDto;
import com.nexttyproa.service.FileSystemService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.List;

@RestController
@RequestMapping("/api")
public class FileSystemController {

    private final FileSystemService fileSystemService;

    public FileSystemController(FileSystemService fileSystemService) {
        this.fileSystemService = fileSystemService;
    }

    @PostMapping("/files/folder")
    public FileOperationDto createFolder(@Valid @RequestBody CreateFolderRequest request) throws IOException {
        return fileSystemService.createFolder(request);
    }

    @DeleteMapping("/files")
    public FileOperationDto deletePath(@RequestParam String path) throws IOException {
        return fileSystemService.deletePath(path);
    }

    @PutMapping("/files/rename")
    public FileOperationDto renamePath(@Valid @RequestBody RenamePathRequest request) throws IOException {
        return fileSystemService.renamePath(request);
    }

    @PutMapping("/files/move")
    public FileOperationDto movePath(@Valid @RequestBody MovePathRequest request) throws IOException {
        return fileSystemService.movePath(request);
    }

    @PostMapping("/tree/refresh")
    public List<TreeNodeDto> refreshTree() throws IOException {
        return fileSystemService.refreshTree();
    }
}
