# V103-17: 打包版最小复测集

Status: resolved
Type: Change
Commit prefix: `Change V103-17:`
Spec section: 10（见 ../spec.md）

## 背景

`BUG_BACKLOG_REAL_WORLD.md` 明确要求「修复后需要在打包版上把本清单全部复测一遍」，**无证据显示发生过**，且复测夹具在 `799a03f` 被删。

## 改动

不恢复全部 27 项，只跑 6 项真正只能在打包版上验证的：

1. NSIS 安装
2. `.md` 文件关联（历史上只测过 `win-unpacked`，安装版从未测）
3. 原生对话框（打开文件夹 / 导出另存为）
4. 真实中文输入法联想（历史上用 CDP `Input.insertText` 代替过）
5. 从资源管理器真实拖拽图片（历史上用合成粘贴代替过）
6. Alt+F4 退出时保存

夹具重建一个小的（GBK / Big5 / UTF-16 / CJK 文件名各一个）并**提交进仓库**。

共同点：这 6 项在开发模式下永远测不出来——`RW-P0-001` 就是只在打包版出现的阻断性缺陷。多显示器、万级工作区性能、打印推迟到 1.0.4+。

## 验收

6 项全部在 NSIS 安装版上实际走过一遍，结果记录在本文件的 `## Comments` 下。依赖 V103-16（取回「未能覆盖」清单）。

## Comments

- 前置阻塞已解除：新建的夹具文件原本会被 `.gitignore` 的 `test/` 静默忽略，该规则已锚定为 `/test/`（见 V103-16）。这也正是 799a03f 丢掉上一套 e2e 夹具的机制。

## 进展（2026-11-01）：一半能自动做，一半必须真人

这 6 项不是一个同质的清单。按"谁能做"重新分成两组。

### 我能做的

**1. NSIS 安装包能否正确产出** —— 已验证，见下方「产物核对」。这同时是 V103-05 / V103-06 / V103-12 的端到端证明：产物名、PE 元数据、`latest.yml` 是否都说 1.0.3 和 NextTypora。

### 必须你来做的（我不该替你做）

**2. 安装到你的系统**：把安装包装上去会改动你的机器、注册文件关联、写注册表。这属于"外向且难撤销"的动作，需要你点头，而且装完之后下面几项才有条件做。

**3. 原生对话框**（打开文件夹 / 导出另存为）：要驱动的是 Windows 自己的对话框，不在应用的 DOM 里，CDP 够不着。

**4. 真实中文输入法联想**：历史上这一项是用 CDP `Input.insertText` 代替的，而那恰恰绕开了 composition 事件——也就是绕开了真正要测的东西。只有真人用输入法打字才算数。

**5. 从资源管理器真实拖拽图片**：历史上用合成粘贴代替，同样绕开了真实的 drop 事件与文件路径。

**6. Alt+F4 退出时保存**：需要真实的窗口管理器按键，而且验证点是"没保存的内容有没有丢"。

## 进展（2026-11-02）：夹具取回来了，基线也对过了

### 夹具

`799a03f` 删掉的 e2e 夹具已从历史里取回到 `test/`，并补上了两处在更早的提交里就丢掉的文件：
`编码/utf16.md`（`ba867ca` 删的）和 `😀表情文件名.md`（`290acd6` 删的）。
说明见 [`test/README.md`](../../../test/README.md)。

没有照搬全部：

- **没恢复 `大文件/large.md`（3.1 MB）**。ticket 要求的是"一个小的"夹具，而万级工作区/大文件性能
  按 spec 推迟到 1.0.4+。要测索引跳过 >2MB 的那条通路时再单独生成。
- **没恢复 `test/VERIFICATION_STEPS.md` 和 `test/test.md`**。那是 BUG-P0-003 一个缺陷的验证记录，
  缺陷早已关闭，留着就是第三份会过期的文档。顺带一提：那份文档最后一节写的就是
  `rm -rf d:/project/NextTypora/test/`——夹具正是这么消失的。

同时拆掉了三个让夹具会再次悄悄消失的陷阱：

1. `.gitignore` 里的 `/test/` 整条删掉了。它被忽略时，往 `test/` 放文件不会报错，只会消失。
2. `test/.gitattributes` 加了 `* -text`。仓库全局 `core.autocrlf=true` 会把 GBK / Big5 /
   Shift_JIS（没有 NUL 字节、看起来像文本）在检出时换成 CRLF，而带 BOM 的 UTF-16 因为含 NUL
   被 git 判成二进制、保持 LF——同一个编码夹具目录里行尾就不一致，而且取决于检出机器的配置。
   这不是假想：第一次取回来时 gbk/big5/sjis/utf8-bom 四个文件确实变成了 CRLF，utf16 没变。
3. `.nexttyproa-backups/` 的忽略规则对这个夹具目录开了个口子，否则第 9 项没东西可扫。

### 对过的基线（真后端，不是单元测试夹具）

把 `e2e-vault/` 复制一份挂到真后端（`backend/target/backend.jar`，8099 端口）上实测：

| 观察点 | 结果 |
| --- | --- |
| 文件树 | 21 个文件；`.assets` 目录本身不出现在树里 |
| 搜索索引 | `indexedFiles=18 / totalFiles=18`，失败 0、跳过 0——两个 png 和一个 txt 不入索引 |
| 五种编码识别 | `GBK` / `Big5` / `Shift_JIS` / `UTF-8`+BOM / `UTF-16LE`+BOM，全部正确 |
| 改 GBK 文件后保存 | 仍只能按 GBK 解码、**不能**按 UTF-8 解码，追加的中文原样读回 |
| `.nexttyproa-backups/` 扫描 | 两个目录各 2 文件，583 + 225 = `totalBytes 808`，与磁盘逐字节一致 |
| `😀表情文件名.md` | 全程可读写 |

这些是**开发模式下就能验的部分**，所以我验了。它们不构成打包版复测——同样的代码在打包版里
走的是随机端口 + 临时令牌 + 内嵌 JRE，而 `RW-P0-001` 当年就是只在打包版出现的阻断性缺陷。

## 复测清单（需要真人跑）

### 准备

1. 安装包在 [`release/NextTypora-1.0.3-win-x64.exe`](../../../release/NextTypora-1.0.3-win-x64.exe)。
2. **把 `test/e2e-vault/` 复制到仓库外**（例如 `D:/retest-vault`）再当工作区打开。直接用仓库里
   那份会把夹具改脏，`git status` 也会混进复测噪音。
3. 装之前先确认 `%APPDATA%` 下的设置目录叫 `nexttyproa`（小写、历史错拼）。V103-12 只改了显示名，
   应用身份用 `app.setName('NextTyproa')` 钉住了——如果装完出现一个新的 `NextTypora` 目录，
   说明那条钉子失效，你的设置会"丢"。

### 清单

| # | 操作 | 期望 | 结果 |
| --- | --- | --- | --- |
| 1 | 双击 `e2e-vault/ascii-notes.md` | 用 NextTypora 打开，不是记事本 | |
| 2 | 工具栏「打开文件夹」选 `e2e-vault` | **原生**对话框弹出，选中后文件树出现 21 个文件 | |
| 3 | 打开 `编码/gbk.md`，改一个字等自动保存，再用别的编辑器看编码 | 仍是 GBK，没被静默转成 UTF-8 | |
| 4 | 新建一条笔记，用输入法打一段中文并**联想选词** | 字符不丢、不重复、不乱序 | |
| 5 | 从资源管理器把 `附件/拖拽测试.png` 拖进编辑器 | 图片插入，同名 `.assets/` 下出现文件 | |
| 6 | 打开 `数学公式.md`，导出 HTML →「另存为」 | **原生**对话框弹出；导出的 HTML 里公式是渲染过的，而代码块、行内代码和 `$19` 这类价格里的 `$` 原样保留 | |
| 7 | 改几个字后直接 Alt+F4 | 退出前保存，重开内容还在 | |
| 8 | 偏好设置 →「关于」 | 显示 **1.0.3** | |
| 9 | 偏好设置 →「存储」→ 扫描 | 扫出 2 个目录 / 4 个文件 / 808 字节；确认删除后两个目录进回收站 | |
| 10 | 打开 `😀表情文件名.md`，重命名再改回来 | 全程正常，文件名不乱码 | |

第 3、6、8、9、10 项是本版新增或本版改动过的通路（V103-03/04/07/08/12），其余是历史清单里只能在
打包版验的那几项。

第 2、6 项之所以必须真人：要驱动的是 Windows 自己的对话框，不在应用 DOM 里，CDP 够不着。
第 4 项之所以必须真人：历史上这一项是用 CDP `Input.insertText` 代替的，而那恰恰绕开了
composition 事件——也就是绕开了真正要测的东西。
第 5 项同理，合成粘贴绕开了真实 drop 事件与文件路径。

多显示器、万级工作区性能、打印按 spec 推迟到 1.0.4+。

## 复测结果（2026-11-06，安装版上实际跑完 10 项）

### 执行前：release 里的安装包是旧的，先重新打包

`release/NextTypora-1.0.3-win-x64.exe` 的构建时间是 11-01 23:04，**早于 `fe0d9e8`**（修 author
拼写）。它的 PE 元数据仍是 `CompanyName=nextTyproa`；而旁边的 `win-unpacked\NextTypora.exe`
（23:05:49，晚一分钟）却已经是 `NextTypora`。也就是说当时只重新出了未打包目录，没有重出安装包，
`latest.yml` 记录的 sha512/size 指向的也是那个旧包。

所以先 `npm run dist:verify -- --expect-version 1.0.3`（全绿）再 `electron-builder --win nsis`
重新出包。新包：`ProductName/CompanyName=NextTypora`、`FileVersion=1.0.3`、
`LegalCopyright=Copyright © 2026 NextTypora`，`latest.yml` 的 sha512 与 size 同步更新。
**这一条本身就是一个教训**：V103-06 让版本号有了唯一来源，但没有任何东西保证 `release/` 里的
产物与 HEAD 同步。

### 安装

`NextTypora-1.0.3-win-x64.exe /S /currentuser /D=D:\software\nextTypora`，退出码 0，8.4 秒，
装到了指定目录。装完核对：

| 项 | 结果 |
| --- | --- |
| 安装目录 | `D:\software\nextTypora`，`resources\` 下 `backend.jar`（47.5 MB）、`jre\bin\java.exe`、`icon.ico` 齐全 |
| exe 元数据 | ProductName / CompanyName = NextTypora，FileVersion 1.0.3 |
| 卸载项 | `NextTypora 1.0.3`，Publisher `NextTypora`；**`InstallLocation` 是空的** |
| 快捷方式 | 桌面与开始菜单各一个，指向 `D:\software\nextTypora\NextTypora.exe` |
| 设置目录 | 装完后、以及用真实 userData 跑过一次之后，`%APPDATA%` 下**仍然只有 `nexttyproa`**，没有出现 `NextTypora` —— V103-12 的身份钉子有效 |
| 用户真实 settings.json | 复测全程用独立 `--user-data-dir`；唯一一次用真实 userData 的运行前后做了备份与还原，SHA-256 回到 `5604701E…1BFE6` |

两点关于安装目录：`build/installer.nsh` 的 `.onVerifyInstDir` 会给用户选的目录强制追加
`nextTyproa` 子目录（**拼写仍是旧的**）。静默安装不走目录页，所以 `/D=` 原样生效；但走 GUI 选
`D:\software\nextTypora` 会装成 `D:\software\nextTypora\nextTyproa`。

### 10 项结果

| # | 操作 | 期望 | 结果 |
| --- | --- | --- | --- |
| 1 | 双击 `.md` | 用 NextTypora 打开 | **不通过（非应用缺陷，见下节）**：注册正确、命令可用，但本机默认程序是 Typora |
| 2 | 工具栏「打开文件夹」选 vault | 原生对话框 + 21 个文件 | **通过**：真实 `#32770` 对话框「打开文件夹」，真实点击「选择文件夹」，文件树 21 文件 / 5 目录；后端 `indexedFiles=18 / totalFiles=18`，失败 0、跳过 0 |
| 3 | 改 `编码/gbk.md` 等自动保存 | 仍是 GBK | **通过**：95 → 98 字节，**前 95 字节与仓库夹具逐字节相同**，新增的 3 字节是 `x\n\n`；GBK 可解码、严格 UTF-8 解码抛异常、无 BOM |
| 4 | 输入法打中文并联想选词 | 不丢字、不重复、不乱序 | **通过**：真实扫描码敲 `nihao`，`compositionstart` → 5 次 `compositionupdate`（`n`→`ni`→`ni'h`→`ni'ha`→`ni'hao`）→ `compositionupdate 你好` → `compositionend 你好`；keydown 为 `key:"Process"`、`isComposing:true`；空格选词后编辑器与磁盘都是 `你好`，无拉丁残留 |
| 5 | 从资源管理器拖 `附件/拖拽测试.png` | 图片插入 + `.assets/` 出现文件 | **通过**：真实 OLE 拖拽（Explorer 行 → 编辑器），`打包版新笔记.assets/1793978463998-490541.png` 生成，markdown 写入 `![](打包版新笔记.assets/…png)` |
| 6 | 导出 HTML →「另存为」 | 原生对话框；公式渲染、`$` 原样 | **通过**：真实「导出为 HTML」保存对话框；产物 3498 字节，4 个 `<math>`（其中 1 个 `display="block"`），`\int…` 只出现在 KaTeX 的 `<annotation encoding="application/x-tex">` 里，无 `$$` 残留，**无任何 CDN 引用**，8 处非公式 `$` 全部原样（`echo $PATH`、`$HOME/bin`、`$19`、`$25`、`$foo`、`export PRICE=$100`、`"$USER owes $PRICE"`、表格里的 `` `$y$` ``） |
| 7 | 改几个字后直接 Alt+F4 | 退出前保存，重开内容还在 | **通过**：输入与 Alt+F4 在同一次注入里相隔 60 ms（落在 800 ms 自动保存防抖之内），进程 536 ms 后退出，磁盘 55 → 56 字节保住了那个字符，重开后标签页恢复且内容带着该字符 |
| 8 | 偏好设置 →「关于」 | 显示 1.0.3 | **通过**：`.settings-about-version` = `1.0.3`；区块为 主题与外观 / 编辑器 / 存储 / 图片上传 / 快捷键 / 关于 |
| 9 | 偏好设置 →「存储」→ 扫描 | 2 目录 / 4 文件 / 808 字节；删除后进回收站 | **通过**：扫描报「找到 2 个备份目录，共 808 B」，明细 `.nexttyproa-backups`（2 文件 583 B）与 `日记/.nexttyproa-backups`（2 文件 225 B）；点「移到回收站」后两个目录从磁盘消失，并在**系统回收站**里查到两条原始路径记录 |
| 10 | `😀表情文件名.md` 重命名再改回 | 全程正常、不乱码 | **通过**：真实右键菜单（7 项）→ 重命名 → `😀表情文件名-已改名.md`（旧名消失、新名存在、树里显示正确）→ 再改回，文件数仍为 21，后端审计日志两条重命名记录正常 |

### 第 1 项的期望写错了，需要改

安装程序做对了它能做的部分：注册了 ProgId `Markdown Document`，其
`shell\open\command` = `D:\software\nextTypora\NextTypora.exe "%1"`。这条命令实测可用——直接用
argv 启动安装版打开 `.markdown` 文件，状态栏显示文件名、正文正常渲染。

但**双击不会走到它**，原因在 Windows 不在应用：

- `AssocQueryString(".md", ASSOCSTR_COMMAND)` → `"D:\software\Typora\Typora.exe" "%1"`，
  因为 `HKCU\…\FileExts\.md\UserChoice` = `Typora.md`。Win8 之后 UserChoice 由系统签名保护，
  安装程序抢不到默认程序。
- `AssocQueryString(".markdown", …)` → `C:\Windows\system32\OpenWith.exe`，即「选取应用」弹窗。

所以这一项的期望应当改成「**关联注册正确，且用户手动设为默认后双击可用**」，而不是「双击就会用
NextTypora 打开」。后者在任何已装过 Markdown 编辑器的机器上都不可能通过。

另外两件相关的事：

1. 安装程序把 `HKCU\Software\Classes\.md` 的默认值从装前的 `WorkBuddy.md` **覆盖成了**
   `Markdown Document`。因为 UserChoice 优先，用户实际感知不到；但这是在改别的应用写下的值。
2. ProgId 直接用了 `fileAssociations[].name`，于是叫 `Markdown Document`——一个带空格的通用名，
   任何别的编辑器用同样的名字就会撞上。换成 `NextTypora.md` 之类的专属 ProgId 更稳。

### 顺带发现：Ctrl+Shift+E 在本机被应用之外的东西吃掉

真实键盘按 Ctrl+Shift+E 时，渲染进程只收到 `ControlLeft` 和 `ShiftLeft` 两个 keydown，**`KeyE`
从未到达**；而 CDP 合成的同一组合可以正常触发导出。逐一试过应用绑定的其它 Ctrl+Shift 组合
（O / T / F / L / D / 1），主键全部正常到达；把窗口输入语言切成英文再试，Ctrl+Shift+E 依旧只丢
`KeyE`。所以是本机某个应用注册了这个全局热键，**不是 NextTypora 的缺陷**，但在这台机器上这个
快捷键用不了。第 6 项因此走的是工具栏「导出为 HTML」按钮（也正是票里写的用户路径）。

### 我自己的一次误判，记在这里

第一次跑第 7 项时结论是「Alt+F4 会保存但不退出」。**那是错的。** 本机输入语言是中文，字母键会起
一次 IME composition，紧随其后的 Alt+F4 被输入法吃掉——应用从来没有被要求关闭过（`close` 事件
没触发，`requestFlushSave` 没跑，15 秒看门狗的「正在保存」对话框也没出现）。文件之所以变了是
自动保存写的。把窗口切到英文键盘后重跑，536 ms 正常退出且内容保住。干净文档下 Alt+F4 一直是
正常退出的。

### 这次没覆盖的

- Ctrl+Shift+E 的键盘路径（本机被外部热键占用，见上）。
- GUI 安装流程本身（许可页/目录页/完成页）：为了装到指定目录用的是 `/S`，所以目录页没走到。
  `.onVerifyInstDir` 的子目录追加也因此没被触发。
- 多显示器、万级工作区性能、打印：按 spec 推迟到 1.0.4+。

### 环境与清理

复测用的夹具是 `test/e2e-vault/` 的副本（在仓库外），仓库里的夹具没有被动过
（`编码/gbk.md` 仍是 95 字节，`git status` 干净）。复测结束后应用进程与内嵌后端都已退出，没有
孤儿 JVM；窗口输入语言已切回 `00000804`。两处副作用需要知道：第 9 项把我那份副本里的两个
`.nexttyproa-backups` 目录移进了**系统回收站**（按设计，不是永久删除，可自行清空）；
`HKCU\Software\Classes\.md` 的默认值被安装程序改了（见上，未还原）。

驱动这 10 项用的脚本保存在 [`test/v103-17-retest/`](../../../test/v103-17-retest/)，连同它踩过的
坑（splash 目标、DPI、对话框控件 id、IME 吞组合键等）。放进仓库是刻意的：上一套 harness 就是
因为被 `.gitignore` 盖住而随 `799a03f` 一起消失的。

Status 从 `needs-info` 改为 `resolved`。
