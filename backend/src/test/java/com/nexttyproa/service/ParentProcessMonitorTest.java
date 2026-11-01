package com.nexttyproa.service;

import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.LongPredicate;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * BUG-P0-004：Electron 被强杀后，后端 JVM 变成孤儿进程占住端口，应用无法重启。
 * 这个守卫是当时的修复，但在 V103-14 之前零覆盖——而它最危险的分支恰恰是"开发模式要跳过"。
 */
class ParentProcessMonitorTest {

    /** 记录退出动作被触发了几次；真实实现会 System.exit(0)，测试里当然不能真退。 */
    private final AtomicInteger exits = new AtomicInteger();

    private ParentProcessMonitor monitor(String parentPid, LongPredicate alive) {
        Supplier<String> reader = () -> parentPid;
        return new ParentProcessMonitor(reader, alive, exits::incrementAndGet);
    }

    // 开发模式：npm run dev 不传 PARENT_PID。这条分支要是回归了，后端会在开发时自己退出。
    @Test
    void doesNotMonitorWithoutAParentPid() {
        assertFalse(monitor(null, pid -> true).startMonitoring());
        assertFalse(monitor("", pid -> true).startMonitoring());
        assertFalse(monitor("   ", pid -> true).startMonitoring());
        assertEquals(0, exits.get());
    }

    @Test
    void doesNotMonitorWhenTheParentPidIsNotANumber() {
        assertFalse(monitor("not-a-pid", pid -> true).startMonitoring());
        assertEquals(0, exits.get());
    }

    @Test
    void startsMonitoringForAValidParentPid() {
        assertTrue(monitor(" 4321 ", pid -> true).startMonitoring());
    }

    @Test
    void keepsRunningWhileTheParentIsAlive() {
        ParentProcessMonitor parentMonitor = monitor("4321", pid -> true);

        assertTrue(parentMonitor.checkParentProcess(4321L));
        assertEquals(0, exits.get(), "父进程还在时不该退出");
    }

    @Test
    void exitsOnceTheParentIsGone() {
        ParentProcessMonitor parentMonitor = monitor("4321", pid -> false);

        assertFalse(parentMonitor.checkParentProcess(4321L));
        assertEquals(1, exits.get());
    }

    // 传进来的 PID 要真的被用上，而不是查了别的进程
    @Test
    void checksTheParentPidItWasGiven() {
        AtomicInteger checked = new AtomicInteger();
        ParentProcessMonitor parentMonitor = monitor("4321", pid -> {
            checked.set((int) pid);
            return true;
        });

        parentMonitor.checkParentProcess(4321L);

        assertEquals(4321, checked.get());
    }
}
