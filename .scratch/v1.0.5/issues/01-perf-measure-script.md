# V105-01: 打包版的启动时间和内存占用测量脚本

Status: ready-for-agent
Type: Change
Commit prefix: `Change V105-01:`
Spec section: 口径、基线、目标（见 ../spec.md）
Blocked by: 无

## 背景

1.0.5 的目标是两个数字：启动时间 ≤ 2.0 秒、内存占用 ≤ 220MB（口径见 `GLOSSARY.md`）。现在仓库里没有任何能测这两个数的东西。spec 里的基线是 grilling 时用临时脚本测的，而且只测到「文件树出现」，没算上次打开的笔记正文。

后面 02–05 每张票都要报改动前后的数字，所以这张票最先做。

## 决定（2026-11-08 grilling）

- 只测打包版（`release/win-unpacked/NextTypora.exe`），开发版的数字不算。
- 只报告和警告，**不拦发布**，计时有噪声。比上一版差 20% 以上时打印警告。
- 不放进 `npm test`，也不放进 `dist:verify`：`dist:verify` 在打包之前跑，测不到打包版。发布验证时手动跑一次，数字写进 spec。

## 改动

新增 `scripts/perf-measure.js`，在根 `package.json` 里加上 `"perf:measure": "node scripts/perf-measure.js"`。

每一轮测量：

1. 把 `test/e2e-vault` 复制到系统临时目录（不能原地用，见 CLAUDE.md「Manual retest fixtures」）。新建一个空的 user-data-dir，写入 `settings.json`：`lastWorkspace` 指向这份副本，`openTabs`、`activeTabPath`、`openTabsWorkspace` 恢复一篇已知笔记（字段见 `electron/ipcValidation.js` 的 `SETTINGS_FIELDS`）。
2. 用参数数组启动 exe（不要经过 `cmd.exe` 转一道，否则可能用上真实的 `%APPDATA%\NextTyproa`），带上 `--user-data-dir=<临时目录>` 和 `--remote-debugging-port=<端口>`。从调用 spawn 的那一刻开始计时。
3. 轮询 CDP 的 `/json/list`，**连接 `file://` 的页面目标，不要连 `data:` 开头的那个**。启动画面也是一个 page 目标，它关闭以后，后续的 `Runtime.evaluate` 会一直挂到超时（见 memory 里的打包版测试经验）。V105-02 去掉启动画面以后这个问题就没了，但脚本要两种情况都能处理，因为要拿它测 1.0.4 的基线。
4. 启动时间的终点：文件树里出现已知笔记名，**并且**编辑区里出现那篇恢复的笔记正文中的一段已知文字。
5. 空闲 20 秒后读内存占用：取这个 exe 的整棵进程树（主进程、GPU、网络服务、渲染进程、`java.exe`），对每个进程取 `Win32_PerfFormattedData_PerfProc_Process.WorkingSetPrivate` 再求和。同时按进程分项输出。
6. 结束所有进程，删掉临时目录。Node 24 的 `fs.rmSync` 遇到中文路径会静默不删，要用 `unlinkSync` 删并核实；e2e-vault 里有中文文件名。

默认测 3 轮热启动，取中位数，第一轮之前先空跑一轮暖缓存。加 `--big-vault` 参数时，另外生成一个 5000 篇（约 40MB）的工作区再测一组，只记录。

输出：

- 终端打印一张表：启动时间，内存占用合计，各进程分项。
- 结果追加到 `test/perf/results.json`（提交进仓库），以 `package.json` 的版本号为键，带上日期、机器（CPU、内存）和构建 commit。
- 和 `results.json` 里上一个版本的数字比：启动时间或内存占用差 20% 以上就打印警告，退出码仍然是 0。

比较逻辑抽成纯函数，写单元测试（放进 `npm run test:electron` 会跑的位置，或者给 scripts 单独加一个 `node --test`）。

## 验收

- 用当前的 1.0.4 构建跑一次，结果和 spec 基线对得上（文件树约 5.0 秒，算上笔记正文会再慢一点；内存约 279MB）。把这次的数字作为 1.0.4 的基线写进 `results.json`，同时更新 spec「基线」一节，换成完整口径下的数字。
- 比较函数的单元测试覆盖：差 19%（不警告）、差 21%（警告）、没有上一版（不比较）。
- 跑完以后，真实的 `%APPDATA%\NextTyproa\settings.json` 前后 SHA-256 相同，机器上没有残留的 `NextTypora.exe` 或 `java.exe` 进程。
- CLAUDE.md 的「Development Commands」里加上 `perf:measure`，写明它只测打包版、不拦发布。

## Comments
