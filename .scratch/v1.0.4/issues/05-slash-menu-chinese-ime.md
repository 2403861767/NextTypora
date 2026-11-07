# V104-05: 中文输入法下按 / 打出「、」，斜杠菜单唤不出来

Status: needs-triage
Type: Bug
Spec section: 无（2026-11-07 triage V104-03 时想到，尚无用户反馈）

## 现象（推测，未复现）

编辑器空白时的占位文字写着「输入 / 唤起命令，或直接开始写作…」（`MarkdownEditor.tsx:170`）。但微软拼音、搜狗等输入法在中文模式下，按 `/` 键默认打出的是全角顿号「、」。Crepe 的斜杠菜单只在段落文字以 `/` 开头时才弹出（`crepe/src/feature/block-edit/menu/index.ts`，`currentText.startsWith('/')`），所以用中文输入法的用户照着提示按 `/`，菜单不会出来。

triage V104-03 时，开发版里是用 CDP 的 `Input.insertText` 直接插入 `/` 的，没有经过输入法，所以这个现象还没有实际复现。

## 定案前要先弄清楚的

- 用真实的中文输入法复现：Windows 上的微软拼音默认设置，按 `/` 是不是打出「、」，打出后菜单是不是不弹。
- 触发条件能不能配置：BlockEdit 菜单的 `shouldShow` 写在 `SlashProvider` 里，看 Crepe 有没有配置项可以加触发字符。没有的话，要换成自己的 slash provider，或者给 Milkdown 打补丁，两种代价都要估一下。
- 修法有几种：把段首的「、」也当作触发字符（段首单独一个「、」在正常写作里几乎不会出现）；改占位文字，说明要切到英文输入；两者都做。
- 如果复现不了，就改成 wontfix。

## 来源

2026-11-07 triage V104-03 时，从 Q5 拆出来的。先登记，不动手。

## Comments
