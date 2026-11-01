# V103-10: 删掉 macOS 专属菜单模板

Status: resolved
Type: Change
Commit prefix: `Change V103-10:`
Spec section: 6（见 ../spec.md）

## 背景

`main.js:510-514` 只在 `darwin` 下 `setApplicationMenu`，Windows 下为 `null`；而发布目标只有 Windows（Q9 已确认未来一年不出 macOS/Linux）。模板里 9 个加速键在唯一发布平台上是死代码，同一批快捷键在 `shortcuts.ts` 又定义了一遍——两份真相。

## 改动

删模板，快捷键以渲染进程（`frontend/src/utils/shortcuts.ts`）为唯一真相。

无边框自定义标题栏是刻意的外观选择，不补 Windows 菜单栏。

## 验收

24 个快捷键行为不变；Electron 测试绿。

## Comments

## 完成情况（2026-11-01）

`createMenu()` 里 75 行的菜单模板已删除，换成 `removeApplicationMenu()`：只保留 `Menu.setApplicationMenu(null)`（Windows 下仍需要它来去掉 Electron 的默认菜单），并在注释里写清为什么这里没有菜单。

模板里那 9 个加速键与 `frontend/src/utils/shortcuts.ts` 重复定义了同一批快捷键，而发布目标只有 Windows（Q9），所以它们既不生效、又是"改了一边忘了另一边"的温床。快捷键现在只有渲染进程一个来源。

### 查出来的连带影响：9 条 IPC 通路现在没有发送方

`grep webContents.send` 确认，那份模板是全部 9 个 `menu:*` 频道的**唯一**发送方：

```
menu:open-file / open-folder / create-note / save /
export-html / export-pdf / open-settings / toggle-source / toggle-sidebar
```

删掉模板之后，`electron/preload.js` 里对应的 9 个订阅函数、以及 `App.tsx` 里把它们接到各个处理器上的那段代码，都变成了不可达的管道。

**我没有一并删掉它们**，原因有二：一是本票的目标是消除"同一批快捷键有两个定义"这个真实问题，删模板已经达成；二是那要动 2700 行的 `App.tsx`，属于另一个量级的改动，值得单独立票和单独测试。留着也不会出错——它们只是永远不会被触发的监听器。

建议作为 1.0.4 的独立清理项。
