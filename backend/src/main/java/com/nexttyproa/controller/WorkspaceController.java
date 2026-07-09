package com.nexttyproa.controller;

import com.nexttyproa.dto.TreeNodeDto;
import com.nexttyproa.dto.WorkspaceRequest;
import com.nexttyproa.service.WorkspaceService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class WorkspaceController {

    private final WorkspaceService workspaceService;

    public WorkspaceController(WorkspaceService workspaceService) {
        this.workspaceService = workspaceService;
    }

    @GetMapping("/workspace")
    public Map<String, String> getWorkspace() {
        return Map.of("path", workspaceService.getVaultPathString());
    }

    @PostMapping("/workspace")
    public Map<String, String> setWorkspace(@Valid @RequestBody WorkspaceRequest request) throws IOException {
        workspaceService.setVaultPath(request.getPath());
        return Map.of("path", workspaceService.getVaultPathString());
    }

    @GetMapping("/tree")
    public List<TreeNodeDto> getTree() throws IOException {
        return workspaceService.buildTree();
    }
}
