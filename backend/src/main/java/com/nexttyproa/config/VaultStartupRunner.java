package com.nexttyproa.config;

import com.nexttyproa.service.IndexService;
import com.nexttyproa.service.WorkspaceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.nio.file.Path;

@Component
public class VaultStartupRunner {

    private static final Logger log = LoggerFactory.getLogger(VaultStartupRunner.class);

    private final AppProperties appProperties;
    private final WorkspaceService workspaceService;
    private final IndexService indexService;

    public VaultStartupRunner(AppProperties appProperties, WorkspaceService workspaceService, IndexService indexService) {
        this.appProperties = appProperties;
        this.workspaceService = workspaceService;
        this.indexService = indexService;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        String vaultPath = appProperties.getVaultPath();
        if (vaultPath == null || vaultPath.isBlank()) {
            return;
        }
        Path root = workspaceService.getVaultRoot();
        if (root == null) {
            return;
        }
        try {
            indexService.reindexVault(root);
            log.info("Reindexed vault at startup: {}", root);
        } catch (Exception e) {
            log.warn("Failed to reindex vault at startup: {}", e.getMessage());
        }
    }
}
