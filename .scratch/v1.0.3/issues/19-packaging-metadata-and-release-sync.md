# V103-19: 打包元数据的三处问题，以及没人保证 release/ 与代码同步

Status: resolved
Type: Change
Commit prefix: `Change V103-19:`
Spec section: 无（做 V103-17 的打包版复测时发现，不在原 spec 的 17 票内）

## 背景

V103-17 在安装版上实测时，顺带暴露了四件打包层面的事。前三件是产物本身不对，第四件是**没有任何
东西保证 `release/` 里的产物与 HEAD 是一回事**——而这件事当天就真的发生了。

## 改动

### 1. 文件关联的 ProgId 用了通用名

1.0.3 注册的 ProgId 是 `fileAssociations[].name` 的原值 **`Markdown Document`**。ProgId 是
`HKCU\Software\Classes` 下的全局键名，用这种通用名等于和任何同样命名的编辑器共用一个键，谁后装
谁覆盖。改成应用专属的 `NextTypora.md`；`description` 保持 `Markdown document` 不动——那一项是
资源管理器「类型」列显示的友好名，通用才对。

### 2. 安装目录名还是拼错的

`build/installer.nsh` 里 `!define NEXTTYPROA_FOLDER "nextTyproa"`，于是 1.0.3 的 GUI 安装会把
应用装进一个产品早已不叫的名字里。安装目录属于**显示名**，按 V103-12 的分工应当跟产品名走（身份
——appId / `app.setName()` / `%APPDATA%\nexttyproa`——才是刻意保持错拼的，见 ADR-0002）。
define 改名为 `INSTALL_SUBFOLDER`，值改为 `nextTypora`，注释写清这条分工。

### 3. 卸载项里没有 InstallLocation

electron-builder 只把 `InstallLocation` 写进它自己的注册表键（`HKCU\Software\<GUID>`），没有写进
Windows 的 Uninstall 键，于是「已安装的应用」里看不到安装位置，任何读标准卸载键的东西也找不到
安装目录。新增 `customInstall` 宏补上。

顺带补了 `customUnInstall`：electron-builder 的 `unregisterFileAssociations` 会把 `.md` /
`.markdown` 的原默认 ProgId 写回去（这一点实测有效，卸载后恢复成了机器上原来的
`WorkBuddy.md`），但**不会删掉它自己写的 `<ProgId>_backup` 值**，于是每卸载一次就留下两条我们的
残留值。现在卸载时一并删掉。

### 4. 没有任何东西保证 release/ 的产物与代码同步

这是四件里最要紧的。`verify-dist-resources.js` 在打包**之前**跑，保证的是输入；打包**之后**没有
任何检查。两次真实事故都落在这个缝里：

- **1.0.2**：产物是按 `1.0.0` 构建后手工改名的，`latest.yml` 与 `.blockmap` 都还停在 1.0.0。
  V103-06 把版本号收敛成唯一来源，解决的是「值会不会错」，没解决「产物是不是这个值构建的」。
- **1.0.3（2026-11-06 复测当天）**：`release/` 里的安装包构建于 `fe0d9e8` 之前，PE 元数据仍是
  `CompanyName=nextTyproa`；旁边的 `win-unpacked` 反而是修过的，`latest.yml` 的 sha512 指向那个
  旧包。差一步就在旧包上做完整套复测。

新增 `scripts/verify-release-artifact.js`（`npm run verify:release`，并挂在 `dist:setup` 末尾）。
它不看文件名、不看模板，只对比产物里真实存在的字节与元数据：

| 检查 | 能挡住什么 |
| --- | --- |
| PE `ProductName` / `CompanyName` / `FileVersion` / `LegalCopyright` 对比 package.json | 产物比代码旧（1.0.3 当天那种） |
| `latest.yml` 的 `version` / `path` / `size` 与产物一致 | 清单描述的是另一个文件 |
| `latest.yml` 里必须含有产物**实算**的 sha512 | 手工改名（1.0.2 那种） |
| release/ 里其它版本的 exe 只警告不报错 | 提醒旧产物还躺在那儿冒充发布物 |

非 Windows 上自动跳过 PE 那一段（读 PE 元数据用的是 PowerShell 的 `VersionInfo`）。

### ProgId 的重复来源

`customUnInstall` 要按名字删 `<ProgId>_backup`，所以 installer.nsh 内联了一次 ProgId——两处必须
一致。按本仓库的习惯，不能靠注释约束：
`verify-dist-resources.js` 与 `electron/main.test.js` 各加一条断言，任一处漂移就红。

## 验收

- `npm run verify:release` 对当天的产物通过；把 `author` 改成别的值后报
  `CompanyName in the artifact is "NextTypora", but package.json author is "Someone Else"` 并退出 1。
- `verify-dist-resources.js`：ProgId 改回 `Markdown Document` → 报「not app-specific」；
  改成 `NextTypora.markdown`（专属但与 installer.nsh 不一致）→ 报「drifted apart」。两次都退出 1。
- `electron/main.test.js` 新增的 `V103-19` 用例在上面两种破坏下各失败一次，恢复后 30/30 通过。
- `npm run dist:setup` 全程通过，末尾的 `verify:release` 对新产物通过。
- 装到 `D:\software\nextTypora` 后实测：`.md` / `.markdown` 的默认 ProgId 都是 `NextTypora.md`，
  其 `shell\open\command` = `D:\software\nextTypora\NextTypora.exe "%1"`，旧的通用
  `Markdown Document` 键不存在；卸载项的 `InstallLocation` = `D:\software\nextTypora`；
  卸载一次后 `NextTypora.md_backup` 被 `customUnInstall` 删掉、`.md` 默认值恢复成 `WorkBuddy.md`。
- `npm test` 绿（Electron 30/30、后端 138/138、前端 208/208）。

## Comments

两点没有做到的，说清楚：

- **安装子目录的改名只过了代码审查，没有在界面上走一遍。** 只有目录页会调用
  `.onVerifyInstDir`，而为了装到指定目录用的是 `/S /D=`，所以追加子目录这条分支没被触发。
  `customInstall` 的效果（`InstallLocation` 被写进去了）证明本次 installer.nsh 的宏确实被编译并
  执行了，但「GUI 下选 X 会装进 X\nextTypora」这句话本身仍只是读代码得出的。
- **`customInstallDir` 把默认目录指向 `$PROGRAMFILES64`，而这是个 per-user 安装**
  （`perMachine` 未设置即 false）。GUI 下默认目录因此会落在需要提权的位置。这次没有改——它不是
  本票发现的问题，改它会改变所有用户的默认安装位置，应当单独决定。
  （**这一条是错的，见下面「更正」一节**：那个宏从来没被调用过，默认目录一直是用户目录。）

## 更正（2026-11-07）：那个「默认装到 Program Files」的说法是错的，宏根本没被调用

去查「要不要把默认目录改成用户目录」的时候发现：**`customInstallDir` 不是 electron-builder 的
hook**。它从不插入这个名字的宏——`node_modules/app-builder-lib/templates/nsis/` 里
`ifmacrodef custom*` 的全部名字是：

```
customCheckAppRunning  customFiles_*        customFinishPage  customHeader
customInit             customInstall        customInstallmode customPageAfterChangeDir
customRemoveFiles      customUnInit         customUnInstall   customUnInstallCheck
customUnInstallCheckCurrentUser             customUninstallPage
customUnWelcomePage    customWelcomePage
```

没有 `customInstallDir`。所以那段 `StrCpy $INSTDIR "$PROGRAMFILES64\..."` **自写下那天起就是
死代码**，默认目录从来不是 Program Files。真正的默认来自 electron-builder 的 `multiUser.nsh`：
有上次的 `InstallLocation` 就用它，否则用 per-user 的程序目录
（`$LocalAppData\Programs\NextTypora`），不需要提权。也就是说「改成用户目录」这件事，行为上
本来就是用户目录，要改的只有那段骗人的死代码。

**实测**（不是读代码）：先卸载（卸载会删掉记着上次位置的 `${INSTALL_REGISTRY_KEY}`），然后在
**未提权**的进程里跑 `/S /currentuser`、不带 `/D=`：

```
running elevated right now : False
exit = 0   elapsed = 8.2s
InstallLocation            = 'C:\Users\seeleaf\AppData\Local\Programs\NextTypora'
C:\Program Files\nextTypora exists : False
C:\Program Files\nextTyproa exists : False
```

### 改动

1. 删掉死宏 `customInstallDir`，原地写清楚：没有这个 hook、真正的默认是什么、真要覆盖该用
   `preInit`。
2. `verify-dist-resources.js` 新增一条检查：把
   `node_modules/app-builder-lib/templates/nsis/` 里所有 `ifmacrodef custom*` 的名字当真相，
   `build/installer.nsh` 里定义的每个 `!macro custom*` 都必须在其中，否则报错。
   **拼错一个 hook 名不会报错、只会静默什么都不做**，这个洞就是这么藏住的；现在它会红。
   不硬编码 hook 列表，而是从依赖的模板里现读——跟着 electron-builder 升级自动更新。

### 验收

- 把 `!macro customInstallDir` 加回去 → `verify-dist-resources.js` 报
  `defines !macro customInstallDir, which electron-builder never inserts - it will silently do
  nothing`，退出 1；删掉后通过。
- `installer.nsh` 现在只剩两个宏，都是真 hook：`customInstall`、`customUnInstall`。
- 默认目录实测见上；随后卸载该测试安装（`%LOCALAPPDATA%` 下的空目录也已删掉），
  重新装回 `D:\software\nextTypora`，`InstallLocation`、ProgId、设置目录哈希都复核无误。
- `npm run dist:setup` 通过（末尾 `verify:release` 通过），`npm test` 绿
  （Electron 30/30、后端 138/138、前端 208/208）。

另：卸载程序会留下一个**空的**安装目录（`D:\software\nextTypora` 与
`%LOCALAPPDATA%\Programs\NextTypora` 都观察到）。这是 NSIS 的常见行为，没有去动它。
