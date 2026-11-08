# V105-01: 打包版的启动时间和内存占用测量脚本

Status: resolved
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

### 完成情况（2026-11-08）

改动：

- `scripts/perf-measure.js`，根 `package.json` 加了 `perf:measure`。每一轮按上面 6 步做。工单没写死、实现时定下的几处：
  - **参照版本**：`results.json` 里不高于当前版本的最高版本。本轮要写入当前版本时把它自己排除，所以发布时比的是上一版。本轮不写入时（`--no-record`，或者这一版已有记录、又没加 `--replace`），比的是这一版已有的记录：02–05 开发途中 `package.json` 还是 1.0.4，比的就是这份基线。
  - **写入**：这一版已有记录时默认不覆盖，加 `--replace` 才覆盖。`--no-record` 只打印、只比较。
  - **版本核对**：打包版的 FileVersion 和 `package.json` 对不上时直接报错退出，否则数字会记到错的版本下。
  - **构建 commit**：取最近一次改动构建输入的提交（`frontend`、`backend`、`electron`、`build`、`package.json` 等，排除测试文件），并记下测量开始时还没提交的构建输入（`uncommittedBuildInputs`）。前提是打包版就是当前代码打的，所以测之前要先跑 `verify:release`。这次是 `c244a95`，没有未提交的构建输入。
  - **conhost.exe**：进程树里除了 Electron 的 5 个进程，还有 `java.exe` 的 `conhost.exe`（0.8MB）。任务管理器把它算在本应用这一组里，所以合计里有它，单列一行。第一次测基线时它被归进了「主进程」：每轮 `processCount` 是 6，分项却只有 5 类，由此发现。补了单元测试（红→绿）以后重测，基线以重测为准。
  - **安全检查**：每轮核实主进程命令行里有临时 user-data-dir，并且临时目录里确实生成了 `Local State`，否则这一轮作废。测前、测后各比一次真实 `settings.json` 的 SHA-256。临时目录逐项 `unlinkSync` 删除，删完核实。结束不掉的进程会报错。按 Ctrl+C 中断时也会结束进程、删临时目录。
  - **5000 篇工作区**只生成一次，各轮共用（每轮仍然是新的 user-data-dir），否则每轮要复制 5000 个文件。
- `scripts/perf-measure.test.js`，加了 `npm run test:perf`（单独的 `node --test`，不在 `npm test` 里）。
- `test/perf/results.json`：1.0.4 基线，含 `--big-vault` 那一组。
- spec「基线」一节换成这次的数字。
- CLAUDE.md「Development Commands」加了 `test:perf` 和 `perf:measure` 的说明（只测打包版、不拦发布、不在 `npm test` 和 `dist:verify` 里）。**CLAUDE.md 在 `.gitignore` 里（第 17 行），从来没被跟踪过**，所以这处改动只在本地文件里，不在提交里。

1.0.4 基线（完整口径，暖缓存 1 轮 + 3 轮取中位数；测前 `npm run verify:release` 通过，exe 的 FileVersion 是 1.0.4）：

- 启动时间 **4.76 秒**（三轮 5.34、4.76、4.73，暖缓存 5.60）。主窗口在 4.09 秒开始创建；后端从 JVM 启动到 Spring 就绪 3.49 秒，其中 Spring 2.70 秒。
- 内存占用 **305.6MB**：Java 后端 158.5，渲染进程 63.9，GPU 进程 47.8，主进程 27.7，网络服务 6.9，conhost 0.8。
- 5000 篇、39.4MB 的工作区：5.33 秒，452.2MB（Java 后端 291.1）。

和 spec 原来的基线对不对得上：

- 内存：在 scratchpad 里改了一份临时变体，去掉恢复的标签页、只等文件树（不提交），测出 280.7MB（渲染进程 49.2，GPU 进程 39.1），和 279MB 对得上。所以完整口径比 279MB 多出的约 27MB 里，恢复的那篇笔记约占 25MB，主要是渲染进程 +15MB、GPU 进程 +9MB。**按完整口径，离 220MB 的目标差 86MB，不是 59MB**，已写进 spec。
- 时间：只等文件树的变体是 5.23 秒（2 轮），两次完整测量分别是 4.76 秒和 4.89 秒，差别在噪声以内。1.0.4 的界面要等 `ready` 才渲染，而 `ready` 在恢复的笔记读完以后才置上，所以文件树和笔记正文在同一帧出现，算上笔记正文并不会更慢。

观察（没改工单定的做法）：只空跑一轮暖缓存时，第一轮正式测量总是明显偏慢。四次测量里，第一轮是 5.62、5.34、5.21、5.18 秒，第二、三轮是 4.73–4.89 秒。取 3 轮中位数时不受影响（中位数落在第二轮），但 `--rounds 1` 的数字会系统性偏高约 0.4 秒：拿它和基线比，得出 +9.6%。报改动前后的数字时不要用 `--rounds 1`。要不要改成空跑两轮，由用户决定。

单元测试红→绿（`npm run test:perf`）：

- **red**：先写测试，失败在 `Cannot find module './perf-measure'`，脚本还不存在。
- **green**：实现后 11/11 通过。
- **中间态**（证明断言起作用，改的是 scratchpad 里的副本）：阈值改成 0.18，「差 19% 不警告」那条失败；改成 0.22，「差 21% 警告」的两条失败；让没有参照时也返回比较结果，「没有上一版就不比较」那条失败。
- **conhost**：新增用例，red 失败在 `actual: 'main'`、`expected: 'conhost'`；修好后 12/12 通过。

用真实打包版跑过的分支（退出码都是 0）：第一次写入；`--replace` 覆盖；已有记录时不覆盖（`results.json` 的 SHA-256 前后都是 `d161344…`）；`--no-record`；和参照比较的输出；超过 20% 时的警告（临时把 1.0.4 的记录改小，跑完从备份还原，SHA-256 和改之前一致）。

回归：`npm run test:electron` 30/30，`npm run test:perf` 12/12。没有跑 `dist:verify`、`test:backend`、`test:frontend`：这次只新增了脚本、改了 `package.json` 的 `scripts`，不碰它们覆盖的代码（读 `package.json` 的 `test:electron` 已经跑过）。

真实设置文件 `%APPDATA%\NextTyproa\settings.json`：所有测量（试跑、两次基线、两次分支验证）前后的 SHA-256 都是 `5604701eb4c5dbbd6d7ec8caee310d1c15fd75d9a4ecbfe8fb6561304b21bfe6`。跑完以后机器上没有 `NextTypora.exe` 或 `java.exe` 进程，`%TEMP%` 下也没有残留的 `nexttypora-perf-*` 目录。
