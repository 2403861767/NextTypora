# V103-16: 恢复被删掉的 1414 行缺陷史为归档

Status: resolved
Type: Change
Commit prefix: `Change V103-16:`
Spec section: 9（见 ../spec.md）

## 背景

`BUG_BACKLOG.md`（660 行）与 `BUG_BACKLOG_REAL_WORLD.md`（754 行）在 `ba867ca` 被整体删除并写进 `.gitignore:25-26`，磁盘上也不存在，只能用 `git show ba867ca^:<file>` 取回。

两份里**未关闭条目为 0**——54 条全部 `[x]`。不是「有 bug 被埋了」，是「缺陷史被扔了」。

## 改动

- 用 `git show ba867ca^:<file>` 取回，放到 `docs/history/`
- 从 `.gitignore` 删掉那两行
- 同时删掉 `.gitignore` 里的 `test/`——e2e 夹具就是这么丢的

## 为什么值得

那 54 条记录是这个产品踩过的全部坑（编码检测、路径穿越、per-path 锁、孤儿进程、标签页恢复）。`CLAUDE.md` 里那些「⚠️ 关键安全规则」的**理由**就在这两份文件里，规则本身已经脱离了证据。而且其中的「未能覆盖」清单是 V103-17 唯一的现成依据。

## Comments

- `.gitignore` 的 `test/` 已改为 `/test/`（随 V103-01 之后单独提交）。**这不是本条的附带清理，而是 V103-14 与 V103-17 的前置依赖**：不带前导斜杠时 `test/` 会匹配 `backend/src/test/`，新建的后端测试文件会被静默忽略——`git add` 拒绝、`git status` 不显示。实测三向验证：新建后端测试文件与测试资源均不再被忽略，根目录 `test/` 仍被忽略。
- 改法是锚定而非删除：根目录那个临时 `test/` 目录仍应被忽略。
- 本条余下部分（取回两份 backlog 到 `docs/history/`、删掉 `.gitignore` 里的 `BUG_BACKLOG*.md` 两行）尚未做。

## 剩余部分完成（2026-11-01）

用 `git show ba867ca^:<file>` 取回两份文件到 `docs/history/`，并与 git 历史逐字校验（sha256 一致）：

| 文件 | 行数 | 条目 | 未关闭 |
| --- | --- | --- | --- |
| `BUG_BACKLOG.md` | 660 | 27 | 0 |
| `BUG_BACKLOG_REAL_WORLD.md` | 754 | 27（RW 编号去重后） | 0 |

`.gitignore` 里那两行已删除，所以它们从此真正进版本库，而不是"躺在仓库里但被忽略"。

新增 `docs/history/README.md` 说明这是**已完结的历史、不是待办清单**，当前待办在 `.scratch/v1.0.3/`；并点出一个例外：`BUG_BACKLOG_REAL_WORLD.md` 末尾的「未能覆盖 / 测试局限」一节至今有效，是 V103-17 打包版复测的唯一现成依据。

本票的另一半（把 `test/` 锚定为 `/test/`）在 `dd4d985` 已经完成。
