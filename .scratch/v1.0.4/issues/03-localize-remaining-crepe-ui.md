# V104-03: Crepe 其余界面文案汉化

Status: resolved
Type: Change
Commit prefix: `Change V104-03:`
Spec section: 无（2026-11-07 讨论 V104-01 时发现，同日 triage 定案）

## 背景

V104-02 只汉化了代码块工具栏，Crepe 其他功能的界面文案还是英文默认值：`MarkdownEditor.tsx` 的 `featureConfigs` 只配置了 Placeholder、ImageBlock（只设了上传回调和 `proxyDomURL`）和 CodeMirror。

triage 时在开发版里实测过（CDP 驱动真实鼠标和输入），用户实际看得到的英文都在下面四处，每一处都有配置项可以改。

## 改动

都在 `frontend/src/components/MarkdownEditor.tsx`。BlockEdit、ImageBlock、LinkTooltip 都是 Crepe 默认开启的功能，只需要在 `featureConfigs` 里加配置，不用改 `features`。

### 1. 斜杠菜单：`[Crepe.Feature.BlockEdit]`

菜单项写成「中文名 + 空格 + 原英文名」，分组名只写中文：

| 配置项 | 原文 | 译文 |
| --- | --- | --- |
| `textGroup.label` | Text | 文本 |
| `textGroup.text.label` | Text | 正文 Text |
| `textGroup.h1.label` … `h6.label` | Heading 1 … Heading 6 | 一级标题 Heading 1 … 六级标题 Heading 6 |
| `textGroup.quote.label` | Quote | 引用 Quote |
| `textGroup.divider.label` | Divider | 分割线 Divider |
| `listGroup.label` | List | 列表 |
| `listGroup.bulletList.label` | Bullet List | 无序列表 Bullet List |
| `listGroup.orderedList.label` | Ordered List | 有序列表 Ordered List |
| `listGroup.taskList.label` | Task List | 任务清单 Task List |
| `advancedGroup.label` | Advanced | 高级 |
| `advancedGroup.image.label` | Image | 图片 Image |
| `advancedGroup.codeBlock.label` | Code | 代码块 Code |
| `advancedGroup.table.label` | Table | 表格 Table |
| `advancedGroup.math.label` | Math | 数学公式 Math |

为什么要带英文名：Crepe 只拿菜单项的显示名做筛选（`crepe/src/feature/block-edit/menu/config.ts:368`，`item.label.toLowerCase().includes(filter.toLowerCase())`）。如果只写中文，`/code`、`/table` 就搜不到了。中文输入法下按 `/` 打出的是「、」（见 V104-05），所以用户要唤起菜单，本来就已经切到了英文输入，接着打英文关键词最顺手。新显示名包含原来的整个英文名，所以以前能搜到的关键词现在照样能搜到，`/代码` 这样的中文关键词也能搜到。分组名不参与筛选，所以只写中文。

中文用词跟 `MarkdownHelpModal.tsx` 保持一致（一级标题、引用、分割线、无序列表、有序列表、任务清单、数学公式）。

### 2. 图片块：`[Crepe.Feature.ImageBlock]`

加在已有的配置里：

| 配置项 | 原文 | 译文 |
| --- | --- | --- |
| `blockUploadButton` | Upload file | 上传图片 |
| `blockUploadPlaceholderText` | or paste link | 或粘贴链接 |
| `blockConfirmButton` | Confirm | 确定 |
| `blockCaptionPlaceholderText` | Write Image Caption | 输入图片说明 |
| `inlineUploadButton` | Upload | 上传 |
| `inlineUploadPlaceholderText` | or paste link | 或粘贴链接 |

上传按钮和确定按钮是通过 `Icon` 组件以 innerHTML 渲染的，传纯文字就可以。`inlineConfirmButton` 和 `blockCaptionIcon` 是图标，不要改。

### 3. 链接输入框：`[Crepe.Feature.LinkTooltip]`

| 配置项 | 原文 | 译文 |
| --- | --- | --- |
| `inputPlaceholder` | Paste link... | 粘贴链接… |

### 4. 上传占位：`uploadConfig.uploadWidgetFactory`

粘贴或拖入图片时，`@milkdown/plugin-upload` 会显示「Upload in progress...」占位（默认工厂在 `plugin-upload/src/upload.ts:60`）。在现有的 `ctx.update(uploadConfig.key, ...)` 里，紧挨着包装 `uploader` 的地方，再覆盖 `uploadWidgetFactory`：创建一个文字为「正在上传图片…」的 `<span>`，返回 `Decoration.widget(pos, el, spec)`（`Decoration` 从 `@milkdown/kit/prose/view` 引入）。Crepe 的 uploader 只处理图片文件（`crepe/src/core/builder.ts:75`），所以占位文字里写「图片」是准确的。

同时更新 `MarkdownEditor.tsx:203` 那条注释，它现在提的还是英文占位。

## 不改

- **顶栏**：`features` 里开着（`TopBar: true`），但 `styles.css:1843` 把 `.milkdown-top-bar` 设成了 `display: none`，从 1.0.0 起就是这样。用户看不见，它的英文（Paragraph、Heading、Formatting…）不翻译。既然看不见，开着它其实没有用处；关掉它不在本票范围内。
- **代码块语言按钮上的「Text」**：Milkdown 写死的，没有配置项，见 V104-02。
- **只有图标的控件**：选区工具栏、表格控件、块手柄，既没有文字，也没有 `title`。
- **应用自己的英文**：侧栏的 Workspace 和 Files / List / Outline / Search，见 V104-04。

## 测试

在 `App.test.tsx` 里新增 `describe('V104-03: remaining Crepe labels')`。先用 Crepe 的默认值证明红，再改配置转绿。

- **斜杠菜单**：编辑器初始化时，菜单 DOM 就已经挂到页面上了，只是隐藏着（`plugin-slash` 在第一次 update 时 append；BlockEdit 菜单的构造函数里调用了 `update(view)`）。筛选词为空时，所有分组都会渲染。所以不用在 jsdom 里输入 `/`，挂载一篇笔记后直接断言：`.milkdown-slash-menu .tab-group li` 依次是 文本、列表、高级，`.menu-group li span` 依次是上表的 16 项（Heading 1–6 算 6 项）。筛选在 jsdom 里驱动不了，留到开发版里验证。
- **链接输入框**：链接编辑浮层也是初始化时就挂载的（`TooltipProvider`，同样的机制），直接断言 `.milkdown-link-edit input` 的 placeholder。
- **图片块**：挂载一篇有一行单独 `![]()` 的笔记，得到一个空的块级图片，断言上传按钮的文字和「或粘贴链接」占位；挂载一篇段落里夹着 `![]()` 的笔记，得到行内图片，断言「上传」和「或粘贴链接」。「确定」要在链接框里输入内容后才出现，「输入图片说明」要有图片地址才出现。这两项 jsdom 里测得到就测，测不到就在开发版里确认。
- **上传占位**：`App.test.tsx:815-900` 已有的上传测试拿 `PLACEHOLDER = 'Upload in progress...'` 判断「走的是编辑器真正的粘贴上传流程」。把这个常量改成「正在上传图片…」，第 875 行的用例标题也跟着改。改完配置之前，这几条会在等占位出现时失败，这就是这一项的红。

## 验收

在开发版 Electron 里，用真实的鼠标和键盘操作：

- 空段落里输入 `/`，菜单分组是 文本 / 列表 / 高级，菜单项是上表的「中文 English」写法，文字没有被截断，也没有折行。
- `/code` 只剩「代码块 Code」，`/table` 只剩「表格 Table」，`/代码` 也能筛到「代码块 Code」。回车后插入的是代码块。
- 通过斜杠菜单插入的空图片块显示「上传图片」和「或粘贴链接」；在链接框里输入后出现「确定」；图片的说明输入框占位是「输入图片说明」。
- 选中文字，点链接按钮，输入框占位是「粘贴链接…」。
- 笔记文件只因有意的编辑而改变，打开菜单、取消菜单都不会改动文件。

## Comments

### Triage（2026-11-07）

工单原本列了三个待查问题，triage 时查清如下：

- **顶栏用户看不看得到**：看不到。见上文「不改」。
- **斜杠菜单是谁的**：Crepe 自带的 BlockEdit 菜单。项目里没有自己的斜杠菜单代码，`styles.css` 约 2250 行只是给它调了样式。
- **文案都有没有配置项**：用户看得到的都有，见上文四处。只有代码块的「Text」没有，V104-02 已经定了不改。

决定（全部按推荐）：

1. 范围只覆盖用户看得到的四处，顶栏和代码块「Text」不动。
2. 斜杠菜单的搜索问题，采用「中文 + 原英文名」（选项 A）。其他选项是只写中文（B）和不翻译（C）。
3. 译名按上面几张表定。
4. 侧栏 Workspace 和 Files / List / Outline / Search 是项目自己的代码，另开 V104-04 处理。状态栏的「Markdown」是格式名，保留。
5. 中文输入法下「、」唤不出菜单，不属于汉化，另开 V104-05（needs-triage），本票不处理。

### 完成情况（2026-11-07）

改动：`MarkdownEditor.tsx` 新增 `[Crepe.Feature.BlockEdit]` 和 `[Crepe.Feature.LinkTooltip]` 配置，`[Crepe.Feature.ImageBlock]` 补上 6 个文案，`uploadConfig` 覆盖 `uploadWidgetFactory`（`Decoration` 从 `@milkdown/kit/prose/view` 引入）。译文和上面几张表完全一致。顶栏、代码块「Text」、只有图标的控件，按计划都没动。

测试（`App.test.tsx > V104-03: remaining Crepe labels` 新增 5 条；`RW-P1-008` 的 `PLACEHOLDER` 改为「正在上传图片…」，用例标题去掉了英文占位）：斜杠菜单的分组标签、分组标题和 16 个菜单项（triage 时说的「14 个」把 Heading 1–6 算成了一项，实际是 16 项）；链接输入框占位；空块级图片的上传按钮、占位文字，以及在链接框输入后出现的确定按钮；有图片时点说明图标后出现的说明占位；空行内图片的上传按钮和占位文字。

测试准备中的一处调整：行内图片输入框的根元素只有 `empty-image-inline` 这个类，没有 `image-edit`（Vue 用透传的 `className` 盖掉了组件自己的类）。第一次跑时这条用例在找元素时就失败了，没有走到文案断言。改了选择器后重新跑，才得到下面的红。

红→绿：

- **red**：7 条全部失败，收到的都是 Crepe 的默认值：两条上传用例收到 `Upload in progress...`，斜杠菜单 `Text / List / Advanced`，链接 `Paste link...`，块级图片 `Upload file`，说明 `Write Image Caption`，行内图片 `Upload`。
- **中间态**：只配分组名、`blockUploadButton`、`blockUploadPlaceholderText`、`inlineUploadButton`。斜杠菜单在菜单项断言上失败（前面的分组标签、分组标题两条断言已经通过），块级图片在输入链接后失败、收到 `Confirm`，行内图片在占位文字上失败、收到 `or paste link`。说明这三条用例的后半段确实执行到了。
- **green**：补全后 V104-01/02/03 和 RW-P1-008 共 13 条全过。

回归（`npm run dist:verify -- --expect-version 1.0.3`，exit 0）：Electron 30/30，后端 138/138，前端 219/219（含新增 5 条），构建通过，`test:packaged` 12/12，发布资源校验通过。`tsc --noEmit` 只报两处既有问题（`App.tsx` 的 `searchOpen`、`FileTree.tsx` 的 `normalizePath` 未使用），都不在本次改动的文件里。

真实应用（开发版 Electron + CDP，临时工作区；鼠标走 `Input.dispatchMouseEvent`，按键走 `Input.dispatchKeyEvent`，文字走 `Input.insertText`）：

- 空段落里输入 `/`：分组标签和分组标题都是 文本 / 列表 / 高级，16 项全是「中文 English」写法。菜单宽 262px，没有任何一项被截断或折行。
- 筛选：`/code` 只剩「代码块 Code」，`/table` 只剩「表格 Table」，`/代码` 只剩「代码块 Code」，`/heading` 剩 6 个标题。`/h1` 什么也筛不到，但原来的「Heading 1」本来就不含 `h1`，不是这次改出来的。
- 打开菜单、试了几个关键词、按 Esc、删掉 `/` 之后，笔记文件和打开前逐字节相同。
- `/代码` 回车插入了一个代码块，段落里没有残留 `/`；`/图片` 回车插入空图片块，显示「上传图片」「或粘贴链接」，两者在同一行（截图确认；同一个框里换回 `Upload file` 量出来的尺寸也一样）；在链接框里输入后出现「确定」，没有溢出。
- 有图片时悬停、点说明图标，说明输入框占位是「输入图片说明」。行内空图片显示「上传」「或粘贴链接」。
- 鼠标选中文字后点工具栏的链接按钮，链接输入框显示，占位是「粘贴链接…」。
- 在编辑器里派发一次带 PNG 文件的 `paste` 事件，走的是真实的上传插件和本地后端：上传期间插入的 widget 文字是「正在上传图片…」，上传完成后消失，笔记里插入了 `汉化验收.assets/…png`。

顺带发现（与本票无关，未处理）：窗口较矮时（视口高 816px），光标在笔记中下部输入 `/`，482px 高的菜单上下都放不下，Crepe 把它翻到上方，顶部被 `.typora-editor` 的溢出裁掉，分组标签那一行看不见。菜单高度和文案长度无关，这个问题在汉化之前就存在。已登记为 V104-06。
