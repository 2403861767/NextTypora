# V103-14: ParentProcessMonitor 加缝并补测三条分支

Status: resolved
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

- 前置阻塞已解除：新建 `ParentProcessMonitorTest.java` 原本会被 `.gitignore` 的 `test/` 静默忽略，该规则已锚定为 `/test/`（见 V103-16）。

## 完成情况（2026-11-01）

加了三个缝（票里说两个，实际需要三个——读 PARENT_PID 这一步同样是硬编码的外部交互）：

```java
ParentProcessMonitor(Supplier<String> parentPidReader,
                     LongPredicate processAlive,
                     Runnable exitAction)
```

无参构造保持生产行为不变：`System.getenv("PARENT_PID")`、`ProcessHandle.of(pid).isPresent()`、以及"睡 1 秒再 `System.exit(0)`"。**那句 `Thread.sleep(1000)` 挪进了默认退出动作里**——否则测试替换掉退出动作后仍然会真的等 1 秒。

另外两处最小改动：`startMonitoring()` 返回 `boolean`（是否真的启动了监控），`checkParentProcess` 从 private 放宽到包级可见并返回父进程是否存活。现有调用方 `NextTyproaApplication:37` 忽略返回值，不受影响。

### 覆盖的六条

1. `PARENT_PID` 为 null / 空串 / 全空白 → 不启动监控
2. `PARENT_PID` 不是数字 → 不启动监控
3. 合法 PID（含首尾空格）→ 启动监控
4. 父进程存活 → 继续，且**不触发退出**
5. 父进程消失 → 触发退出动作一次
6. 传进去的 PID 确实被用来查询，而不是查了别的进程

第 1 条最关键：`npm run dev` 不传 `PARENT_PID`，这条分支一旦回归，后端会在开发时自己退出。

### 覆盖率

| | 之前 | 现在 |
| --- | --- | --- |
| `ParentProcessMonitor` 行覆盖 | 21.2% | **72.1%** |
| `com.nexttyproa.service` 包 | 89.4% | 90.9% |

剩下未覆盖的是无参构造里那三个 lambda 的内部——真实的 `getenv`、`ProcessHandle`、`System.exit`。要覆盖它们就得真的让 JVM 退出，不值得；缝的意义本来就是把它们隔离到一行之内。

全量 `npm test`：Electron 29 + 后端 **138** + 前端 208，退出码 0。
