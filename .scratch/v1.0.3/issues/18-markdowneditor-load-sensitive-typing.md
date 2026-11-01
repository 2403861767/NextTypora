# V103-18: MarkdownEditor 的"保持原样"用例组在负载下会丢输入

Status: needs-triage
Type: Bug
Commit prefix: `Fix Bug-V103-18:`
Spec section: 11（测试加固；本票在做 V103-15 时发现，不在原 spec 的 17 票内）

## 现象

`frontend/src/components/MarkdownEditor.test.tsx` 里 `MarkdownEditor > keeps untouched markdown byte-for-byte > the edited block keeps its own formatting` 这一组用例，在机器被压满时会失败，**每次失败的具体用例还不一样**：

- 并发跑第 2 次：`editing a nested item changes only that line`、`keeps CRLF line endings everywhere when a paragraph of a CRLF note is edited`
- 并发跑第 3 次：`leaves an untouched reference-style link paragraph alone`、`keeps a two-space hard break inside the edited paragraph`

同一组里随机成员失败，是时序敏感而非逻辑错误的特征。

## 根因

失败不是超时，是断言差异——**敲进去的字符没有落到文档里**：

```
-     * 新人需要培训时间 N      ← Expected
+     * 新人需要培训时间        ← Received（N 丢了）
```

用例通过 `editAndSave` 直接改 ProseMirror 文本节点，然后固定等约 20ms，以便落在编辑器监听器那个 200ms 防抖窗口内（这个手法本身记录在项目的测试备忘里）。机器被压满时这 20ms 不够，保存发生在编辑被采集之前，于是这次编辑整个丢掉。

**产品侧没有缺陷**：200ms 防抖是正常设计，丢的是测试里那次模拟输入。

## 复现条件与真实性校准

这是我为验证 V103-15 故意造出来的恶劣条件：**两个完整 vitest 套件同时跑 + 后端 `mvn test` 同时跑**。

- 单套件 + 后端并发（也就是历史上 CodeBlockPreview 失败的那个条件）：**190/190 全过**。
- 两套件并发 + 后端：两次都挂 2 条。

所以它比 V103-15 那条更脆，但触发条件也比日常使用更极端。日常单套件跑不一定会撞到。

## 改动方向

把 `editAndSave` 里的固定等待换成确定性等待——等"编辑器已经采集到这次变更"这个条件成立，而不是等一段墙上时间。可选：监听编辑器的变更回调后再触发保存，或在触发保存前轮询文档内容直到包含刚敲入的字符。

不要靠调大那个 20ms：和 V103-15 一样，那只是把失败概率推低而不是消除，而且会把整组用例拖慢。

## 验收

两个完整套件并发 + 后端并发的条件下，连续三次全量跑都绿。
