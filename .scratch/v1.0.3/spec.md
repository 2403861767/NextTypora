# NextTypora 1.0.3 — 减法与发布卫生

Status: ready-for-agent

## 本版主题

**消灭项目里「说话不算数」的地方。** 不加新功能。

1.0.2 之前的状态：文档写的快捷键按不出来、声称的「全量验证」漏掉 216 个用例、宣传的菜单在唯一发布平台上不存在、版本号是手工改的文件名、被列为「⚠️ 关键安全规则」的那条防线从未被真正验证过（而且确实有漏洞）。

先把这些修平，下一版加功能才站得住。

## 范围（按优先级）

### 1. 安全：`resolveSafe` 路径逃逸（首要项）

`FileService.resolveSafe()` 的第三层防线用 `Files.isSymbolicLink()` 逐段检查，**但它对 Windows 目录联接（junction）返回 `false`**，于是 junction 可以把路径指向金库外面而不被拒绝。

实测证据（2026-11-01，本机）：

```
isSymbolicLink(junction)       = false      ← 守卫漏过
startsWith(root)               = true       ← 路径字符串看着在金库里
resolveSafe would REJECT       = false      ← 三层防线全部放行
toRealPath escapes root        = true       ← 实际指向金库外
content readable               = SECRET     ← 金库外文件被成功读出
```

**方向是反的**：`mklink /J` 建 junction 无需任何权限（实测 exit 0）；而建符号链接需要管理员权限（实测在本机失败，报 Administrator privilege required）。拦得住的那种难以创建，容易创建的那种拦不住。

修复：在逐段循环里，除 `isSymbolicLink` 外再加一条「该段存在且 `readAttributes(..., NOFOLLOW_LINKS).isOther()` 为真则拒绝」，把所有重解析点（junction、符号链接、挂载点）一并挡掉。

- 选 `isOther()` 而不是 `toRealPath().startsWith(root)`：后者要求路径已存在，会让「新建文件」通路抛 `NoSuchFileException`。`isOther()` 对普通文件和目录均为 `false`，对 junction 实测为 `true`。
- 同步修正 `CLAUDE.md` 规则 1 的措辞：从 prevents `../` attacks and symlink escapes 改为「拒绝 `..`、符号链接与所有重解析点」。

严重性校准：不是提权漏洞，应用本来就以用户身份运行。它的含义是「应用可以被骗到金库外面读写」，前提是攻击者先把一个 junction 放进用户的金库——现实路径是从不可信来源解压的笔记库、网盘同步目录、别人给的 zip。真实但不紧急的沙箱逃逸。

### 2. 移除保存时备份

`.nexttyproa-backups/` 是**只写不读**的目录：每次保存已存在的笔记都复制一份（配合 800ms 防抖自动保存会反复刷满 10 个槽位），而全仓库没有任何读取方——没有恢复入口，用户只能自己去文件管理器翻。

它不是冲突保护。冲突走的是独立的 `*.conflict-<时间戳>.md` 可见副本；删除走系统回收站。删掉它不动另外两道防线。

- 删除 `backupFile`、`pruneBackups`、`parseBackupTimestamp`、`BACKUP_DIR_NAME`、`MAX_BACKUPS_PER_FILE`、`BACKUP_TIMESTAMP`。
- `writeFileAtomic` 收敛掉 `backupExisting` 参数。
- 测试：`FileServiceTest.keepsOnlyNewestBackups` 直接删；`electron/main.test.js` 与 `App.test.tsx` 中「删文件夹时隐藏子目录一起进回收站 / 文件树不显示点开头条目」的用例**只换夹具**（改用 `.assets` 等通用隐藏目录），保留覆盖——它们测的是隐藏目录的通用处理，借备份当夹具而已。
- `CLAUDE.md` 关键安全规则第 4 条改为只讲编码保留与原子写，并显式加一句「保存时不做备份，这是刻意的决定，见 `docs/adr/0001-no-save-time-backups.md`」。**这句必须加**，否则下一个 agent 会把备份加回来。

顺带：删掉备份同时缩小了第 1 项的爆炸半径——`backupFile()` 原本用 `file.getParent().resolve(".nexttyproa-backups")`，经由 junction 会把备份也写到金库外面。

### 3. 旧备份目录的清理入口

设置弹窗新增**存储**区块：递归扫描**当前工作区**，找出所有 `.nexttyproa-backups/`，显示「找到 N 个目录、共 X MB」，用户确认后整体移到**系统回收站**（复用 `file:trashItem`）。

三条约束：只扫当前工作区（不碰用户别的磁盘位置）、先报数再动手（用户看得见要删什么）、走回收站（可撤销）。**不做首次启动自动弹窗**——升级后第一次打开就被质问「要不要删你的文件」，观感像流氓软件。

### 4. 版本号收敛与可见

现状：`package.json` 从未被 bump（唯一一次设置是 `ed859ea` 的 `1.0.0`），而 `release/` 里躺着 `NextTyproa-1.0.2-win-x64.exe`——那是 electron-builder 按 `1.0.0` 命名后**手工改名**的产物（`latest.yml` 记录的 `1.0.0` 条目大小 `169835705` 与该 exe 字节数完全一致，`1.0.0` 的 `.blockmap` 孤零零留在原地，exe 的 PE 元数据 `FileVersion`/`ProductVersion` 仍是 `1.0.0`）。代码是对的（构建发生在 `ba867ca` 之后两分钟），错的只是版本号。

且 `backend-1.0.0.jar` 被硬编码在 `scripts/copy-backend-jar.js:4` 和 `scripts/verify-dist-resources.js:7`——**「把版本号改对」这个动作本身会把构建弄断**。

三步：

1. `backend/pom.xml` 加 `<finalName>backend</finalName>`，产出永远是 `backend.jar`，与版本无关；两个脚本里的 `backend-1.0.0.jar` 改成 `backend.jar`。**这一步消灭整类问题**，而不是绕过它。
2. `package.json` 的 version 改为 `1.0.3`，它是唯一喂给 electron-builder 产物名与 `app.getVersion()` 的来源。`frontend/package.json` 与 `pom.xml` 的 version 从此与用户可见版本无关。
3. `verify-dist-resources.js` 增加**值**校验：`package.json` 的 version 必须等于显式传入的期望版本（命令行参数或环境变量），不一致直接 fail。要求显式传入而非读 git tag，因为打包往往发生在打 tag 之前——让人把版本号说一遍，是让「我在发 1.0.3」被机器确认一次的机会。

（现有的 `verify-dist-resources.js:33` 已经在检查 `artifactName` **含不含** `${version}` 模板，却从不检查值是什么。校验了模板、漏掉了值，正是这个洞。）

设置弹窗新增**关于**区块，显示 `app.getVersion()` 的真实版本号。现状是应用里**完全看不到版本号**——没有关于对话框，`app.getVersion()` 从未被调用。

### 5. 导出保真：数学公式

编辑器里 `$E=mc^2$` 经 `Crepe.Feature.Latex` + KaTeX 正常渲染，但导出 HTML/PDF 后**静默变成纯文本**：`ExportService` 注册的 6 个 flexmark 扩展里没有数学扩展，模板里没有 KaTeX。

**不走后端**：`flexmark-all` 0.64.8 的全部 40 个扩展里没有任何数学扩展，Java 侧也没有 LaTeX→MathML 转换器。

方案：数学公式在**前端**用已有的 KaTeX 渲染成 MathML，后端 `ExportService` 一行不动。

- `katex@0.17.0` 已是前端依赖，其类型定义为 `output?: "html" | "mathml" | "htmlAndMathml"`，运行时确实处理 `output === "mathml"`。纯 MathML = 零 CSS、零 JS、零字体、完全自包含。
- 导出的 HTML 本来就流经渲染进程（`App.tsx:1277` 从后端取 HTML，PDF 再经 IPC 交给 Electron 隐藏窗口），渲染进程是天然挂载点，**不需要新增任何依赖**。
- 约束：`ExportServiceTest.java:97` 断言导出 HTML 不得引用 CDN，必须保持。
- 收益：编辑器与导出由**同一个 KaTeX** 保证所见即所得，而非两套渲染器碰巧对齐。
- 代价：markdown→最终产物这条链被切成两层（后端管结构、前端管保真）。见 `docs/adr/0003-export-fidelity-in-renderer.md`。

### 6. 删除死代码与修正文档不符

- **Mermaid 死机械**：`ExportService.java:212` 无条件把 `window.__NEXTTYPROA_MERMAID_DONE__` 设为 `true`，于是 `main.js:896-914` 那个轮询该标志的 `waitForMermaidRender` 第一个 tick 就返回，什么都没等。删掉这 19 行。（导出不渲染 Mermaid 是刻意的本地优先决定，README 已诚实写「Mermaid 源块」。）
- **macOS 专属菜单模板**：`main.js:510-514` 只在 darwin 下 `setApplicationMenu`，Windows 下为 `null`；而发布目标只有 Windows。模板里 9 个加速键是死代码，同一批快捷键在 `shortcuts.ts` 又定义了一遍。删模板，快捷键以渲染进程为唯一真相。
- **README 修正**：`:195` 打字机模式写 `Ctrl+Alt+T` 而实际是 `Ctrl+Shift+T`（照文档按按不出来）；`:73` 在卖 `NextTyproa-win-x64.zip` 而 `release/` 里没有 zip；`:31` 宣传「窗口菜单」而 Windows 上没有菜单栏。

### 7. 改名：显示名与应用身份分离

现状两个拼法并存且**错拼的那个在出货**：`productName`/`appId`/Java 包名/环境变量/`index.html` 的 `<title>`/README 标题全是 `NextTyproa`（`yp` 颠倒），只有启动闪屏 `main.js:221` 的 `<h1>NextTypora</h1>` 是对的——**用户看到的第一屏和任务栏是两个名字**。

陷阱：`electron/main.js` 所有设置读写都挂在 `app.getPath('userData')`（`:270`、`:616`、`:620`、`:646`、`:653`），导入主题在 `userData/themes`（`:369`），而 `app.setName()` / `app.setPath()` 从未被调用。Electron 的 userData 路径是 `%APPDATA%/<app.getName()>`，`getName()` 取的就是 `productName`。**光改 `productName` 就会把设置目录搬走**，用户的主题、自定义快捷键、最近工作区、打开的标签页全部丢失。

方案：显示层改为正确的 `NextTypora`（`productName`、`<title>`、README、错误弹窗），**同时显式调用 `app.setName('NextTyproa')` 把 userData 路径钉死在旧位置**；`appId` 与 Java 包名不动。用户看到对的名字，设置一个不丢，安装升级路径不变。

那行 `app.setName('NextTyproa')` 看起来像个错误，见 `docs/adr/0002-display-name-vs-app-identity.md`。

### 8. 测试与验证流程

- 新增 root `npm test` = 前端 vitest + Electron + 打包测试 + 后端 `mvn test`。现在**没有** root `npm test`，跑全套要三次手工调用。
- `dist:verify` 变成真正的全量：`npm test` → `npm run build` → `verify-dist-resources.js`（带版本值校验）。现状是 `mvn test && npm run build && verify-dist-resources.js`，**漏掉 190 个前端用例和 26 个 Electron 用例**，而 `CLAUDE.md:23` 把它写成 Full verification before packaging。
- 覆盖率 gate 单独走 `npm run test:coverage` = `mvn verify`，**不放进 `dist:verify`**：`mvn verify` 会连带再 package 一次，而 `dist:verify` 里的 `npm run build` 已经 package 过了。且该 gate 设 80%、实测 89.4%，不是濒临失败的线，适合按需跑而非挂在发布关键路径上拖时间。

### 9. 项目记录恢复

`BUG_BACKLOG.md`（660 行）与 `BUG_BACKLOG_REAL_WORLD.md`（754 行）在 `ba867ca` 被整体删除并写进 `.gitignore:25-26`，磁盘上也不存在，只能用 `git show ba867ca^:<file>` 取回。两份里**未关闭条目为 0**——54 条全部 `[x]`，不是「有 bug 被埋了」，是「缺陷史被扔了」。

- 恢复为 `docs/history/` 下的归档，并从 `.gitignore` 删掉那两行。
- 同时删掉 `.gitignore` 里的 `test/`——e2e 夹具就是这么丢的。

理由：那 54 条记录是这个产品踩过的全部坑（编码检测、路径穿越、per-path 锁、孤儿进程、标签页恢复）。`CLAUDE.md` 里那些「⚠️ 关键安全规则」的**理由**就在这两份文件里，规则本身已经脱离了证据。而且其中的「未能覆盖」清单是现成的、唯一的回归测试计划。

### 10. 打包版最小复测集

那份真实场景清单明确要求「修复后需要在打包版上把本清单全部复测一遍」，**无证据显示发生过**，且复测夹具在 `799a03f` 被删。不恢复全部 27 项，只跑 6 项真正只能在打包版上验证的：

1. NSIS 安装
2. `.md` 文件关联（历史上只测过 `win-unpacked`，安装版从未测）
3. 原生对话框（打开文件夹 / 导出另存为）
4. 真实中文输入法联想（历史上用 CDP `Input.insertText` 代替过）
5. 从资源管理器真实拖拽图片（历史上用合成粘贴代替过）
6. Alt+F4 退出时保存

夹具重建一个小的（GBK / Big5 / UTF-16 / CJK 文件名各一个）并**提交进仓库**。

共同点：这 6 项在开发模式下永远测不出来——历史上 `RW-P0-001` 就是只在打包版出现的阻断性缺陷。多显示器、万级 vault 性能、打印推迟。

### 11. 测试加固（待确认）

- **符号链接测试不再可以静默消失**：`FileServiceTest.java:74-85` 在 `Files.createSymbolicLink` 失败时执行 `assumeTrue(false)`，而本机实测符号链接创建就是失败的——**这条唯一覆盖头号安全规则的测试从未真正跑过，一次都没有**。新增用 `cmd /c mklink /J` 建 junction 的用例（实测无需提权），保留符号链接用例但降级为「能建就测」；当两种链接都建不出来时**测试应当失败而非静默通过**。
  一条可以静默消失的安全测试比没有测试更坏，因为它让人以为有覆盖——这正是本次漏洞被藏住的原因。
- **`ParentProcessMonitor` 补测**：当前行覆盖 21.2%，且**按构造无法测试**（直接读 `System.getenv("PARENT_PID")`、`checkParentProcess` 为 private、写死 `ProcessHandle.of()`、内含 `Thread.sleep(1000)` 与 `System.exit(0)`）。抽出「存活判断」与「退出动作」两个缝，测三条分支：PARENT_PID 空/非法 → 不启动监控；父进程存活 → 继续；父进程消失 → 触发退出。
  只加两个缝，不做更多。失效模式历史上真的发生过（`BUG-P0-004`，孤儿 JVM 占住端口导致无法重启），而最危险的是第一条——**若「开发模式跳过」分支回归，后端会在开发时自己退出**，现在零覆盖。
- **`CodeBlockPreview.test.ts:48` 脆弱用例**：全量跑时被挤出 5 秒超时（单独跑 1.87 秒通过）。**改用例本身**（它等的是 Promise 链而非真实时间），不调高全局 `testTimeout`——调高会让将来真正卡死的用例反馈更慢，而全量跑已经要 108 秒，这是一个没有 CI 的项目最不该牺牲的东西。

## 本版不做（显式推迟，不是遗漏）

记录这一节的理由不是形式主义：上一次把 1414 行记录删掉，导致这次要把整个项目重新盘点一遍。把「知道但故意不做」和「不知道」区分开，本身就是这一版的交付物。

| 项 | 去向 | 理由 |
| --- | --- | --- |
| 查找替换增强（下一个/上一个、高亮、大小写/正则/全词） | 1.0.4 | 不是坏了，是弱。要做就得同时打通 Milkdown 与 CodeMirror 两种模式的选区与滚动，塞进减法版会做夹生。1.0.3 内只把面板上那个「{n} 处」改成诚实措辞，别让它看起来能导航 |
| 窗口大小/位置记忆 | 1.0.4+ | 不加功能 |
| 编辑器字号与行距设置 | 1.0.4+ | 不加功能（当前只有自定义 CSS 这一个逃生口） |
| 打印 | 1.0.4+ | 不加功能（Ctrl+P 已被快速打开占用） |
| 分屏 / 并排预览 | 1.0.4+ | 不加功能 |
| 自动更新 | 1.0.4+ | 不加功能 |
| Word / 图片 / 纯 Markdown 导出 | 1.0.4+ | 不加功能 |
| 标签浏览面板 | 1.0.4+ | 不加功能（tag 已能搜，不能浏览） |
| 双链 `[[ ]]` 与反向链接 | 未排期 | 产品方向问题，不是欠账 |
| 多窗口 | 未排期 | 单实例锁是当前设计 |
| i18n | 未排期 | 全硬编码中文 |
| Mermaid 真渲染导出 | 1.0.4+ | 需把 mermaid JS 打进导出产物（本地优先不能用 CDN，测试已锁死），体积与复杂度都不小，与数学一起算「导出保真度」的账 |
| macOS / Linux 构建、代码签名 | 不做 | 单人维护，额外的签名、公证、JRE 分发与整套回归测试；Windows 自己的坑都没测完 |
| 多显示器 / 万级工作区性能 | 1.0.4+ | 打包版复测的延伸项 |
| 补 `v1.0.1` / `v1.0.2` 的 git tag | 不做 | 没有对应 commit 能准确指向 |
| 把后端的 `vault` 统一改名为 `workspace` | 1.0.4（待确认） | 见下节「术语漂移」 |

## 术语漂移：vault 与 workspace（待确认）

写 `GLOSSARY.md` 时发现的：同一个概念在代码里有两个名字，而且**混在同一批文件内**。`vault` 出现 335 次，`workspace` 出现 450 次；`WorkspaceController.java` 和 `WorkspaceService.java` 自己内部就同时用着两种叫法——服务与控制器叫 `Workspace*`，而它们持有的那个路径叫 `vaultRoot`。

`GLOSSARY.md` 已把**工作区**定为正式术语，`vault` 列入 `_Avoid_`。但本版**不做**这次改名：

- 335 处机械改名若与第 1 节的 `resolveSafe` 安全修复落在同一个版本，会让那个安全 diff 变得难以审阅——而它是本版最需要被看清的改动。
- `VAULT_PATH` 环境变量与 `nexttyproa.vault-path` 配置键是 **Electron 与后端之间的契约**（`main.js` 启动后端时传入），改名有真实的运行期失败模式，不是纯重命名。

因此 `GLOSSARY.md` 记录的是**目标状态**，代码暂时落后于它。改名作为独立 ticket 放 1.0.4，先改内部标识符，再单独处理配置键那条跨进程契约。

## 待确认

以下各项用户尚未明确回答（第五轮只确认了安全项为首要项），现按推荐写入，**可在本文件被推翻**：

- 第 11 节「测试加固」全部三条
- 「本版不做」一节的显式记录方式
- 「术语漂移：vault 与 workspace」一节——本版不改名，`GLOSSARY.md` 先记目标状态

## 决定来源

本 spec 的全部内容来自 2026-11-01 的 grilling 会话，26 个决定点，五轮。会话中我推翻过自己三次，均已在上文体现：

1. 「1.0.2 的 exe 是靠未提交的版本改动打出来的」→ 实为 electron-builder 按 1.0.0 命名后手工改名，代码是对的
2. 「让 flexmark 把公式渲染成 MathML」→ flexmark 0.64.8 根本没有数学扩展，改为前端 KaTeX
3. 「符号链接测试静默跳过是个测试缺口」→ 缺口底下盖着一个真实的路径逃逸漏洞

## 计划的 ticket

待本 spec 确认后创建于 `issues/`：

| NN | slug | 对应节 |
| --- | --- | --- |
| 01 | reject-reparse-points-in-resolve-safe | 1 |
| 02 | harden-symlink-test-with-junction | 11 |
| 03 | remove-save-time-backups | 2 |
| 04 | settings-storage-cleanup-section | 3 |
| 05 | decouple-jar-name-from-version | 4 |
| 06 | version-single-source-and-check | 4 |
| 07 | settings-about-section | 4 |
| 08 | math-to-mathml-in-renderer | 5 |
| 09 | remove-dead-mermaid-wait | 6 |
| 10 | remove-macos-menu-template | 6 |
| 11 | fix-readme-mismatches | 6 |
| 12 | display-name-vs-app-identity | 7 |
| 13 | root-npm-test-and-dist-verify | 8 |
| 14 | parent-process-monitor-seams | 11 |
| 15 | stabilize-codeblockpreview-test | 11 |
| 16 | restore-bug-backlog-archive | 9 |
| 17 | packaged-build-retest-minimal | 10 |

## Comments
