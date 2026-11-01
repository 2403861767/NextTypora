# V103-11: README 与代码不符三处

Status: ready-for-agent
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
