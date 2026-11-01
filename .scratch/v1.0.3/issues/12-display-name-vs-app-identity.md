# V103-12: 显示名改为 NextTypora，应用身份保持不变

Status: ready-for-agent
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
