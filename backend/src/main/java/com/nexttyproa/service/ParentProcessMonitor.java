package com.nexttyproa.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 监控父进程（Electron 主进程）的存活状态。
 * 如果父进程不存在（异常退出或被强制杀死），自动关闭后端进程，防止孤儿进程。
 */
@Service
public class ParentProcessMonitor {

    private static final Logger log = LoggerFactory.getLogger(ParentProcessMonitor.class);
    private static final long CHECK_INTERVAL_SECONDS = 5;

    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "parent-process-monitor");
        t.setDaemon(true);
        return t;
    });

    /**
     * 启动父进程监控。
     * 从环境变量 PARENT_PID 读取父进程 PID，如果不存在则跳过监控（兼容 dev 模式）。
     */
    public void startMonitoring() {
        String parentPidStr = System.getenv("PARENT_PID");
        if (parentPidStr == null || parentPidStr.isBlank()) {
            log.info("未检测到 PARENT_PID 环境变量，跳过父进程监控（可能是开发模式）");
            return;
        }

        long parentPid;
        try {
            parentPid = Long.parseLong(parentPidStr.trim());
        } catch (NumberFormatException e) {
            log.warn("PARENT_PID 格式无效: {}", parentPidStr);
            return;
        }

        log.info("启动父进程监控，父进程 PID: {}", parentPid);

        scheduler.scheduleAtFixedRate(() -> {
            try {
                checkParentProcess(parentPid);
            } catch (Exception e) {
                log.error("父进程检测异常", e);
            }
        }, CHECK_INTERVAL_SECONDS, CHECK_INTERVAL_SECONDS, TimeUnit.SECONDS);
    }

    private void checkParentProcess(long parentPid) {
        boolean alive = ProcessHandle.of(parentPid).isPresent();
        if (!alive) {
            log.warn("父进程 {} 已不存在，后端进程即将退出", parentPid);
            scheduler.shutdown();
            // 延迟 1 秒后退出，确保日志输出
            try {
                Thread.sleep(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            System.exit(0);
        }
    }
}
