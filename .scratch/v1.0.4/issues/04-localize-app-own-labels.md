# V104-04: 侧栏等应用自己的界面文案仍是英文

Status: needs-triage
Type: Change
Spec section: 无（2026-11-07 triage V104-03 时发现）

## 背景

V104-02、V104-03 汉化的是 Crepe 的文案。应用自己写的界面里也有英文，跟周围的中文对不上：

- `frontend/src/components/SidebarPanel.tsx`：侧栏顶部的 `sidebar-brand-title` 写着「Workspace」，四个标签写着 Files / List / Outline / Search。1.0.0（`ed859ea`）就是这样，没有任何记录说明为什么用英文。
- 同一个侧栏的 `aria-label` 却是中文（「侧栏」「侧边栏选项」）。右侧大纲面板的标题是「大纲」（`App.tsx:2464`），侧栏标签写的却是「Outline」，同一个东西两个名字。

状态栏上的「Markdown」（`StatusBar.tsx:34`）是格式名，V104-03 triage 时已决定保留，不在本票范围内。

## 定案前要先弄清楚的

- 应用自己的界面里还有哪些英文。这次只看了侧栏和状态栏，要把 `frontend/src` 里用户看得到的英文完整清点一遍。
- 「List」标签（`file-list`）实际显示的是什么，译名要贴合它的内容。
- 「Workspace」要译成「工作区」，还是改成显示工作区文件夹的名字。
- 测试改动面：`App.test.tsx:1299-1308` 的 `isSidebarTabSelected('Files' / 'Outline')` 是按英文名找标签的，要跟着改。

## 来源

2026-11-07 triage V104-03 时，从 Q4 拆出来的。先登记，不动手。

## Comments
