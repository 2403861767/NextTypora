# 打包版复测夹具

这里是**手工复测用的输入数据**，不是自动化测试。自动化测试在 `backend/src/test/`、
`frontend/src/**/*.test.tsx` 和 `electron/*.test.js` 里，各自建自己的临时目录。

这个目录曾经在 `799a03f` 被整体删除，`.gitignore` 里同时加了一条 `test/`（不带前导斜杠，
于是连 `backend/src/test/` 也一起忽略了）。V103-16 修了那条规则，V103-17 把夹具取回来。
**不要再忽略这个目录**：它被忽略时，往里面放文件不会报错，只会悄悄消失。

## 两个工作区

| 目录 | 用途 |
| --- | --- |
| `e2e-vault/` | 主工作区，覆盖下面所有情况 |
| `e2e-vault-2/` | 第二个工作区，只用来验「切换工作区」后文件树、搜索索引、标签页是否跟着换 |

## `e2e-vault/` 里每样东西是干什么的

| 路径 | 覆盖什么 |
| --- | --- |
| `编码/gbk.md` `big5.md` `sjis.md` | 无 BOM 的遗留编码检测。打开后保存必须**沿用原编码**，不能静默转成 UTF-8 |
| `编码/utf8-bom.md` `utf16.md` | BOM 识别与保留（`utf16.md` 是记事本「Unicode」格式，带 FF FE） |
| `😀表情文件名.md` `日记/笔记A.md` | 非 ASCII 文件名：BMP 外的 emoji（代理对）与 CJK |
| `会议纪要 2024.01.05.md` + 同名 `.assets/` | 文件名里有空格和点，且带资产目录——重命名/移动时资产目录要跟着走 |
| `图片笔记.assets/pic.png` `附件/logo.png` | 本地图片资产引用（都是 1x1，只为占位） |
| `附件/拖拽测试.png` | 96x96，肉眼看得见。手工复测「从资源管理器拖图进编辑器」时拖它 |
| `附件/readme.txt` | 非 Markdown 文件：出现在文件树里，但不进搜索索引（`拖拽测试.png` 同理） |
| `空文件.md` | 零字节文件，不能当成二进制或报错 |
| `日记/2026-09-24.conflict-20260925-000629.md` | 冲突副本的命名形态（1.0.3 起这是外部修改的唯一数据防线之一） |
| `读书笔记/frontmatter.md` | Frontmatter 搜索。注意它的分隔符历史上被写成了 `***` 而不是 `---`，这是真实的脏数据，刻意保留 |
| `ascii-notes.md` | Markdown 语法覆盖面：表格、任务列表、脚注、硬换行、裸 HTML、mermaid 源块 |
| `数学公式.md` | 行内与块级 `$` 公式，外加一组**不该**被当成公式的 `$`（代码块、行内代码、价格）。1.0.3 的公式导出走前端 KaTeX，见 [ADR-0003](../docs/adr/0003-export-fidelity-in-renderer.md) |
| `.nexttyproa-backups/` 两处 | 1.0.3 之前留下的备份残留，供偏好设置 →「存储」的扫描有东西可扫 |

`.nexttyproa-backups/` 是 `.gitignore` 的一条例外（只对这个夹具目录开口），因为保存时
产生备份已经移除了，见 [ADR-0001](../docs/adr/0001-no-save-time-backups.md)。

## 字节是夹具的一部分

`test/.gitattributes` 里的 `* -text` 关掉了换行转换。仓库全局 `core.autocrlf=true` 会把
GBK / Big5 / Shift_JIS 这些「没有 NUL 字节、看起来像文本」的文件在检出时换成 CRLF，而带
BOM 的 UTF-16 因为含 NUL 被 git 判成二进制、保持 LF——同一个目录里行尾就不一致了，而且取决于
检出机器的配置。编码夹具存在的理由就是字节本身，所以把它冻住。

改这里的文件前先想清楚：**多数情况下你不该改**。要加情况就加新文件。

## 已核过的基线

把 `e2e-vault/` 挂到真后端上实测的结果（2026-11-02，1.0.3）。手工复测时如果看到的
不是这些数字，先怀疑夹具被改脏了，再怀疑产品。

| 观察点 | 基线 |
| --- | --- |
| 文件树里的文件数 | 21（`.assets` 目录本身不出现在树里，是刻意过滤的） |
| 搜索索引 | `indexedFiles=18 / totalFiles=18`，失败 0、跳过 0——两个 png 和一个 txt 不入索引 |
| `编码/gbk.md` | 识别为 `GBK`，`hasBom=false` |
| `编码/big5.md` | 识别为 `Big5`，`hasBom=false` |
| `编码/sjis.md` | 识别为 `Shift_JIS`，`hasBom=false` |
| `编码/utf8-bom.md` | 识别为 `UTF-8`，`hasBom=true` |
| `编码/utf16.md` | 识别为 `UTF-16LE`，`hasBom=true` |
| 改 `编码/gbk.md` 后保存 | 仍然只能按 GBK 解码、**不能**按 UTF-8 解码（后者就意味着静默转码了） |
| `.nexttyproa-backups/` 扫描 | 两个目录、各 2 个文件，583 + 225 = `totalBytes 808`，与磁盘逐字节一致 |
| `😀表情文件名.md` | 全程可读写（BMP 外字符走代理对，历史上是出过问题的一类） |

## 怎么用

复测清单在 `.scratch/v1.0.3/issues/17-packaged-build-retest-minimal.md`。把
`e2e-vault/` 复制到仓库外一份再用——直接拿仓库里这份当工作区去编辑，会把夹具改脏，
而且 `git status` 会混进复测产生的噪音。
