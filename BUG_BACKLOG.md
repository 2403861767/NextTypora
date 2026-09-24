# NextTypora Bug Backlog

**最后更新**: 2026-09-23  
**诊断范围**: Frontend (React/TypeScript) + Backend (Spring Boot/Java) + Electron

---

## P0 - 阻塞级 / 崩溃

### - [x] BUG-P0-001: 内存泄漏 - pathLocks 无限增长
**问题概述**: `NoteService.pathLocks` ConcurrentHashMap 只增不减，每次访问新文件路径都会创建新的锁对象，长期运行会导致内存泄漏。

**涉及文件**:
- [backend/src/main/java/com/nexttyproa/service/NoteService.java:21](backend/src/main/java/com/nexttyproa/service/NoteService.java#L21)
- [backend/src/main/java/com/nexttyproa/service/NoteService.java:147-149](backend/src/main/java/com/nexttyproa/service/NoteService.java#L147-L149)

**原因分析**:
```java
private final Map<String, Object> pathLocks = new ConcurrentHashMap<>();
private Object lockFor(String relativePath) {
    return pathLocks.computeIfAbsent(relativePath, ignored -> new Object());
}
```
每个被访问过的文件路径都会永久保留锁对象，即使文件已被删除。在大型 vault 中会导致显著内存浪费。

**验证方法**:
1. 监控 JVM 堆内存使用：`jmap -heap <pid>`
2. 打开/关闭数百个不同路径的文件
3. 观察 `pathLocks` Map 大小持续增长且不释放
4. 删除文件后锁对象仍然存在

**修复建议**: 使用弱引用或带驱逐策略的缓存（如 Guava Cache、Caffeine），或在文件删除时清理锁对象。

---

### - [x] BUG-P0-002: 后端崩溃 - 无 token 配置时启动失败
**问题概述**: Production 模式下如果 `AUTH_TOKEN` 环境变量未设置，后端会使用默认 dev token 启动，但 Electron main.js 期望读取日志中的 `NEXTTYPROA_TOKEN=`，如果未输出会导致启动超时失败。

**涉及文件**:
- [backend/src/main/java/com/nexttyproa/config/AppProperties.java:10](backend/src/main/java/com/nexttyproa/config/AppProperties.java#L10)
- [electron/main.js:226-283](electron/main.js#L226-L283)

**原因分析**:
- `AppProperties` 默认值是硬编码的 `"dev-token-change-me"`
- Electron 在 production 模式生成随机 token 并传给后端
- 但后端启动时不一定会输出 `NEXTTYPROA_TOKEN=` 到日志
- 如果 60 秒内未匹配到 token，启动超时

**验证方法**:
1. 打包应用：`npm run dist:dir`
2. 清除环境变量 `AUTH_TOKEN`
3. 启动应用，观察是否超时失败
4. 检查后端日志是否输出 `NEXTTYPROA_TOKEN=`

---

### - [x] BUG-P0-003: 文件系统竞态 - 重命名/移动期间打开文件崩溃
**问题概述**: 当用户正在编辑某个文件时，如果另一个用户（或外部程序）重命名/移动该文件，前端保存时会因路径不存在而失败，且没有恢复机制。

**涉及文件**:
- [frontend/src/App.tsx:98-147](frontend/src/App.tsx#L98-L147) (`useDebouncedSave`)
- [backend/src/main/java/com/nexttyproa/service/NoteService.java:41-73](backend/src/main/java/com/nexttyproa/service/NoteService.java#L41-L73)
- [backend/src/main/java/com/nexttyproa/service/FileSystemService.java:66-93](backend/src/main/java/com/nexttyproa/service/FileSystemService.java#L66-L93)

**原因分析**:
- 重命名/移动文件后，`IndexService` 会更新索引
- 但前端打开的 tab 仍然持有旧路径
- 自动保存时向旧路径写入会触发 404 错误
- 前端只标记为 `saveStatus: 'error'`，不会更新 tab 路径

**验证方法**:
1. 打开文件 `test.md` 并编辑
2. 在外部资源管理器中重命名为 `test-renamed.md`
3. 在应用中刷新文件树
4. 继续编辑，触发自动保存
5. 观察保存失败，但无提示让用户另存为

---

### - [x] BUG-P0-004: Electron 主进程崩溃 - 后端进程未正确清理
**问题概述**: 当 Electron 主进程异常退出（如 kill -9）时，后端 Java 进程可能成为孤儿进程继续运行，占用端口和内存。

**涉及文件**:
- [electron/main.js:772-791](electron/main.js#L772-L791)
- [electron/main.js:252-308](electron/main.js#L252-L308)

**原因分析**:
- `backendProcess.kill()` 在 `will-quit` 事件中调用
- 如果主进程被强制杀死（SIGKILL），事件不会触发
- 后端进程未设置父进程监听，不会自动退出

**验证方法**:
1. 启动应用（production 模式）
2. 查看后端 Java 进程 PID
3. 强制杀死 Electron 主进程：`taskkill /F /IM NextTyproa.exe`
4. 检查 Java 进程是否仍在运行

**修复建议**: 后端添加父进程存活检测，或使用进程组管理。

---

## P1 - 业务逻辑错误

### - [x] BUG-P1-001: 冲突检测不一致 - 新文件首次保存无 baseHash
**问题概述**: 创建新文件后首次保存时，前端不会发送 `baseHash`，导致后端跳过冲突检测，可能覆盖外部修改。

**涉及文件**:
- [frontend/src/App.tsx:114](frontend/src/App.tsx#L114) (`saveNote(savePath, saveContent, saveBaseHash)`)
- [backend/src/main/java/com/nexttyproa/service/NoteService.java:52-62](backend/src/main/java/com/nexttyproa/service/NoteService.java#L52-L62)

**原因分析**:
- `useDebouncedSave` 的 `baseHash` 来自上次加载的 `contentHash`
- 新创建的文件在首次自动保存前，`baseHash` 为 `undefined`
- 后端检查：`if (fileService.exists(file) && !request.isForce() && request.getBaseHash() != null && !request.getBaseHash().isBlank())`
- `baseHash == null` 时直接跳过冲突检测

**验证方法**:
1. 创建新文件 `test.md`，写入 "initial content"
2. 在自动保存前（800ms 内），用外部编辑器打开并修改
3. 等待自动保存触发
4. 检查文件内容是否被覆盖（预期应冲突）

---

### - [x] BUG-P1-002: 搜索索引不一致 - 保存失败仍更新索引
**问题概述**: 文件保存失败（如磁盘满、权限错误）时，`IndexService` 仍会更新索引，导致索引内容与磁盘不一致。

**涉及文件**:
- [backend/src/main/java/com/nexttyproa/service/NoteService.java:68-69](backend/src/main/java/com/nexttyproa/service/NoteService.java#L68-L69)

**原因分析**:
```java
fileService.writeFileAtomic(file, nextContent, encoding, hasBom, fileService.exists(file));
indexService.indexNote(vaultRoot, relativePath, nextContent);
```
如果 `writeFileAtomic` 抛出异常（IOException），`indexNote` 不会执行。但如果写入部分成功后失败（极端情况），索引会更新。更重要的是，索引更新在事务外。

**验证方法**:
1. 创建文件 `test.md`
2. 修改文件权限为只读
3. 尝试保存编辑内容
4. 检查索引中是否包含未保存的内容

---

### - [ ] BUG-P1-003: 路径规范化不一致 - Windows 反斜杠混用
**问题概述**: 前端和后端对路径规范化处理不一致，Windows 下 `\` 和 `/` 混用可能导致路径匹配失败。

**涉及文件**:
- [frontend/src/App.tsx:189-191](frontend/src/App.tsx#L189-L191) (`normalizeTreePath`)
- [backend/src/main/java/com/nexttyproa/service/NoteService.java:131-133](backend/src/main/java/com/nexttyproa/service/NoteService.java#L131-L133)
- [backend/src/main/java/com/nexttyproa/service/IndexService.java:264-266](backend/src/main/java/com/nexttyproa/service/IndexService.java#L264-L266)

**原因分析**:
- 前端统一使用 `/`：`path.replace(/\\/g, '/')`
- 后端多处使用：`path.replace('\\', '/')`（只替换一次）
- Java 的 `replace` 不是正则，需要用 `replaceAll` 或循环

**验证方法**:
1. Windows 环境创建深层文件夹：`folder1\subfolder1\subfolder2\test.md`
2. 检查后端日志中路径格式
3. 搜索文件，检查是否能匹配到
4. 重命名/移动文件，检查路径是否正确更新

---

### - [ ] BUG-P1-004: 文件树刷新 - 全量重建索引性能差
**问题概述**: 用户点击刷新文件树时，后端会全量遍历并重建索引，大型 vault（10k+ 文件）会阻塞数秒。

**涉及文件**:
- [backend/src/main/java/com/nexttyproa/service/FileSystemService.java:139-143](backend/src/main/java/com/nexttyproa/service/FileSystemService.java#L139-L143)
- [backend/src/main/java/com/nexttyproa/service/IndexService.java:93-133](backend/src/main/java/com/nexttyproa/service/IndexService.java#L93-L133)

**原因分析**:
- `refreshTree()` 调用 `indexService.reindexVault(vaultRoot)`
- `reindexVault` 使用 `Files.walk` 全量遍历
- `indexing = true` 期间阻塞搜索请求
- 没有增量更新机制

**验证方法**:
1. 创建包含 10000 个 .md 文件的测试 vault
2. 点击刷新按钮
3. 测量响应时间和 CPU 使用率
4. 在刷新期间尝试搜索，观察是否被阻塞

---

### - [ ] BUG-P1-005: 编码检测错误 - GBK/Big5 误判为 UTF-8
**问题概述**: `FileService` 的编码检测顺序不当，UTF-8 解码器过于宽容，可能错误解码非 UTF-8 文件导致乱码。

**涉及文件**:
- [backend/src/main/java/com/nexttyproa/service/FileService.java:58-83](backend/src/main/java/com/nexttyproa/service/FileService.java#L58-L83)

**原因分析**:
```java
String utf8Content = tryDecode(body, StandardCharsets.UTF_8);
if (utf8Content != null) {
    return new ReadFileResult(utf8Content, DEFAULT_ENCODING, false);
}
for (String candidate : new String[] {"GBK", "Big5", "Shift_JIS"}) { ... }
```
- UTF-8 检测使用 `CharsetDecoder` 的 `REPORT` 模式
- 但某些 GBK 字节序列恰好是合法 UTF-8
- 应该先检测 BOM，再统计字节模式概率

**验证方法**:
1. 创建 GBK 编码文件，内容包含中文："测试文件内容"
2. 用应用打开
3. 检查是否出现乱码
4. 查看返回的 `encoding` 字段是否正确

---

### - [ ] BUG-P1-006: 删除文件夹后 - 索引残留已删除文件
**问题概述**: 删除文件夹后调用全量 `reindexVault`，但在重建索引期间，旧索引仍包含已删除文件，搜索会返回无效结果。

**涉及文件**:
- [backend/src/main/java/com/nexttyproa/service/FileSystemService.java:54-56](backend/src/main/java/com/nexttyproa/service/FileSystemService.java#L54-L56)
- [backend/src/main/java/com/nexttyproa/service/IndexService.java:94-95](backend/src/main/java/com/nexttyproa/service/IndexService.java#L94-L95)

**原因分析**:
```java
deleteDirectory(target);
indexService.reindexVault(vaultRoot);
```
- `reindexVault` 先 `clear()` 再重建，但这两步不是原子操作
- 删除大文件夹后，重建索引需要时间
- 此时搜索请求会看到空索引或不完整索引

**验证方法**:
1. 创建包含 1000 个文件的文件夹
2. 删除该文件夹
3. 立即执行搜索
4. 观察是否返回已删除文件或搜索结果为空

---

### - [ ] BUG-P1-007: WorkspaceController 缺失 /tree/refresh 端点
**问题概述**: 前端调用 `refreshWorkspace()` 访问 `/api/tree/refresh`，但 `WorkspaceController` 中未定义此端点，应该在 `FileSystemController` 中。

**涉及文件**:
- [frontend/src/api.ts:106-108](frontend/src/api.ts#L106-L108)
- [backend/src/main/java/com/nexttyproa/controller/WorkspaceController.java](backend/src/main/java/com/nexttyproa/controller/WorkspaceController.java)
- [backend/src/main/java/com/nexttyproa/service/FileSystemService.java:139-143](backend/src/main/java/com/nexttyproa/service/FileSystemService.java#L139-L143)

**原因分析**:
- 前端 `refreshWorkspace()` 期望返回 `TreeNode[]`
- 但 `WorkspaceController` 只有 `/tree`（GET）端点
- `/tree/refresh`（POST）端点缺失或在错误的 controller 中

**验证方法**:
1. 启动应用
2. 打开浏览器 DevTools Network 面板
3. 点击文件树刷新按钮
4. 检查请求是否返回 404

---

### - [ ] BUG-P1-008: Electron before-quit 超时 - flush-save 可能丢失数据
**问题概述**: 应用退出时给前端 3 秒时间保存，超时后强制退出，可能导致未保存内容丢失。

**涉及文件**:
- [electron/main.js:772-785](electron/main.js#L772-L785)
- [frontend/src/App.tsx](frontend/src/App.tsx)（需查找 flush-save 处理逻辑）

**原因分析**:
```javascript
flushSaveTimeout = setTimeout(() => {
    quitting = true;
    app.quit();
}, 3000);
```
- 如果前端有多个脏标签页，3 秒可能不够
- 如果网络慢或后端响应慢，保存会超时
- 没有向用户显示保存进度

**验证方法**:
1. 打开 10 个文件并编辑（不要等自动保存）
2. 点击关闭应用
3. 观察是否所有文件都保存成功
4. 检查是否有数据丢失

---

## P2 - 性能 / UI / 代码隐患

### - [ ] BUG-P2-001: IndexService 性能 - 大文件全文存储占用内存
**问题概述**: `IndexService` 的 `IndexedNote` 记录完整文件内容，大型 vault 会占用数百 MB 内存，且内容仅用于生成 snippet。

**涉及文件**:
- [backend/src/main/java/com/nexttyproa/service/IndexService.java:445-458](backend/src/main/java/com/nexttyproa/service/IndexService.java#L445-L458)
- [backend/src/main/java/com/nexttyproa/service/IndexService.java:60-68](backend/src/main/java/com/nexttyproa/service/IndexService.java#L60-L68)

**原因分析**:
```java
private record IndexedNote(
    String path,
    String title,
    String content,  // 完整内容存储在内存
    Map<String, String> frontmatter,
    Set<String> tags,
    String hash,
    Instant updatedAt
) { }
```
- 1000 个 10KB 文件 = 10MB 内存
- 只有搜索时需要内容来生成 snippet
- 可以只存储前 N 行或关键词索引

**验证方法**:
1. 创建 10000 个 50KB 的 .md 文件（总计 ~500MB）
2. 刷新工作区，触发全量索引
3. 使用 VisualVM 或 JProfiler 监控堆内存
4. 检查 `IndexService.notes` Map 占用的内存

**优化建议**: 只存储 title、tags、frontmatter 和路径，搜索时按需读取文件生成 snippet。

---

### - [ ] BUG-P2-002: 搜索性能 - 每次搜索都是全量扫描
**问题概述**: 搜索使用 `toLowerCase().indexOf()`，时间复杂度 O(n*m)，大型 vault 中搜索响应慢。

**涉及文件**:
- [backend/src/main/java/com/nexttyproa/service/IndexService.java:192-232](backend/src/main/java/com/nexttyproa/service/IndexService.java#L192-L232)

**原因分析**:
```java
List<SearchHit> hits = notes.values().stream()
    .map(note -> match(note, normalizedQuery, scopes))
    .filter(SearchHit::matched)
    .sorted(comparatorFor(sort))
    .toList();
```
- 每次搜索遍历所有文件
- `indexOf()` 无法利用倒排索引
- 10000 文件的搜索可能需要数百毫秒

**验证方法**:
1. 创建 10000 个文件
2. 搜索常见词汇："test"
3. 测量响应时间
4. 使用 JProfiler 分析 CPU 热点

**优化建议**: 使用 Lucene 或构建简单的倒排索引。

---

### - [ ] BUG-P2-003: FileService 备份策略 - .bak 文件无限累积
**问题概述**: 每次保存都创建 `.bak` 备份，但从不清理，长期使用会产生大量备份文件占用磁盘空间。

**涉及文件**:
- [backend/src/main/java/com/nexttyproa/service/FileService.java:126-136](backend/src/main/java/com/nexttyproa/service/FileService.java#L126-L136)

**原因分析**:
```java
String timestamp = Instant.now().toString().replace(":", "").replace(".", "-");
Files.copy(file, backupDir.resolve(fileName + "." + timestamp + ".bak"), ...);
```
- 每次保存生成唯一时间戳备份
- 没有清理策略（如只保留最近 10 个）
- `.nexttyproa-backups` 文件夹会无限增长

**验证方法**:
1. 编辑文件并保存 100 次
2. 检查 `.nexttyproa-backups` 文件夹
3. 统计备份文件数量和占用空间

**优化建议**: 实现 LRU 清理策略，只保留最近 N 个备份。

---

### - [ ] BUG-P2-004: TreeNode 构建性能 - 递归无缓存
**问题概述**: `WorkspaceService.buildTree()` 每次都递归遍历整个文件系统，未使用缓存或增量更新。

**涉及文件**:
- [backend/src/main/java/com/nexttyproa/service/WorkspaceService.java:53-91](backend/src/main/java/com/nexttyproa/service/WorkspaceService.java#L53-L91)

**原因分析**:
- 每次前端请求 `/api/tree` 都重新构建
- 大型 vault 中遍历文件系统较慢
- 没有脏标记机制检测文件变化

**验证方法**:
1. 创建包含 5000 个文件的嵌套文件夹结构
2. 多次刷新文件树
3. 测量每次请求的响应时间
4. 检查后端 CPU 使用率

**优化建议**: 使用 FileWatcher 监听文件变化，维护缓存的树结构。

---

### - [ ] BUG-P2-005: 前端状态冗余 - openTabs 与 recentFiles 重复
**问题概述**: `openTabs` 和 `recentFiles` 存储重复数据（path、title），增加内存占用和同步复杂度。

**涉及文件**:
- [frontend/src/App.tsx:350-380](frontend/src/App.tsx#L350-L380)（状态定义区域）
- [frontend/src/App.tsx:482-502](frontend/src/App.tsx#L482-L502) (`rememberOpenedNote`)

**原因分析**:
```typescript
const [openTabs, setOpenTabs] = useState<EditorTab[]>([]);
const [recentFiles, setRecentFiles] = useState<RecentFileRef[]>([]);
```
- `openTabs` 包含完整编辑器状态
- `recentFiles` 只需路径引用
- 两者每次都要同步更新

**验证方法**:
1. 使用 React DevTools 查看状态树
2. 打开 20 个文件
3. 检查内存占用和状态大小

**优化建议**: `openTabs` 只存储编辑状态，文件元信息从 `recentFiles` 派生。

---

### - [ ] BUG-P2-006: Electron splash 窗口 - 未处理加载失败
**问题概述**: 如果后端启动失败，splash 窗口会一直显示，没有超时或错误提示。

**涉及文件**:
- [electron/main.js:101-222](electron/main.js#L101-L222) (`createSplashWindow`)
- [electron/main.js:750-765](electron/main.js#L750-L765)

**原因分析**:
- `startBackend()` 有 60 秒超时会 reject
- 但 splash 窗口只在 `createWindow()` 的 `ready-to-show` 时关闭
- 如果启动失败，splash 不会自动关闭

**验证方法**:
1. 修改 `backend.jar` 路径为不存在的路径
2. 启动应用
3. 观察 splash 窗口是否一直显示
4. 检查是否有错误弹窗

---

### - [ ] BUG-P2-007: 搜索 XSS 风险 - snippet 未完全转义
**问题概述**: 搜索结果 snippet 使用 `escapeHtml()` 但仍注入 `<mark>` 标签，如果文件名包含恶意内容可能导致 XSS。

**涉及文件**:
- [backend/src/main/java/com/nexttyproa/service/IndexService.java:234-254](backend/src/main/java/com/nexttyproa/service/IndexService.java#L234-L254)
- [backend/src/main/java/com/nexttyproa/service/IndexService.java:430-435](backend/src/main/java/com/nexttyproa/service/IndexService.java#L430-L435)

**原因分析**:
```java
return prefix
    + normalizeSnippetWhitespace(escapeHtml(before))
    + "<mark>" + escapeHtml(match) + "</mark>"
    + normalizeSnippetWhitespace(escapeHtml(after))
    + suffix;
```
- `<mark>` 是服务端直接拼接的 HTML
- 前端如果使用 `dangerouslySetInnerHTML` 渲染会有风险
- 应该使用前端组件高亮，或 DOMPurify 清理

**验证方法**:
1. 创建文件名包含：`<script>alert('XSS')</script>.md`
2. 搜索该文件
3. 检查前端是否执行脚本
4. 查看 HTML 是否正确转义

---

### - [ ] BUG-P2-008: Auth token 安全 - dev 模式硬编码 token
**问题概述**: Dev 模式使用硬编码的 `dev-token-change-me`，如果用户在生产环境误用 dev 配置会导致安全风险。

**涉及文件**:
- [frontend/src/api.ts:15](frontend/src/api.ts#L15)
- [backend/src/main/java/com/nexttyproa/config/AppProperties.java:10](backend/src/main/java/com/nexttyproa/config/AppProperties.java#L10)
- [electron/main.js:11](electron/main.js#L11)

**原因分析**:
- 默认 token 是公开的
- 如果用户在网络上暴露 dev 模式的后端，任何人都能访问
- 应该在 dev 模式显示警告

**验证方法**:
1. 启动 dev 模式：`npm run dev:backend`
2. 从另一台机器访问 `http://<ip>:8080/api/workspace`
3. 带上 `X-Auth-Token: dev-token-change-me`
4. 检查是否能访问

**修复建议**: Dev 模式随机生成 token，或在启动时打印警告。

---

### - [ ] BUG-P2-009: 文件名校验缺失 - 允许非法字符
**问题概述**: 前端和后端都没有严格校验文件名中的非法字符（Windows: `<>:"/\|?*`），可能导致文件系统错误。

**涉及文件**:
- [backend/src/main/java/com/nexttyproa/service/FileSystemService.java:193-204](backend/src/main/java/com/nexttyproa/service/FileSystemService.java#L193-L204)
- [frontend/src/App.tsx](frontend/src/App.tsx)（创建文件逻辑）

**原因分析**:
- `validateRenameTarget` 只检查 `.` 和 `..` 以及路径分隔符
- 没有检查 Windows 保留字符和保留名（如 `CON`, `PRN`）
- 用户可以创建 `test?.md`，但 Windows 会报错

**验证方法**:
1. 尝试创建文件名：`test<>file.md`
2. 检查是否报错或创建成功
3. 尝试创建保留名：`CON.md`

**修复建议**: 添加平台相关的文件名校验。

---

### - [ ] BUG-P2-010: 前端错误处理 - API 错误未区分类型
**问题概述**: 前端 `ApiError` 只有 `status` 和 `message`，没有根据错误类型（404/409/500）做差异化处理。

**涉及文件**:
- [frontend/src/api.ts:29-41](frontend/src/api.ts#L29-L41)
- [frontend/src/App.tsx](frontend/src/App.tsx)（错误处理逻辑）

**原因分析**:
- 所有错误都显示为通用的 `showError(message)`
- 409 冲突应该弹出合并对话框
- 404 应该提示文件不存在并移除 tab
- 500 应该显示详细错误日志

**验证方法**:
1. 触发不同类型的错误（删除文件后保存、网络错误等）
2. 检查用户提示是否明确
3. 查看是否有恢复操作

**优化建议**: 实现错误类型枚举和对应的 UI 处理策略。

---

### - [ ] BUG-P2-011: 代码重复 - 多处定义 Exception 类
**问题概述**: `NoteService`、`FileSystemService`、`AssetService` 各自定义了 `NotFoundException`、`BadRequestException` 等，应该抽取为公共异常类。

**涉及文件**:
- [backend/src/main/java/com/nexttyproa/service/NoteService.java:151-193](backend/src/main/java/com/nexttyproa/service/NoteService.java#L151-L193)
- [backend/src/main/java/com/nexttyproa/service/FileSystemService.java:206-223](backend/src/main/java/com/nexttyproa/service/FileSystemService.java#L206-L223)
- `AssetService.java`（类似）

**原因分析**:
- 每个 Service 都有内部静态类定义相同异常
- `GlobalExceptionHandler` 需要为每个类型单独处理
- 违反 DRY 原则

**验证方法**:
代码审查即可发现。

**优化建议**: 创建 `com.nexttyproa.exception` 包，定义全局异常类。

---

### - [ ] BUG-P2-012: 日志缺失 - 关键操作无审计日志
**问题概述**: 文件删除、重命名、移动等危险操作没有记录日志，无法追溯数据丢失原因。

**涉及文件**:
- [backend/src/main/java/com/nexttyproa/service/FileSystemService.java](backend/src/main/java/com/nexttyproa/service/FileSystemService.java)
- [backend/src/main/java/com/nexttyproa/service/NoteService.java](backend/src/main/java/com/nexttyproa/service/NoteService.java)

**原因分析**:
- 只有索引相关的 `log.warn` 日志
- 文件操作成功后没有记录
- 应该记录：操作类型、路径、用户、时间戳

**验证方法**:
1. 执行删除文件操作
2. 检查后端日志文件
3. 查看是否有操作记录

**优化建议**: 使用 SLF4J 记录所有文件系统操作。

---

### - [ ] BUG-P2-013: 测试覆盖率低 - 核心业务逻辑缺少单元测试
**问题概述**: 关键的 `FileService.resolveSafe()`、`IndexService.match()` 等方法缺少单元测试，重构时容易引入 bug。

**涉及文件**:
- [backend/src/test/](backend/src/test/)（查看测试覆盖率）

**验证方法**:
```bash
cd backend
mvn test
mvn jacoco:report
```
查看 `target/site/jacoco/index.html`

**优化建议**: 为核心逻辑添加单元测试，目标覆盖率 >80%。

---

### - [ ] BUG-P2-014: Electron IPC 未校验输入 - 潜在注入风险
**问题概述**: `ipcMain.handle` 处理的用户输入未做类型和格式校验，恶意渲染进程可能发送非法数据。

**涉及文件**:
- [electron/main.js:534-792](electron/main.js#L534-L792)（所有 ipcMain.handle）

**原因分析**:
```javascript
ipcMain.handle('settings:patch', (_event, patch) => {
  if (!patch || typeof patch !== 'object') {
    return loadSettings(app.getPath('userData'));
  }
  return patchSettings(app.getPath('userData'), patch);
});
```
- 只检查类型，不检查内容
- `patch` 可能包含原型污染攻击
- 应该使用白名单校验

**验证方法**:
1. 修改前端代码，发送 `{ __proto__: { isAdmin: true } }`
2. 检查是否能污染全局对象

**修复建议**: 使用 JSON Schema 校验 IPC 消息。

---

### - [ ] BUG-P2-015: 前端未处理后端断线 - 无重连机制
**问题概述**: 如果后端崩溃或重启，前端继续发送请求会一直失败，没有提示用户重启应用或重连。

**涉及文件**:
- [frontend/src/api.ts:82-89](frontend/src/api.ts#L82-L89) (`healthCheck`)
- [frontend/src/App.tsx](frontend/src/App.tsx)

**原因分析**:
- 只有启动时调用 `healthCheck()`
- 运行时没有心跳检测
- 后端断线后，前端只会显示通用错误

**验证方法**:
1. 启动应用
2. 手动杀死后端进程
3. 尝试保存文件
4. 检查是否有明确提示

**优化建议**: 实现心跳检测和重连逻辑。

---

## 总结

- **P0 级 bug**: 4 个（内存泄漏、启动失败、竞态条件、进程泄漏）
- **P1 级 bug**: 8 个（业务逻辑错误、数据一致性问题）
- **P2 级 bug**: 15 个（性能优化、代码质量、安全加固）

**建议优先修复顺序**:
1. **BUG-P0-001**: 内存泄漏（生产环境崩溃风险）
2. **BUG-P0-003**: 文件重命名竞态（数据丢失风险）
3. **BUG-P1-001**: 冲突检测不一致（数据覆盖风险）
4. **BUG-P1-003**: 路径规范化（Windows 兼容性）
5. **BUG-P2-001/002**: 索引性能优化（用户体验）

**测试建议**:
- 添加集成测试覆盖文件操作的并发场景
- 使用 JMH 对 `IndexService` 进行基准测试
- Windows + CJK 文件名的端到端测试
- 大型 vault（10k+ 文件）的压力测试
