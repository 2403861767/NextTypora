# V104-05: 中文输入法下按 / 打出「、」，斜杠菜单唤不出来

Status: resolved
Type: Bug
Commit prefix: `Fix Bug-V104-05:`（和 V104-04、V104-06 合在一个提交里，见 V104-04）
Spec section: 无（2026-11-07 triage V104-03 时想到，尚无用户反馈）

## 现象

编辑器空白时的占位文字写着「输入 / 唤起命令，或直接开始写作…」（`MarkdownEditor.tsx:170`）。但微软拼音、搜狗等输入法在中文模式下，按 `/` 键默认打出的是全角顿号「、」；开了全角字符时打出的是「／」。Crepe 的斜杠菜单只在段落文字以半角 `/` 开头时才弹出（`crepe/src/feature/block-edit/menu/index.ts`，`currentText.startsWith('/')`），所以用中文输入法的用户照着提示按 `/`，菜单不会出来。

## 改动

新增 `frontend/src/utils/slashMenuTrigger.ts`：一条 Milkdown 输入规则（`$inputRule`），在 `MarkdownEditor.tsx` 里用 `crepe.editor.use(...)` 注册。

- **什么时候换**：段落或标题里**只有**一个「、」或「／」、光标在它后面、不在列表项里。这和 Crepe 弹出菜单的条件一致，所以只在菜单本来就会弹出的位置生效。换成 `/` 后，菜单照常弹出，接着输入的字照常用来筛选，比如「、代码」能筛到「代码块 Code」。
- **想打顿号怎么办**：紧接着按 Backspace，Milkdown 的 `undoInputRule` 会撤销这次替换，留下「、」。段落中间、文字后面打的「、」完全不受影响。
- **经过输入法组字时**：`prosemirror-inputrules` 在组字过程中不触发，`compositionend` 时再检查一次，所以组字中途显示的是「、」，提交后才换成 `/`。
- **光标位置**：规则里明确把光标放到 `/` 后面。`tr.insertText(text, from, to)` 只会映射原来的选区，而菜单要求光标在块末尾。

占位文字不改：按 `/` 现在两种输入法下都能唤起菜单，提示照样成立。

## Comments

### Triage（2026-11-07）

用户指示「这几个 ticket 全做完然后一起提交」，按下面的推荐定案。

查清的事实：

- **触发字符能不能配置**：不能。`SlashProvider` 的 `shouldShow` 是 BlockEdit 菜单在构造时写死的，Crepe 的 BlockEdit 配置只开放了块手柄的选项。
- **Milkdown 现成的机制**：`@milkdown/kit/utils` 的 `$inputRule` 可以加输入规则。Milkdown 的 Backspace 绑定是 `chainCommands(undoInputRule, deleteSelection, …)`（`core/src/internal-plugin/keymap.ts`），输入规则天然就能用 Backspace 撤销。
- **真实输入法复现**：没有在这台机器上切换输入法实测，因为那是系统设置，这次不动。「中文标点模式下 `/` 键出『、』」是微软拼音、搜狗的默认行为。开发版里用 CDP 的 `Input.imeSetComposition` + `Input.insertText` 走了一遍 Chromium 的组字流程（compositionstart / update / end），见完成情况。

决定：

1. 修法用输入规则，把段首单独的「、」「／」换成 `/`。不改占位文字，不给 Milkdown 打补丁，也不换成自己的 slash provider。
2. 全角「／」一并处理：这是同一个问题的另一种输入法设置，条件和代价完全相同。
3. 生效条件和 Crepe 弹出菜单的条件保持一致，菜单不会弹出的地方（文字后面、列表项里、代码块里）不做替换。

### 完成情况（2026-11-07）

测试（`App.test.tsx > V104-05: opening the slash menu from a Chinese input method`，6 条）：

- `/`、`、`、`／` 各一条：段落里唯一的文字是它时，菜单弹出、段落显示 `/`。`/` 是对照组，改动前就能通过，说明这种输入方式在 jsdom 里确实能让菜单弹出。
- 紧接着按 Backspace，段落变回「、」、菜单关闭。
- 「正文」后面打「、」，保持「正文、」、不弹菜单。
- 列表项里单独打「、」，保持「、」、不弹菜单。

测试准备中的调整：第一次跑时，连 `/` 对照组也失败了，查下来菜单要求编辑器有焦点（`view.hasFocus()`）、光标在块末尾。辅助函数改成先聚焦编辑器、改完把 DOM 选区放到文字末尾之后，对照组才通过，下面的红才有意义。「正文、」那条也补上了同样的聚焦和选区，否则它会因为没有焦点而"通过"。

- **red**（规则不注册）：`、`、`／` 两条失败，段落停在「、」「／」，菜单 `data-show` 是 `false`；Backspace 那条在第一步「菜单弹出」上失败。`/` 对照组和两条"不受影响"的用例通过。
- **中间态**：规则注册了，但没有明确设置光标。段落已经变成 `/`，菜单仍然不弹，原因是 jsdom 里原来的选区不在这一段，映射过去也不在块末尾。真实输入时原来的光标就在这一段，映射后会落在 `/` 后面；明确设置光标后不再依赖这一点。
- **green**：6 条全过。

真实应用（开发版 Electron + CDP，临时工作区，鼠标和按键走 `Input.dispatch*`）：

- 空段落里 `Input.insertText('、')`：段落显示 `/`，菜单弹出，16 项都在。接着输入「代码」，段落是 `/代码`，菜单只剩「代码块 Code」。
- 走组字流程：`imeSetComposition('、')` 期间，段落显示「、」、菜单不弹；提交后变成 `/`、菜单弹出。
- 紧接着按 Backspace：变回「、」，菜单关闭。
- `／`：变成 `/`，菜单弹出。`正文` 后面打「、」：保持「正文、」，菜单不弹。半角 `/` 照常唤起菜单。
- 以上每次都按 Esc 后删掉，笔记文件和开始前逐字节相同。最后用「、代码」加回车插入了一个代码块，段落里没有残留 `/` 或「、」。

回归数字见 V104-06 的完成情况。
