# V103-14: ParentProcessMonitor 加缝并补测三条分支

Status: ready-for-agent
Type: Change
Commit prefix: `Change V103-14:`
Spec section: 11（见 ../spec.md）

## 背景

当前行覆盖 21.2%，且**按构造无法测试**：直接读 `System.getenv("PARENT_PID")`、`checkParentProcess` 为 private、写死 `ProcessHandle.of()`、内含 `Thread.sleep(1000)` 与 `System.exit(0)`。

失效模式历史上真的发生过（`BUG-P0-004`，孤儿 JVM 占住端口导致应用无法重启）。

## 改动

抽出「存活判断」与「退出动作」两个缝，测三条分支：

1. `PARENT_PID` 空或非法 → 不启动监控（开发模式不能自杀）
2. 父进程存活 → 继续
3. 父进程消失 → 触发退出动作

**只加两个缝，不做更多**：这是补一条真实风险的回归网，不是给一个 71 行的类做架构。

## 验收

三条分支都有测试；其中第 1 条最关键——若「开发模式跳过」分支回归，后端会在开发时自己退出，而现在零覆盖。

## Comments
