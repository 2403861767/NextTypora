package com.nexttyproa.controller;

import com.nexttyproa.dto.LegacyBackupScanDto;
import com.nexttyproa.service.LegacyBackupService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

@RestController
@RequestMapping("/api")
public class MaintenanceController {

    private final LegacyBackupService legacyBackupService;

    public MaintenanceController(LegacyBackupService legacyBackupService) {
        this.legacyBackupService = legacyBackupService;
    }

    /**
     * 报告工作区里残留的备份目录。只读：删除由渲染进程走系统回收站，见
     * {@code docs/adr/0001-no-save-time-backups.md}。
     */
    @GetMapping("/maintenance/legacy-backups")
    public LegacyBackupScanDto scanLegacyBackups() throws IOException {
        return legacyBackupService.scan();
    }
}
