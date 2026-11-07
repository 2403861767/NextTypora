# V104-04: 侧栏等应用自己的界面文案仍是英文

Status: resolved
Type: Change
Commit prefix: `Change V104-04:`（和 V104-05、V104-06 合在一个提交里，见完成情况）
Spec section: 无（2026-11-07 triage V104-03 时发现）

## 背景

V104-02、V104-03 汉化的是 Crepe 的文案。应用自己写的界面里也有英文，跟周围的中文对不上：

- `frontend/src/components/SidebarPanel.tsx`：侧栏顶部的 `sidebar-brand-title` 写着「Workspace」，四个标签写着 Files / List / Outline / Search。1.0.0（`ed859ea`）就是这样，没有任何记录说明为什么用英文。
- 同一个侧栏的 `aria-label` 却是中文（「侧栏」「侧边栏选项」）。右侧大纲面板的标题是「大纲」（`App.tsx:2464`），侧栏标签写的却是「Outline」，同一个东西两个名字。

状态栏上的「Markdown」（`StatusBar.tsx:34`）是格式名，V104-03 triage 时已决定保留，不在本票范围内。

## 改动

`SidebarPanel.tsx`：

| 位置 | 原文 | 译文 |
| --- | --- | --- |
| 侧栏标题 | Workspace | 工作区 |
| 标签 | Files / List / Outline / Search | 文件 / 列表 / 大纲 / 搜索 |

## 来源

2026-11-07 triage V104-03 时，从 Q4 拆出来的。

## Comments

### Triage（2026-11-07）

用户指示「这几个 ticket 全做完然后一起提交」，所以定案没有再逐条问，按下面的推荐做了。

查清的事实：

- **应用里还有哪些英文**：扫了 `frontend/src` 里所有 `.tsx` 的 JSX 文本，以及 `title`、`placeholder`、`aria-label`、`label`、`message` 这些属性。用户看得到的英文只有侧栏标题和四个标签。另外几处都保留：
  - 「NextTypora」「NextTyproa」是品牌名；
  - 「Markdown」「TypeScript」「Mermaid」「YAML Frontmatter」是格式名或技术名；
  - 设置里的 `http://127.0.0.1:36677` 是示例地址；
  - `App.tsx:905` 的 `'Note was modified outside NextTyproa'` 只存进冲突状态，从来不显示：冲突对话框用的是中文固定文案。
- **「List」显示的是什么**：`FileList`，当前文件夹里 Markdown 文件的平铺列表。「Files」是目录树。
- **「Workspace」怎么译**：`GLOSSARY.md` 把「工作区」定为正式用语（避免「金库」「库」「仓库」）。
- **测试改动面**：只有 `App.test.tsx` 里 RW-P3-003 的 `isSidebarTabSelected('Files' / 'Outline')` 按英文名找标签，Electron 测试和脚本里都没有。

决定：

1. 标题译为「工作区」，跟术语表一致。不改成显示文件夹名：侧栏底部已经显示了文件夹路径，改成显示文件夹名是功能改动，不是汉化。
2. 四个标签和英文一一对应：文件 / 列表 / 大纲 / 搜索，都是两个字。「文件」和「列表」都在列文件，这个区别英文原来也没体现，本票不处理。「大纲」和右侧面板的标题统一。

### 完成情况（2026-11-07）

测试（`App.test.tsx > V104-04: sidebar labels`，1 条）：侧栏标题，以及 `tablist「侧边栏」` 里四个标签的文字。RW-P3-003 的 `isSidebarTabSelected` 改用「文件」「大纲」查找标签。

- **red**：新用例收到 `Workspace`；RW-P3-003 找不到名为「文件」的标签。
- **中间态**：只改标题，新用例在标签断言上失败，收到 `Files / List / Outline / Search`。
- **green**：两条都过。

回归和真实应用验证跟 V104-05、V104-06 一起做，数字见 V104-06 的完成情况。本票相关的真实应用结果：

- 侧栏标题是「工作区」，四个标签是 文件 / 列表 / 大纲 / 搜索，都没有溢出，截图里文字完整。
- 用真实鼠标依次点 大纲、列表、搜索、文件，每次被选中的都正好是点的那一个。
