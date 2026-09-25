# NextTyproa 真实场景端到端测试缺陷清单

**测试日期**：2026-09-25
**被测版本**：`main` @ `b005a23`
**测试方式**：以普通用户身份操作运行中的应用：新建、编辑、重命名、移动、切换、重新打开、重启、外部修改、断网重连等。
**收录原则**：
- 本清单中的每一条都在运行中的应用里实际复现过，并记录了磁盘字节、API 响应或截图作为证据。
- 代码阅读只用于在复现之后定位原因。
- 所有 P0/P1 缺陷都按文中步骤复跑过一次。
- 只是怀疑、但没能复现的问题不列为缺陷。

## 测试环境

| 代号 | 环境 | 说明 |
|---|---|---|
| **A** | 开发模式 · 浏览器 | `mvn spring-boot:run`（JDK 21，:8080）+ Vite（:5173），用内置浏览器打开，窗口 1024×768 |
| **B** | 开发模式 · Electron | `electron . --remote-debugging-port=9222 --user-data-dir=<独立目录>`，通过 CDP 发送真实鼠标/键盘事件驱动 |
| **C** | 打包版 | 用 `npm run dist:dir` 从 `b005a23` 重新构建，运行 `release\win-unpacked\NextTyproa.exe --user-data-dir=<独立目录>` |

- 所有 Electron 测试都使用独立的 `--user-data-dir`，不读写真实的 `%APPDATA%\NextTyproa\settings.json`。
- 测试期间有一次误启动的第二实例写入了真实 settings.json。已立即用测试前的备份恢复，并核对 SHA-256 与原文件完全一致（`21E172C1…`）。

## 测试数据（`test/` 目录）

```
test/e2e-vault/                 主工作区
  日记/2026-09-23.md, 2026-09-24.md
  项目/需求 v1.2.md, 项目/子目录/深层笔记.md   （测试中被重命名为 项目2026，后删除）
  读书笔记/frontmatter.md          YAML frontmatter + tags
  ascii-notes.md                   语法覆盖：setext 标题、* / + 列表、1) 列表、表格、代码块、mermaid、任务列表、脚注、硬换行、HTML
  空文件.md、😀表情文件名.md、图片笔记.md + 图片笔记.assets/pic.png
  编码/gbk.md, big5.md, sjis.md, utf8-bom.md, utf16.md（带 BOM 的 UTF-16LE）
  大文件/large.md                  约 3 MB
  附件/readme.txt, logo.png
test/e2e-vault-2/               第二工作区（ascii-notes.md 与主工作区同名同路径）
```

测试数据由 `make-fixtures.js` 生成（放在会话临时目录，未提交到仓库）。测试过程中的操作会留下若干新文件，例如 `会议纪要 2024.01.05.md`、`日记/笔记A.md`、`日记/笔记B.md`、`*.conflict-*.md`、`pkg-*.md`。

## 严重程度定义

| 级别 | 含义 |
|---|---|
| **P0** | 数据丢失或损坏，或者应用基本不可用 |
| **P1** | 核心流程出错，或只能用别扭的办法绕过，存在数据风险 |
| **P2** | 可用性问题、边界场景、容易误导用户 |
| **P3** | 界面细节或体验瑕疵 |

---

## 汇总

| ID | 标题 | 级别 | 环境 |
|---|---|---|---|
| [x] [RW-P0-001](#rw-p0-001) | 打包版无法打开、保存或搜索任何不带 BOM 的笔记（Unsupported encoding: Big5） | P0 | C |
| [x] [RW-P0-002](#rw-p0-002) | 源码模式下切换标签后按一次 Ctrl+Z，上一篇笔记的全文会覆盖当前笔记并自动存盘 | P0 | A, B |
| [RW-P0-003](#rw-p0-003) | 第一次所见即所得编辑就会破坏 YAML frontmatter | P0 | B（A 同源） |
| [RW-P1-001](#rw-p1-001) | 输入后约 200ms 内切换标签、Ctrl+W、关闭窗口或刷新，最后输入的内容会丢失 | P1 | A, B |
| [RW-P1-002](#rw-p1-002) | 第一次编辑就重排整篇文件：硬换行被删、紧凑列表变松散、列表符号被替换 | P1 | A |
| [RW-P1-003](#rw-p1-003) | 已打开的笔记在外部被删除或重命名后，自动保存会静默重建旧文件（重命名时产生重复文件） | P1 | A, B |
| [RW-P1-004](#rw-p1-004) | "检测到外部修改"对话框打开时按 Ctrl+W，标签直接关闭，未保存修改丢失 | P1 | B |
| [RW-P1-005](#rw-p1-005) | 标签页不绑定工作区，切换工作区后旧标签会打开新工作区里同名的另一个文件 | P1 | A, B |
| [RW-P1-006](#rw-p1-006) | 打开当前工作区内的文件，会把工作区重置为该文件所在的子目录 | P1 | B |
| [RW-P1-007](#rw-p1-007) | 移动笔记时不移动它的 `.assets` 图片目录，图片全部失效 | P1 | A |
| [RW-P1-008](#rw-p1-008) | 粘贴超过 1 MB 的图片会静默失败，编辑器一直显示 "Upload in progress..." | P1 | B |
| [RW-P2-001](#rw-p2-001) | "保存副本"后，编辑写入副本，但标签栏仍显示原笔记 | P2 | A |
| [RW-P2-002](#rw-p2-002) | 只改大小写的重命名失败（a.md → A.md） | P2 | A |
| [RW-P2-003](#rw-p2-003) | 偏好设置对话框里未保存的修改，8 秒内会被自动重置 | P2 | A |
| [RW-P2-004](#rw-p2-004) | 在 GBK 等旧编码文件中输入无法表示的字符（如 emoji），会被静默替换为 "?" | P2 | A |
| [RW-P2-005](#rw-p2-005) | UTF-16 文件（记事本"Unicode"格式）无法打开，报 HTTP 500 | P2 | A |
| [RW-P2-006](#rw-p2-006) | 窗口打开期间，每 8 秒轮询一次并全量重建索引，日志不断刷屏 | P2 | A, B |
| [RW-P2-007](#rw-p2-007) | 有未保存修改时，第一次点击关闭窗口没有任何反应 | P2 | B |
| [RW-P2-008](#rw-p2-008) | 删除是永久删除，没有回收站，删除文件夹时连备份一起删掉 | P2 | A |
| [RW-P2-009](#rw-p2-009) | 界面上无法在工作区根目录新建文件夹，"…"按钮没有功能 | P2 | A |
| [RW-P2-010](#rw-p2-010) | 开发环境：Vite 只监听 `::1`，Electron dev 加载 `127.0.0.1:5173` 被拒绝，`npm run dev` 会卡住 | P2 | 开发环境 |
| [RW-P3-001](#rw-p3-001) | 新建的笔记标签标题都叫"新笔记"，无法区分 | P3 | A |
| [RW-P3-002](#rw-p3-002) | 删除当前笔记后不会自动切换到其他标签 | P3 | A |
| [RW-P3-003](#rw-p3-003) | 真实键盘上 Ctrl+Shift+1 / Ctrl+Shift+3 快捷键无效 | P3 | B |
| [RW-P3-004](#rw-p3-004) | 窄窗口下标题栏文件名、保存状态与工具栏控件重叠 | P3 | A |
| [RW-P3-005](#rw-p3-005) | 文件树与标签标题的交互不一致（多项小问题） | P3 | A |

**合计**：P0 × 3，P1 × 8，P2 × 10，P3 × 5。

---

## P0：数据丢失或损坏 / 应用不可用

<a id="rw-p0-001"></a>
### RW-P0-001：打包版无法打开、保存或搜索任何不带 BOM 的笔记（Unsupported encoding: Big5）

- **严重程度 / 优先级**：P0 / 最高（这就是用户截图里的问题）
- **复现环境**：C（打包版）。A、B 使用完整 JDK，不受影响。

**复现步骤**
1. 执行 `npm run dist:dir`，然后启动 `release\win-unpacked\NextTyproa.exe`，打开一个工作区。
2. 在文件树中点击任意一个普通 UTF-8 笔记，比如 `ascii-notes.md`。
3. 新建一篇笔记"打包版新笔记"。
4. 在搜索框中搜索正文里的文字。

**预期行为**：笔记正常打开和编辑，自动保存成功，可以搜到内容。

**实际行为**
- **打开笔记**：步骤 2 弹出"提示：打开笔记失败：Unsupported encoding: Big5"，和用户截图完全一致。
- **新建笔记**：步骤 3 的文件已经写到磁盘，但随即弹出同样的错误，新建的笔记也打不开。
- **保存**：通过 API 验证，对刚新建的笔记用正确的 `baseHash` 保存，返回 **400 Unsupported encoding: Big5**，磁盘内容没有变化。也就是说，编辑的内容永远存不进去。
- **空文件**：0 字节的 `空文件.md` 同样报 400。只有带 UTF-8 BOM 的文件能打开。
- **搜索**：`/api/search/status` 返回 `indexedFiles: 0, totalFiles: 0, lastIndexedAt: null`，搜索任何词都是 0 条结果。
- **报错但实际已生效的操作**：
  - 重命名 `pkg-test.md → pkg-renamed.md`：返回 400，但文件**已经被重命名**。
  - 移动到"新目录"：返回 400，但文件**已经被移动**。
  - 切换工作区：返回 400，但后端**已经切换**（`GET /api/workspace` 返回新路径）。
- **其他失败**：
  - `POST /api/tree/refresh` 返回 400，所以 8 秒一次的文件树刷新和外部修改检测会静默失效。
  - 导出 HTML 返回 400。

**证据**
- `resources/jre/release` 的 MODULES 列表里没有 `jdk.charsets`。
- 打包版 `backend.log` 中有：`WARN ... VaultStartupRunner : Failed to reindex vault at startup: Big5`。
- 用户自己的 `%APPDATA%\NextTyproa\logs\backend.log` 中有同样的日志。
- 上述 400 错误本身**没有写进日志**，从用户日志里很难排查。

**相关文件**
- [scripts/prepare-jre.js:79-84](scripts/prepare-jre.js#L79-L84)：jlink 的模块列表缺少 `jdk.charsets`。Windows 版 `java.base` 自带 GBK 和 SJIS，但**没有 Big5**。
- [FileService.java:156-157](backend/src/main/java/com/nexttyproa/service/FileService.java#L156-L157)：对每个不带 BOM 的文件，都会依次调用 `Charset.forName("GBK"/"Big5"/"Shift_JIS")`，即使 UTF-8 已经解码成功也一样。
- [FileService.java:454-460](backend/src/main/java/com/nexttyproa/service/FileService.java#L454-L460)：`tryDecode` 只捕获 `IOException`，而 `UnsupportedCharsetException` 是在调用它之前抛出的。
- [GlobalExceptionHandler.java:61-64](backend/src/main/java/com/nexttyproa/controller/GlobalExceptionHandler.java#L61-L64)：映射为 400，并且不记日志。
- [NoteService.java:59-61](backend/src/main/java/com/nexttyproa/service/NoteService.java#L59-L61)：保存前会先读取现有文件做冲突检测，所以保存也会失败。
- `VaultStartupRunner`、`IndexService.reindexVault / syncRenamedFile`、`ExportService` 读文件时都会走到同一个位置。

**备注**
- 后端单元测试运行在完整 JDK 上，所以测不出这个问题。
- 修复方向：
  - 在 jlink 模块中加入 `jdk.charsets`。
  - 或者在调用 `Charset.forName` 前先用 `Charset.isSupported` 判断。
  - 同时应该补一个"用打包 JRE 跑一遍读写"的冒烟测试。
- 重命名、移动、切换工作区"报错但已生效"会让前端状态和磁盘不一致，修复时需要一并考虑。

---

<a id="rw-p0-002"></a>
### RW-P0-002：源码模式下切换标签后按一次 Ctrl+Z，上一篇笔记的全文会覆盖当前笔记并自动存盘

- **严重程度 / 优先级**：P0 / 最高
- **复现环境**：A、B（Electron 中复跑过）

**复现步骤**
1. 打开 `ascii-notes.md`，点击工具栏的"源码"切换到源码模式。
2. 在文件树中打开 `日记/2026-09-23.md`。此时仍然是源码模式。
3. 点击编辑区，按一次 **Ctrl+Z**。
4. 等待约 1 秒。

**预期行为**：没有可撤销的操作，文档保持不变。撤销历史应该只属于当前这篇笔记。

**实际行为**
- 编辑区内容整篇变成 `# Markdown Syntax Coverage ...`，也就是上一篇笔记的全文。标签被标记为未保存。
- 约 800ms 后自动保存，**`日记/2026-09-23.md` 在磁盘上被 ascii-notes 的内容覆盖**。
- 原内容只能从 `.nexttyproa-backups` 找回，而那里每个文件只保留最近 10 份备份。
- 第一次在环境 A 复现时，被覆盖的是 `日记/2026-09-24.md`。

**证据**
- 环境 B 复跑时，覆盖后磁盘文件开头为 `# Markdown Syntax Coverage\n\nSetext heading above, *emphasis*`。
- 事后已手动恢复该文件，SHA-256 与原文件一致。

**相关文件**
- [SourceEditor.tsx:237-247](frontend/src/components/SourceEditor.tsx#L237-L247)：切换笔记时，用一个普通事务把整篇文档替换掉，这个事务会进入 undo 历史。
- [SourceEditor.tsx:85-90](frontend/src/components/SourceEditor.tsx#L85-L90)：`minimalSetup` 包含 history，而且 EditorView 不会随笔记切换重建。

**备注**
- 只需要按一次 Ctrl+Z 就会触发，写作时这是非常常见的操作。
- 修复方向：切换笔记时重建 EditorState，或者给这次替换加上 `addToHistory: false`。

---

<a id="rw-p0-003"></a>
### RW-P0-003：第一次所见即所得编辑就会破坏 YAML frontmatter

- **严重程度 / 优先级**：P0 / 最高
- **复现环境**：B（环境 A 使用同一个编辑器组件）

**复现步骤**
1. 打开 `读书笔记/frontmatter.md`，文件内容如下：
   ```
   ---
   title: 人月神话读书笔记
   tags: [读书, 软件工程]
   author: Brooks
   ---

   # 人月神话
   ...
   ```
2. 在"编辑"模式下，于正文末尾输入"（摘录）"。
3. 等待自动保存。

**预期行为**：frontmatter 原样保留，被识别为元数据而不是正文。

**实际行为**
- **显示**：打开时 frontmatter 显示为一条分隔线加一个 H2 标题"title: 人月神话读书笔记 tags: [读书, 软件工程] author: Brooks"，标签标题显示为"---"。
- **保存后的磁盘内容**：
  ```
  ***

  title: 人月神话读书笔记
  tags: \[读书, 软件工程]
  author: Brooks
  --------------

  # 人月神话
  ```
  开头的 `---` 变成 `***`，结尾的 `---` 变成 setext 标题的下划线，`[` 被转义成 `\[`。文件不再含有合法的 frontmatter。
- **影响**：
  - 后端按 frontmatter 搜索失效：`/api/search?q=Brooks&scope=frontmatter` 返回 0 条。
  - Hexo、Hugo、Obsidian 等依赖 frontmatter 的工具都会读不到元数据。

**相关文件**：[MarkdownEditor.tsx:111-155](frontend/src/components/MarkdownEditor.tsx#L111-L155)（Crepe 配置里没有 frontmatter 支持，序列化时把它当作普通 Markdown 输出）。

**备注**：静默损坏，没有任何提示。后端 `IndexService` 本身能解析 frontmatter，前后端的能力不一致。

---

## P1：核心流程出错 / 存在数据风险

<a id="rw-p1-001"></a>
### RW-P1-001：输入后约 200ms 内切换标签、Ctrl+W、关闭窗口或刷新，最后输入的内容会丢失

- **严重程度 / 优先级**：P1 / 高
- **复现环境**：A、B

**复现步骤**（任选一种）
1. 在所见即所得模式下输入一段文字，然后立即点击另一个标签（A）。
2. 输入后立即按 Ctrl+W（B）。
3. 输入后立即点击窗口右上角的关闭按钮（B）。
4. 输入后立即刷新页面（A）。

**预期行为**：切换、关闭或退出之前，把全部修改都保存下来。

**实际行为**：最后输入的内容既没有写到磁盘，也不在内存里，并且没有任何提示。具体记录：

| 操作 | 结果 |
|---|---|
| 输入 " QUICK1" 后立即切换标签 | 丢失；切回来编辑区里也没有 |
| 输入 " WAIT400"，等待 400ms 后切换 | 已保存 |
| 输入 " CTRLW1" 后约 200ms 按 Ctrl+W | 标签关闭，内容丢失，没有提示 |
| 输入 " CTRLW2"，等待 500ms 后按 Ctrl+W | 已保存 |
| 输入 " CLOSE1" 后立即点关闭按钮 | 应用立即退出，内容丢失 |
| 输入 " RELOAD2" 后立即刷新 | 丢失 |
| 输入后立即切换"编辑/源码" | **已保存**（这种情况不受影响） |

**相关文件**
- `node_modules/@milkdown/plugin-listener/lib/index.js:76-96`：`markdownUpdated` 有 200ms 的 lodash debounce，编辑器销毁时会被 `cancel()`。
- [MarkdownEditor.tsx:151-155](frontend/src/components/MarkdownEditor.tsx#L151-L155)：只通过这个 debounce 回调上报修改。
- [App.tsx:120-127](frontend/src/App.tsx#L120-L127)：`flush` 只读取 `stateRef`，拿不到还没上报的修改。
- [App.tsx:1362-1368](frontend/src/App.tsx#L1362-L1368)：`handleCloseTab`。
- [App.tsx:1056](frontend/src/App.tsx#L1056)：`beforeunload`。

**备注**
- 快速切换或用快捷键关闭是熟练用户的常见操作。
- 修复方向：在 flush 前主动从编辑器取出最新的 markdown，或者在切换和销毁前 `flush` 这个 debounce，而不是 `cancel`。

---

<a id="rw-p1-002"></a>
### RW-P1-002：第一次编辑就重排整篇文件：硬换行被删、紧凑列表变松散、列表符号被替换

- **严重程度 / 优先级**：P1 / 高
- **复现环境**：A（所见即所得模式）

**复现步骤**
1. 打开 `ascii-notes.md`，在第 3 行末尾输入" X"。
2. 等待自动保存，然后用 diff 对比磁盘文件和 `.nexttyproa-backups` 中的备份。

**预期行为**：只有被编辑的那一行发生变化，没有动过的内容保持原样，就像 Typora 那样。

**实际行为**：整篇文件都被重新格式化：
- 两个尾随空格构成的**硬换行被删掉**。"Line with trailing double space␠␠\nhard break above." 变成没有尾随空格（该行长度 31），渲染时两行会合并成一行，**语义改变**。
- 所有紧凑列表变成松散列表，每项之间多出空行。松散列表在其他渲染器里会把每一项包进 `<p>`。
- `- [x]` 变成 `* [x]`，`+` 变成 `-`，`1)` 变成 `1.`。
- Setext 标题 `===` 变成 `#`，表格被重新对齐。
- 在 `日记/2026-09-24.md` 中，文件结尾的 `\n` 变成了 `\n\n`。

**证据**：`日记/2026-09-24.md` 编辑前后的 diff：`- [x] 准备测试数据` 变成 `* [x] 准备测试数据`，列表项之间插入空行，文件末尾多出一个换行。

**相关文件**：[MarkdownEditor.tsx](frontend/src/components/MarkdownEditor.tsx)（Crepe / remark 序列化使用默认配置）。

**备注**
- 用 git 管理笔记的用户会看到巨大的无关 diff。
- 硬换行丢失属于内容损坏。
- 另见 RW-P0-003（frontmatter 被破坏），两者同源。

---

<a id="rw-p1-003"></a>
### RW-P1-003：已打开的笔记在外部被删除或重命名后，自动保存会静默重建旧文件（重命名时产生重复文件）

- **严重程度 / 优先级**：P1 / 高
- **复现环境**：A、B（B 中复跑过）

**复现步骤**
1. 在应用中打开 `日记/笔记A.md`。
2. 在资源管理器中**删除**它（测试中使用 `Remove-Item`）。
3. 回到应用，继续输入 "AFTER-EXTERNAL-DELETE"。
4. 另一种情况：在资源管理器中把它**重命名**为 `笔记B.md`，再回到应用继续输入 " +RENAME"。

**预期行为**：提示"文件已被移动或删除"，让用户选择"另存为"或"关闭标签"。这是 BUG-P0-003 修复时设计的流程。

**实际行为**
- **删除的情况**：没有任何提示，自动保存把 `笔记A.md` **重新创建**出来。用户在外部的删除被悄悄撤销了。
- **重命名的情况**：`笔记A.md` 被重建，包含新输入的内容；`笔记B.md` 保留旧内容。**出现两个文件，修改被拆散在两处**。8 秒后文件树里两个都会出现。
- "文件已被移动或删除"对话框从没出现过。

**相关文件**
- [NoteService.java:59-61, 94-95](backend/src/main/java/com/nexttyproa/service/NoteService.java#L59-L95)：文件不存在时按"空文件"处理，直接写入，不返回 404。
- [FileService.java:187-189](backend/src/main/java/com/nexttyproa/service/FileService.java#L187-L189)：会连同父目录一起创建。
- [App.tsx:149-151](frontend/src/App.tsx#L149-L151)：前端的 404 处理因此永远不会被触发。

**备注**：`BUG_BACKLOG.md` 中的 BUG-P0-003 虽然标记为已修复，但在真实使用中不起作用。

---

<a id="rw-p1-004"></a>
### RW-P1-004："检测到外部修改"对话框打开时按 Ctrl+W，标签直接关闭，未保存修改丢失

- **严重程度 / 优先级**：P1 / 高
- **复现环境**：B（复跑过）

**复现步骤**
1. 打开 `日记/笔记B.md`。
2. 用外部程序在文件末尾追加一行"外部追加2"。
3. 回到应用，输入 " MYEDIT"，随后弹出"检测到外部修改"对话框（重新载入 / 保存副本 / 强制覆盖）。
4. **不点击任何按钮**，直接按 Ctrl+W。

**预期行为**：
- 对话框打开期间，全局快捷键应该被屏蔽；
- 或者关闭前提示"有未保存的修改"。

**实际行为**：对话框和标签同时消失，没有任何提示。磁盘上只有"外部追加2"，**" MYEDIT" 永久丢失**。第一次测试时 `ascii-notes.md` 的 " MINE-UNSAVED" 也是这样丢失的。

**相关文件**
- [App.tsx:432](frontend/src/App.tsx#L432)：存在冲突时 `enabled=false`。
- [App.tsx:126-127](frontend/src/App.tsx#L126-L127)：`!dirty` 时 `flush` 直接返回 `true`。
- [App.tsx:1362-1368](frontend/src/App.tsx#L1362-L1368)：`handleCloseTab` 把"保存成功"当作可以关闭。
- [App.tsx:1774-1794](frontend/src/App.tsx#L1774-L1794)：快捷键处理没有检查对话框是否打开。

**备注**：Ctrl+Tab、Ctrl+P → Enter 等快捷键理论上也会在对话框后面生效，但本次没有逐一验证。

---

<a id="rw-p1-005"></a>
### RW-P1-005：标签页不绑定工作区，切换工作区后旧标签会打开新工作区里同名的另一个文件

- **严重程度 / 优先级**：P1 / 高
- **复现环境**：A、B

**复现步骤**（B，真实用户路径）
1. 在工作区 `e2e-vault` 中打开 `ascii-notes.md`。
2. 通过"打开文件"或双击 `.md` 文件（测试中通过第二实例传入路径）打开 `test\e2e-vault-2\第二库笔记.md`，工作区随之切换到 `e2e-vault-2`。
3. 点击旧的 `ascii-notes.md` 标签。

**预期行为**：切换工作区时关闭旧工作区的标签，或者标签记住自己属于哪个工作区；绝不能指向另一个文件。

**实际行为**
- 旧标签被保留。点击后编辑区显示 **"SECOND VAULT ascii-notes"**，也就是 `e2e-vault-2` 中同名的另一个文件。此时继续编辑，改的就是另一个文件。
- 旧工作区里没有同名文件的标签，会被标成"文件缺失"（红色 !）。

**其他证据**
- 环境 A：把后端工作区切换到 `e2e-vault-2` 后刷新页面，8 个旧标签全部保留，当前标签 `ascii-notes.md` 打开的是第二个库里的文件。
- 首次启动时：浏览器 localStorage 中残留着另一个临时 vault 的 3 个标签（心跳测试、甲、首次编辑），它们被原样恢复到新的工作区，点开后提示"文件缺失或已被移动"。

**相关文件**
- [appSettings.ts:126-128](frontend/src/utils/appSettings.ts#L126-L128)：`openTabs` 只保存相对路径，没有记录所属工作区。
- [App.tsx](frontend/src/App.tsx)：`bootstrap` 以及打开文件夹、打开文件时都不清理旧标签。

---

<a id="rw-p1-006"></a>
### RW-P1-006：打开当前工作区内的文件，会把工作区重置为该文件所在的子目录

- **严重程度 / 优先级**：P1 / 中高
- **复现环境**：B

**复现步骤**
1. 工作区为 `test\e2e-vault`。
2. 通过"打开文件"或双击打开 `test\e2e-vault\日记\2026-09-23.md`。

**预期行为**：文件已经在当前工作区里，直接在当前工作区中打开并选中它。

**实际行为**
- 后端工作区变成 `...\e2e-vault\日记`。文件树只剩下日记目录的内容，状态栏显示 `D:\project\NextTypora\test\e2e-vault\日记`。
- 工作区的其他内容从侧栏和搜索中消失。
- 原有的标签（如 `ascii-notes.md`）现在会被解析为 `日记/ascii-notes.md`，指向不存在的路径。

**相关文件**：[App.tsx:1157-1165](frontend/src/App.tsx#L1157-L1165)（`handleOpenAbsoluteFile` 总是用文件所在的父目录 `openNoteAt(dir, relativePath)`，没有判断文件是否已经在当前工作区内）。

---

<a id="rw-p1-007"></a>
### RW-P1-007：移动笔记时不移动它的 `.assets` 图片目录，图片全部失效

- **严重程度 / 优先级**：P1 / 中高
- **复现环境**：A

**复现步骤**
1. 打开 `图片笔记.md`，图片正常显示。图片保存在 `图片笔记.assets/pic.png`，这也是应用粘贴图片时的默认保存位置。
2. 右键点击该笔记，选择"移动到"，目标选择"日记"，点击"移动"。

**预期行为**：笔记和它的 `.assets` 目录一起移动，或者自动改写图片的相对路径。

**实际行为**
- 提示"移动成功"，但图片变成了裂图。
- 磁盘上 `图片笔记.assets\pic.png` 仍然留在根目录，`日记\图片笔记.assets` 不存在。
- `.assets` 目录在文件树中是隐藏的，**用户在界面里既看不到也没法手动移动它**。
- 删除笔记时也会留下这个隐藏的孤儿目录。

**相关文件**
- [FileSystemService.java:107-150](backend/src/main/java/com/nexttyproa/service/FileSystemService.java#L107-L150)：`movePath` 只移动文件本身（`:141`）。
- [WorkspaceService.java:109-113](backend/src/main/java/com/nexttyproa/service/WorkspaceService.java#L109-L113)：隐藏名字以 `.assets` 结尾的目录。

---

<a id="rw-p1-008"></a>
### RW-P1-008：粘贴超过 1 MB 的图片会静默失败，编辑器一直显示 "Upload in progress..."

- **严重程度 / 优先级**：P1 / 中高（全屏 PNG 截图通常有 1–3 MB）
- **复现环境**：B

**复现步骤**
1. 打开任意笔记，把光标放在正文中。
2. 粘贴一张约 1.5 MB 的 PNG。测试中用合成的 paste 事件粘贴 `big-screenshot.png`；同样方法粘贴 70 字节的小图是成功的。

**预期行为**：图片保存到 `<笔记名>.assets/` 并插入引用。如果失败，要明确提示原因。

**实际行为**
- `.assets` 目录中没有新文件，没有任何错误提示。
- 13 秒后正文中仍然显示 "参会人：张三、李四**Upload in progress...**"，这个占位一直不消失。
- 后端日志：`ERROR ... Unhandled request error ... FileSizeLimitExceededException: The field file exceeds its maximum permitted size of 1048576 bytes.`（HTTP 500）

**相关文件**
- `backend/src/main/resources/application*.yml`：没有配置 `spring.servlet.multipart.max-file-size`，因此使用 Spring 默认的 1 MB。
- [GlobalExceptionHandler.java:75-80](backend/src/main/java/com/nexttyproa/controller/GlobalExceptionHandler.java#L75-L80)：映射为 500。
- [imageUpload.ts:29-37](frontend/src/utils/imageUpload.ts#L29-L37) 和 [MarkdownEditor.tsx:131-134](frontend/src/components/MarkdownEditor.tsx#L131-L134)：上传失败时既不提示，也不清理占位。

---

## P2：可用性问题 / 边界场景

<a id="rw-p2-001"></a>
### RW-P2-001："保存副本"后，编辑写入副本，但标签栏仍显示原笔记

- **严重程度 / 优先级**：P2
- **复现环境**：A

**复现步骤**
1. 按 RW-P1-004 的方法触发"检测到外部修改"。
2. 点击"保存副本"。
3. 继续输入 "COPYEDIT"。

**预期行为**：副本在新标签中打开并激活，或者至少让标签栏反映当前正在编辑的文件。

**实际行为**
- 已创建 `日记/2026-09-24.conflict-20260925-000629.md`。文件树、标题栏和状态栏都显示副本，但**标签栏仍然只有"2026-09-24 周四"（日记/2026-09-24.md）处于激活状态**，没有副本的标签。
- 新输入的 "COPYEDIT" 被写进了**副本**，原文件没有。用户会以为自己在编辑原笔记。
- 原标签离开后一直带着 `dirty` 标记，点回去才会从磁盘重新加载。
- 点击"保存副本"后，对话框要过几秒才关闭，期间没有 loading 提示。

**相关文件**：[App.tsx:1744-1761](frontend/src/App.tsx#L1744-L1761)（`handleSaveConflictCopy` 只调用了 `setSelectedPath`，既没有新增标签，也没有更新 `activeTabPath`）。

---

<a id="rw-p2-002"></a>
### RW-P2-002：只改大小写的重命名失败（a.md → A.md）

- **严重程度 / 优先级**：P2
- **复现环境**：A（Windows / NTFS）

**复现步骤**：在文件树中右键点击 `ascii-notes.md`，选择"重命名"，输入 `ASCII-notes.md`，然后确认。

**预期行为**：重命名成功。

**实际行为**：弹出"提示：重命名失败：Path already exists: ASCII-notes.md"。

**相关文件**：[FileSystemService.java:91-92](backend/src/main/java/com/nexttyproa/service/FileSystemService.java#L91-L92)（NTFS 不区分大小写，`Files.exists(target)` 对同一个文件返回 true）。文件夹的大小写重命名也是同样的逻辑。

---

<a id="rw-p2-003"></a>
### RW-P2-003：偏好设置对话框里未保存的修改，8 秒内会被自动重置

- **严重程度 / 优先级**：P2
- **复现环境**：A

**复现步骤**
1. 打开"偏好设置"。
2. 在"编辑区自定义 CSS"中输入 `.ProseMirror p { color: red; }`，并打开"拼写检查"开关。
3. 不点保存，等待约 10 秒。

**预期行为**：在点击保存或取消之前，修改一直保留。

**实际行为**：CSS 输入框恢复为空的占位文字，拼写检查开关也自动关回去了。

**相关文件**
- [SettingsModal.tsx:48-50](frontend/src/components/SettingsModal.tsx#L48-L50)：effect 依赖 `[open, initial]`，并在其中执行 `setDraft(initial)`。
- App 每次渲染都会生成新的 `initial` 对象，而 8 秒一次的轮询（[App.tsx:862-864](frontend/src/App.tsx#L862-L864)）会让 App 重新渲染。

---

<a id="rw-p2-004"></a>
### RW-P2-004：在 GBK 等旧编码文件中输入无法表示的字符（如 emoji），会被静默替换为 "?"

- **严重程度 / 优先级**：P2
- **复现环境**：A

**复现步骤**：打开 `编码/gbk.md`（后端识别为 GBK），在标题中输入"表情😀结束"，然后等待保存。

**预期行为**：
- 提示"该字符无法用 GBK 保存"，询问是否转换为 UTF-8；
- 或者自动改用 UTF-8 保存。

**实际行为**
- 磁盘上第一行变成 `# GBK 编码测试表情?结束`（字节 0x3F），没有任何提示。
- 约 8 秒后轮询重新加载，编辑区里也变成了"?"，输入的 emoji 彻底丢失。

**相关文件**
- [FileService.java:198](backend/src/main/java/com/nexttyproa/service/FileService.java#L198)：`String.getBytes(charset)` 会把无法编码的字符替换成 `?`。
- [NoteService.java:107](backend/src/main/java/com/nexttyproa/service/NoteService.java#L107)：返回的 hash 是按请求内容计算的，而不是实际写入磁盘的内容。

**备注**：同样的方法验证过，GBK、Big5、Shift_JIS 文件中只输入可以表示的字符时，保存后编码保持不变（环境 A 通过）。

---

<a id="rw-p2-005"></a>
### RW-P2-005：UTF-16 文件（记事本"Unicode"格式）无法打开，报 HTTP 500

- **严重程度 / 优先级**：P2
- **复现环境**：A

**复现步骤**：点击 `编码/utf16.md`（带 FF FE BOM 的 UTF-16LE 文件）。

**预期行为**：识别 UTF-16 BOM 并正常打开；至少给出"不支持 UTF-16 编码"这样明确的提示。

**实际行为**
- 弹出"打开笔记失败：后端内部错误（HTTP 500）File appears to be binary and cannot be opened as Markdown: ...\编码\utf16.md，详细信息请查看后端日志"。
- 索引统计中这个文件记为"失败 1 个文件"，并且每 8 秒写一次 WARN 日志（见 RW-P2-006）。

**相关文件**：[FileService.java:133-135, 376-384](backend/src/main/java/com/nexttyproa/service/FileService.java#L133-L135)（`looksBinary` 只要看到 NUL 字节就判定为二进制，而 UTF-16 每个 ASCII 字符后面都有一个 0x00）。

---

<a id="rw-p2-006"></a>
### RW-P2-006：窗口打开期间，每 8 秒轮询一次并全量重建索引，日志不断刷屏

- **严重程度 / 优先级**：P2（性能 / 日志）
- **复现环境**：A、B

**复现步骤**：打开工作区后什么都不做，观察后端日志。

**预期行为**：只在文件发生变化时增量更新；或者以更低频率、更轻量的方式检测。

**实际行为**
- `backend-dev.log` 在 00:05:35、:43、:51、:59、00:06:14 等时刻反复出现 `WARN IndexService : Failed to index ...\编码\utf16.md: File appears to be binary`。
- 也就是说，窗口开着的每 8 秒，都会对整个 vault 执行一次 `reindexVault`。

**相关文件**
- [App.tsx:831-866](frontend/src/App.tsx#L831-L866)：轮询。
- [App.tsx:732-735](frontend/src/App.tsx#L732-L735)：`refreshWorkspace()`，即 `POST /api/tree/refresh`，由 `FileSystemService.refreshTree` 调用 `reindexVault`。

**备注**：如果 vault 里有 `.git`、`node_modules` 或大量文件，会持续占用 CPU 和磁盘；打包版上这次刷新还会因 RW-P0-001 直接失败。

---

<a id="rw-p2-007"></a>
### RW-P2-007：有未保存修改时，第一次点击关闭窗口没有任何反应

- **严重程度 / 优先级**：P2
- **复现环境**：B

**复现步骤**：输入 " CLOSE2"，约 350ms 后（此时 Milkdown 已上报修改，但 800ms 的自动保存还没触发）点击右上角的"关闭窗口"。

**预期行为**：保存后关闭窗口；或者弹出"正在保存 / 有未保存修改"的提示。

**实际行为**：窗口没有关闭，也没有任何提示。修改已经被保存（磁盘上有 CLOSE2），但需要**再点一次**关闭按钮才会退出。用户会以为关闭按钮坏了。

**相关文件**
- [App.tsx:1056-1065](frontend/src/App.tsx#L1056-L1065)：`beforeunload` 中调用 `preventDefault`。
- [main.js:552](electron/main.js#L552)：`will-prevent-unload` 只在应用正在退出时才放行。

**备注**：如果点击发生在 200ms 以内，就会变成 RW-P1-001 的数据丢失。

---

<a id="rw-p2-008"></a>
### RW-P2-008：删除是永久删除，没有回收站，删除文件夹时连备份一起删掉

- **严重程度 / 优先级**：P2（设计风险）
- **复现环境**：A

**复现步骤**
1. 选中当前笔记 `日记/图片笔记.md`，点击工具栏的"删除笔记"。
2. 再在文件树中删除文件夹"项目2026"。

**预期行为**：移到系统回收站，或者提供撤销。

**实际行为**
- 两个确认框分别写着"确定删除 … 吗？此操作不可撤销。"和"文件夹中的所有内容都会被删除。此操作不可撤销。"。
- 确认后文件从磁盘上被彻底删除。
- 删除文件夹时，其中的 `.nexttyproa-backups` 备份也一起被删掉了。从没自动保存过的笔记没有任何备份。

**相关文件**：[FileSystemService.java:54-75, 159-171](backend/src/main/java/com/nexttyproa/service/FileSystemService.java#L54-L75)（`Files.delete` 加 `walkFileTree` 递归删除，没有使用 `shell.trashItem`）。

**备注**：删除后标签页会正确关闭，搜索索引也正确清理（已验证通过）。

---

<a id="rw-p2-009"></a>
### RW-P2-009：界面上无法在工作区根目录新建文件夹，"…"按钮没有功能

- **严重程度 / 优先级**：P2
- **复现环境**：A

**复现步骤**：在文件树的空白区域右键；点击侧栏顶部的"…"（侧边栏选项）按钮。

**预期行为**：可以在根目录新建文件夹或笔记。

**实际行为**：空白区域右键没有菜单；"…"按钮点击后没有反应。唯一的变通办法是在"新建笔记"对话框中输入 `新目录/笔记A`，让它顺带创建目录。

**相关文件**：[FileTree.tsx](frontend/src/components/FileTree.tsx)（右键菜单只挂在节点上）、[SidebarPanel.tsx](frontend/src/components/SidebarPanel.tsx)（"侧边栏选项"按钮没有 onClick）。

---

<a id="rw-p2-010"></a>
### RW-P2-010：开发环境：Vite 只监听 `::1`，Electron dev 加载 `127.0.0.1:5173` 被拒绝，`npm run dev` 会卡住

- **严重程度 / 优先级**：P2（只影响开发者）
- **复现环境**：Windows 11 + Node 24

**复现步骤**
1. 在 `frontend` 目录执行 `npm run dev`，Vite 输出 `Local: http://localhost:5173/`。
2. 启动 Electron dev（`electron .`）。

**预期行为**：Electron 窗口正常加载前端。

**实际行为**
- `Get-NetTCPConnection` 显示 5173 端口只监听在 `::1` 上。
- Electron 日志：`Failed to load URL: http://127.0.0.1:5173/ with error: ERR_CONNECTION_REFUSED`，窗口一片空白。
- `npm run dev:electron` 用 `wait-on http://127.0.0.1:5173` 等待 Vite，所以会一直卡住。
- 改用 `vite --host 127.0.0.1` 后恢复正常。

**相关文件**：
- [frontend/vite.config.ts](frontend/vite.config.ts)：`server` 没有设置 `host`。
- [electron/main.js:562](electron/main.js#L562)。
- [package.json:11](package.json#L11)。

---

## P3：界面与体验细节

<a id="rw-p3-001"></a>
### RW-P3-001：新建的笔记标签标题都叫"新笔记"，无法区分

- **复现环境**：A
- **复现步骤**：先后新建 `会议纪要 2024.01.05.md` 和 `新目录/笔记A.md`。
- **实际行为**：两个标签都显示"新笔记"，因为标签标题取的是模板里的 `# 新笔记`，而不是用户输入的文件名。
- **预期行为**：新建的笔记使用文件名作为标题，或者模板标题跟随文件名。

<a id="rw-p3-002"></a>
### RW-P3-002：删除当前笔记后不会自动切换到其他标签

- **复现环境**：A
- **复现步骤**：打开 7 个标签，删除当前激活的笔记。
- **实际行为**：其余标签都还在，但编辑区显示"打开本地 Markdown 文件"的空白占位，没有激活任何标签。
- **预期行为**：像关闭标签一样，自动激活相邻的标签。

<a id="rw-p3-003"></a>
### RW-P3-003：真实键盘上 Ctrl+Shift+1 / Ctrl+Shift+3 快捷键无效

- **复现环境**：B
- **复现步骤**：按 Ctrl+Shift+1（打开大纲侧栏）。
- **实际行为**：没有反应。在美式键盘上按 Shift+1，浏览器报告的 `key` 是 `!`。用 `{key:'!', code:'Digit1', ctrl, shift}` 测试没有效果，改成 `key:'1'`（键盘实际上产生不了）才会切换到大纲。
- **相关文件**：[shortcuts.ts:20-21, 109-120](frontend/src/utils/shortcuts.ts#L109-L120)（按 `event.key` 匹配，而不是 `event.code`）。

<a id="rw-p3-004"></a>
### RW-P3-004：窄窗口下标题栏文件名、保存状态与工具栏控件重叠

- **复现环境**：A（窗口 1024×768）
- **实际行为**：
  - 标题栏中的文件名，比如"2026-09-24.md"，和"编辑/源码"切换按钮、全屏图标重叠。
  - "已保存"状态文字压在导出按钮上。
  - "未打开文档"与"源码"按钮重叠。
- **预期行为**：窗口宽度不够时截断或隐藏文字，不要让控件互相遮挡。

<a id="rw-p3-005"></a>
### RW-P3-005：文件树与标签标题的交互不一致（多项小问题）

- **复现环境**：A
- **实际行为**：
  1. 点击文件夹名称只会选中，必须点击小三角才能展开（Typora 和 VS Code 都是点名称即可展开）。
  2. 重命名文件夹后，受影响的标签标题从 H1（"深层笔记"）变成了文件名（"深层笔记.md"），和其他标签不一致；重命名后的文件夹还会自动折叠。
  3. 用鼠标滚轮滚动文件树时，滚动效果有延迟、位置会跳动，有一次点击落到了另一个文件上（本想打开 `图片笔记.md`，结果打开了冲突副本）。

---

## 已验证通过的场景

| 场景 | 环境 | 结果 |
|---|---|---|
| 打开笔记不会修改文件；输入后约 1–2 秒自动保存；每次覆盖前都会在 `.nexttyproa-backups` 生成 `.bak` | A | ✅ |
| 切换"编辑/源码"时，最后的输入不丢失 | A | ✅ |
| 外部修改而笔记没有未保存内容时，8 秒内自动重新载入，并提示"已载入磁盘上的最新版本" | A | ✅ |
| 外部修改而笔记有未保存内容时，弹出"检测到外部修改"对话框 | A, B | ✅ |
| 重命名包含 2 个已打开笔记的文件夹：标签路径同步更新，编辑保存到新路径，旧路径不会被重建，搜索索引同步更新 | A | ✅ |
| 删除包含已打开笔记的文件夹：相关标签关闭，索引清理干净 | A | ✅ |
| 拖拽移动笔记到其他文件夹，标签路径同步更新 | A | ✅ |
| 新建带点号的笔记名（`会议纪要 2024.01.05`），以及用 `目录/名称` 形式同时建目录和笔记；重名时提示 "Note already exists" | A | ✅ |
| 中文正文搜索（UTF-8 BOM、GBK 都能命中）；大文件被跳过和失败文件都有提示 | A | ✅ |
| GBK、Big5、Shift_JIS、UTF-8 BOM 文件能正确识别编码，保存后编码保持不变（只输入可表示字符时） | A（JDK） | ✅ |
| 3 MB 大文件可以打开和保存（打开约 5 秒） | A | ✅ |
| 刷新或重启后恢复工作区、标签、当前标签、展开的目录和深色主题 | A, B | ✅ |
| 编辑中途后端被杀掉：显示断线横幅，后端恢复后自动补存离线期间的修改，并重新应用工作区 | A | ✅ |
| 快速打开（Ctrl+P）能列出当前文件 | B | ✅ |
| 粘贴小图片：保存到 `<笔记>.assets/`，并插入相对路径引用 | B | ✅ |
| 打包版中强制结束 NextTyproa.exe 后，Java 后端会在 8 秒内自动退出 | C | ✅ |

## 未能覆盖 / 测试局限

- **系统原生对话框**：打开文件夹、打开文件、导出 HTML/PDF 的保存对话框都无法自动化，所以导出只在 API 层面验证过。"打开文件"改用"第二实例传入文件路径"来测试，这和双击 `.md` 走的是同一条代码路径。
- **文件关联**：`.md` 文件关联只有 NSIS 安装包才会注册，本次测试的是 `win-unpacked`。
- **真实输入法**：文字输入使用 CDP 的 `Input.insertText` 和合成键盘事件，没有覆盖中文输入法的组字过程。
- **真实拖放**：从资源管理器拖入图片或文件没有覆盖，图片测试使用的是合成的 paste 事件。
- **其他**：PicGo 图床、超过 12 个标签的恢复上限、10k 以上文件的大型 vault 性能、多显示器、打印，都没有覆盖。
- **Alt+F4**：没有单独测试，窗口关闭使用的是标题栏的关闭按钮。
- **打包版**：因为 RW-P0-001 导致几乎所有笔记都无法打开和保存，打包版的退出保存、多标签保存等流程没法进一步测试。修复后需要在打包版上把本清单全部复测一遍。

## 其他观察（不单独列为缺陷）

- 请求体是格式错误的 JSON 时，后端返回 500 "JSON parse error"，按理应返回 400。这只影响直接调用 API 的场景。
- 打开 3 MB 的笔记大约需要 5 秒。
- 大于 2 MB 的文件不进入搜索索引（界面上有提示）。
