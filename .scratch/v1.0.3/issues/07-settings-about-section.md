# V103-07: 设置弹窗新增「关于」区块，显示真实版本号

Status: ready-for-agent
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
