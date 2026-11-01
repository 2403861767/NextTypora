# V103-10: 删掉 macOS 专属菜单模板

Status: ready-for-agent
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
