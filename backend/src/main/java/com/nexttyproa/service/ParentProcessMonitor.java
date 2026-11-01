package com.nexttyproa.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.LongPredicate;
import java.util.function.Supplier;

/**
 * 监控父进程（Electron 主进程）的存活状态。
 * 如果父进程不存在（异常退出或被强制杀死），自动关闭后端进程，防止孤儿进程。
 *
 * <p>三个外部交互点都做成了可注入的缝——读 PARENT_PID、判断进程是否存活、退出动作——
 * 否则这个类按构造就无法测试（见 BUG-P0-004：孤儿 JVM 占住端口导致应用无法重启）。
 * 只加这三个缝，不做更多：这是给一条真实风险补回归网，不是给 71 行的类做架构。
 */
@Service
public class ParentProcessMonitor {

    private static final Logger log = LoggerFactory.getLogger(ParentProcessMonitor.class);
    private static final long CHECK_INTERVAL_SECONDS = 5;

    private final Supplier<String> parentPidReader;
    private final LongPredicate processAlive;
    private final Runnable exitAction;

    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "parent-process-monitor");
        t.setDaemon(true);
        return t;
    });

    public ParentProcessMonitor() {
        this(
                () -> System.getenv("PARENT_PID"),
                pid -> ProcessHandle.of(pid).isPresent(),
                () -> {
                    // 延迟 1 秒后退出，确保日志输出。放在默认退出动作里，测试替换掉它就不会真的等。
                    try {
                        Thread.sleep(1000);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                    System.exit(0);
                });
    }

    ParentProcessMonitor(Supplier<String> parentPidReader, LongPredicate processAlive, Runnable exitAction) {
        this.parentPidReader = parentPidReader;
        this.processAlive = processAlive;
        this.exitAction = exitAction;
    }

    /**
     * 启动父进程监控。
     * 从环境变量 PARENT_PID 读取父进程 PID，如果不存在则跳过监控（兼容 dev 模式）。
     *
     * @return 是否真的启动了监控。开发模式下必须返回 false——否则后端会在开发时自己退出。
     */
    public boolean startMonitoring() {
        String parentPidStr = parentPidReader.get();
        if (parentPidStr == null || parentPidStr.isBlank()) {
            log.info("未检测到 PARENT_PID 环境变量，跳过父进程监控（可能是开发模式）");
            return false;
        }

        long parentPid;
        try {
            parentPid = Long.parseLong(parentPidStr.trim());
        } catch (NumberFormatException e) {
            log.warn("PARENT_PID 格式无效: {}", parentPidStr);
            return false;
        }

        log.info("启动父进程监控，父进程 PID: {}", parentPid);

        scheduler.scheduleAtFixedRate(() -> {
            try {
                checkParentProcess(parentPid);
            } catch (Exception e) {
                log.error("父进程检测异常", e);
            }
        }, CHECK_INTERVAL_SECONDS, CHECK_INTERVAL_SECONDS, TimeUnit.SECONDS);
        return true;
    }

    /** @return 父进程是否仍然存活；不存活时已经触发退出动作。 */
    boolean checkParentProcess(long parentPid) {
        if (processAlive.test(parentPid)) {
            return true;
        }
        log.warn("父进程 {} 已不存在，后端进程即将退出", parentPid);
        scheduler.shutdown();
        exitAction.run();
        return false;
    }
}
