# V103-07: 设置弹窗新增「关于」区块，显示真实版本号

Status: resolved
Type: Change
Commit prefix: `Change V103-07:`
Spec section: 4（见 ../spec.md）

## 背景

应用里完全看不到版本号：没有关于对话框，`app.getVersion()` 从未被调用，标题栏/状态栏/设置里都没有。用户无法知道自己装的是哪个版本——而唯一告诉他「1.0.2」的来源（安装包文件名）还是手工改的。

Q13 删掉了菜单模板，所以这个动作没有别的落点。

## 改动

设置弹窗新增「关于」区块，经 IPC 取 `app.getVersion()` 并显示。

## 验收

显示的版本号与 `package.json` 一致；开发模式与打包版都能正确显示。依赖 V103-06。

## Comments

## 完成情况（2026-11-01）

- `electron/main.js`：新增 `ipcMain.handle('app:getVersion', () => app.getVersion())`。这是 `app.getVersion()` 在这个项目里第一次被调用。
- `electron/preload.js`：桥接为 `getAppVersion()`。
- `frontend/src/types.ts`：`getAppVersion?: () => Promise<string>`。
- `SettingsModal`：最后新增「关于」区块，弹窗打开时取一次版本号。

### 拿不到版本号时不编一个出来

三条路径都测了：桥存在 → 显示版本号；桥不存在（浏览器环境）→ 显示「版本号不可用（请在桌面应用中查看）」；主进程报错 → 同样显示不可用。**渲染进程不从 `package.json` 或别处猜版本号**——那样会重新制造 V103-06 刚消灭的"多个版本来源"问题。

### 测试

- `electron/main.test.js` +1：`app:getVersion` 返回主进程的版本（fake app 的 `getVersion` 返回 `1.0.3`）→ 27/27
- `SettingsModal.test.tsx` +3：显示、无桥、主进程报错 → 该文件 10/10

### 真实应用验证

开发版 Electron + CDP：

```
桥存在: "function"
主进程报告的版本: "1.0.3"
关于区块显示: "NextTypora | 1.0.3"
```

开发模式下 `app.getVersion()` 读的就是 `package.json`，所以这同时验证了 V103-06 的版本号确实贯通到了用户可见的地方。

### 一处刻意的提前一致

「关于」区块里的产品名我写的是**正确拼写 `NextTypora`**，而标题栏/任务栏目前仍是错拼的 `NextTyproa`。这是故意的——V103-12 会把显示层统一成 `NextTypora`，现在写对的那个是向前一致；启动闪屏本来也已经是 `NextTypora`。V103-12 落地后这处无需再改。

全量：前端 **198/198**、类型检查 0 错、Electron **27/27**、打包 **12/12**、后端无回归。
