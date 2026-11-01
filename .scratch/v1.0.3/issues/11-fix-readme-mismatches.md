# V103-11: README 与代码不符三处

Status: resolved
Type: Bug
Commit prefix: `Fix Bug-V103-11:`
Spec section: 6（见 ../spec.md）

## 现象

- `README.md:195` 打字机模式写 `Ctrl+Alt+T`，`shortcuts.ts:23` 实际是 `Ctrl+Shift+T`——**照文档按按不出来**
- `README.md:73` 在卖 `NextTyproa-win-x64.zip`，`release/` 里没有 zip
- `README.md:31` 宣传「窗口菜单」，Windows 上没有菜单栏

## 改动

三处按代码实际行为修正。第三处与 V103-10 一起改。

## 验收

README 里每一个快捷键都与 `shortcuts.ts` 的 `defaultKeys` 对得上。

## Comments

## 完成情况（2026-11-01）

三处都改了，并且不是只改我已知的那一条——我写了个脚本把 README 快捷键表**逐行**与 `shortcuts.ts` 的 `defaultKeys` 对了一遍：

1. **打字机模式**：README 写 `Ctrl+Alt+T`，代码是 `Ctrl+Shift+T`（照文档按按不出来）→ 已改。这是全表唯一一条真实不符。
2. **免安装包**：`NextTyproa-win-x64.zip` → `NextTyproa-<版本>-win-x64.zip`，并注明由 `npm run dist` 产出。
3. **窗口菜单**：`:32` 宣传的"窗口菜单"在 Windows 上不存在 → 改为"无边框自定义标题栏"，并说明快捷键在偏好设置里可改、Windows 上没有系统菜单栏是刻意选择。

核对脚本第一版误报了「偏好设置 `Ctrl+,`」，因为我按逗号分割 `defaultKeys` 时被 `'Ctrl+,'` 自己的逗号骗了。修正后复核：**不符条数 0**。

### 顺带修掉一个同类问题：zip 包没有版本号

`scripts/package-zip.ps1` 产出的是写死的 `NextTyproa-win-x64.zip`——拿到文件认不出是哪个构建，和 1.0.2 被手工改名是同一类问题。现在它从 `package.json` 读版本号，产出 `NextTyproa-<版本>-win-x64.zip`，与 electron-builder 的 `artifactName` 保持一致。
