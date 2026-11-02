# V103-12: 显示名改为 NextTypora，应用身份保持不变

Status: resolved
Type: Change
Commit prefix: `Change V103-12:`
Spec section: 7（见 ../spec.md）

## 背景

产品名长期被错拼为 `NextTyproa`（`yp` 颠倒），只有启动闪屏 `main.js:221` 的 `<h1>NextTypora</h1>` 是对的——用户看到的第一屏和任务栏是两个名字。

**陷阱**：所有设置读写都挂在 `app.getPath('userData')`，导入主题在 `userData/themes`，而 `app.setName()` / `app.setPath()` 从未被调用。Electron 的 userData 路径是 `%APPDATA%/<app.getName()>`，`getName()` 取的就是 `productName`。**光改 `productName` 就会把设置目录搬走**，老用户的主题、快捷键、最近工作区、打开的标签页全部静默丢失。

## 改动

见 `docs/adr/0002-display-name-vs-app-identity.md`。

- 显示层改为 `NextTypora`：`productName`、`index.html` 的 `<title>`、README 标题、错误弹窗
- **同时显式调用 `app.setName('NextTyproa')`**，把 userData 路径钉死在旧位置
- `appId` 与 Java 包名不动（改 `appId` 会让 Windows 当成新软件，用户机器上会留两个安装）

## 验收

升级后老用户的 `settings.json` 与 `themes/` 仍被读到——这是本条唯一真正要验的东西。界面、任务栏、安装包显示 `NextTypora`。

## Comments

## 完成情况（2026-11-01）

显示层统一成正确拼写 **NextTypora**：`build.productName` / `shortcutName` / `publisherName`、`frontend/index.html` 的 `<title>`、启动失败弹窗、README 标题与正文，以及 `package-zip.ps1` 的产物名（`${productName}` 变了，zip 和 exe 名字都跟着变）。

`appId`（`com.nexttyproa.app`）、顶层 `name`、Java 包名、`NEXTTYPROA_*` 环境变量**全部不动**。

`electron/main.js` 顶部加了一行，位置在任何 `app.getPath('userData')` 之前：

```js
app.setName('NextTyproa');
```

### 先做实验，再改代码

这是本版唯一一条"改错就静默清空老用户设置"的改动，所以机制是实测出来的，不是推出来的。用一个独立的最小 Electron 探针跑了两次：

| productName | 是否调 setName | userData |
| --- | --- | --- |
| NextTypora | 否 | `%APPDATA%/NextTypora` ← **设置丢失** |
| NextTypora | 是（NextTyproa） | `%APPDATA%/NextTyproa` ← 保住 |

### 一个比预期更细的发现：开发模式与打包版解析方式不同

`productName` 嵌在 `build` 下（那是 electron-builder 的配置），**Electron 自己看不到它**。复刻真实 `package.json` 的结构再探一次：

- 开发模式不调 setName：`getName=nexttyproa`（取顶层 `name`）→ `%APPDATA%/nexttyproa`
- 打包版：electron-builder 把 `build.productName` 烤进去 → 原本是 `NextTyproa`

所以这条修改真正保护的是**打包版**。开发模式那个路径只是大小写不同——Windows 文件系统大小写不敏感，两者是同一个目录。实际确认过：`%APPDATA%` 下只有一个 `nexttyproa` 目录，319 个条目，自 2026/9/23 起一直在用。开发设置同样不受影响。

### 测试

`electron/main.test.js` +2（共 29）：

1. 启动后 `app.setName` 收到的是 `NextTyproa`——**谁删掉那一行，这条就红**。这正是 ADR-0002 需要的机器把关。
2. `build.productName` 是正确拼写、而 `appId` 仍是 `com.nexttyproa.app`——防止将来有人"顺手"把 appId 一起改了（那会让 Windows 当成新软件，旧版不被覆盖，用户机器上留两个安装）。

### 现场

探针实验在 `%APPDATA%/NextTypora` 留下过一个只含 `Local State` 的空壳目录（我自己造的，22:41），已删除。真正的 `nexttyproa` 目录一个字节没动。

### 补充：真实打包后才发现漏了 author（2026-11-01）

打出 1.0.3 安装包后查 exe 属性，`ProductName` 已经是 `NextTypora`（V103-12 生效），但：

```
CompanyName    : nextTyproa
LegalCopyright : Copyright © 2026 nextTyproa
```

两者都来自 `package.json` 的 `author`，我改显示层时漏掉了它。exe 属性是用户可见的，所以这仍属于本票范围。`author` 只是元数据，不碰 `appId` / `userData` / 顶层 `name`，与 ADR-0002 的身份约束无冲突。

改为 `NextTypora` 后重新打包核对：

```
ProductName    : NextTypora
CompanyName    : NextTypora
FileVersion    : 1.0.3
LegalCopyright : Copyright © 2026 NextTypora
```

教训：显示名散落在比预想更多的地方，只靠 grep 产品名找不全——有些是 electron-builder 从别的字段派生出来的，必须打出产物再查属性才看得见。
