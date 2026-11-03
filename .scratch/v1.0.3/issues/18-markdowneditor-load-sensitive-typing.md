# V103-18: MarkdownEditor 的"保持原样"用例组在负载下会丢输入

Status: resolved
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

## Comments

### 根因修正（2026-11-03）：字符没有丢

本票原来写的根因是错的。用一个探针逐个夹具量了「挂载之后、任何模拟输入之前」会收到几次 `onChange`：

| 夹具 | 挂载后的 stale 上报 | 与载入内容相同 |
| --- | --- | --- |
| READING_NOTES（`*` / `+` 列表） | 1 | 是 |
| 会议纪要 CRLF（`-` 列表） | 1 | 是 |
| TECH_DOC（脚注 + 引用式链接） | 1 | 是 |
| CONTACTS（`-` 列表） | 1 | 是 |
| `- a` / `+ b` 相邻两列表 | 1 | 是 |
| SETEXT | 0 | — |
| TABLE | 0 | — |
| ASCII_NOTES | 0 | — |
| 纯「标题 + 一段正文」 | 0 | — |

带列表或脚注的文档在挂载时会被规范化一次，于是 `markdownUpdated` 先带着**与载入内容逐字节相同**的
文本上报一次（块保留器让未改动的块按原文序列化，所以字节上一模一样）。

`editAndSave` 等的是 `waitFor(() => expect(onChange).toHaveBeenCalled())`——这一次 stale 上报就足以满足它。
机器被压满时 `waitFor(onReady)` 的轮询会被推到 200ms 防抖窗口之后才返回，模拟输入于是发生在 stale 上报
**之后**，`waitFor` 立刻通过，断言拿到的是载入内容，表现为「刚输入的字符不见了」。

这解释了本票里「每次失败的用例都不一样」：**只有 stale=1 的夹具会失败**。本票记录过的四条失败
（nested item、CRLF、reference-style link、hard break）分别属于 READING_NOTES / CRLF / TECH_DOC / CONTACTS，
全部落在 stale=1 这一列；stale=0 的 setext 与 table 一次都没出现过。

顺带确认**产品侧确实没有缺陷**：脏状态是 `content !== loadedContent`（`App.tsx:478`、`:492`），
而 stale 上报的文本与 `loadedContent` 逐字节相同，所以既不会把标签页标脏，也不会触发一次多余的保存。

### 改动

新增 `waitForCollectedEdit(loaded, latestReport)`：等「上报的内容不再等于载入内容」这个条件成立，
而不是等「`onChange` 被调用过」，更不是等一段墙上时间。文件里 7 处「改 DOM → 等 onChange」全部改用它。
改动只在 `MarkdownEditor.test.tsx`，产品代码一行没动。

### 红 → 绿

不靠压机器，用一个确定性的红：在四处 `typeAtEndOf` 之前插 400ms（> 200ms 防抖），
把「输入晚于挂载那次刷新」从偶发变成必然。

- **红**（旧等待 + 400ms）：6 条失败——`editing one item of a "*" list`、`editing a nested item`、
  `keeps CRLF line endings everywhere`、`leaves an untouched reference-style link paragraph alone`、
  `keeps a two-space hard break`、`never merges an edited list into a neighbouring list`。
  失败形态与本票记录的一致：断言差异，少了刚输入的字符。stale=0 的 setext / table / ASCII_NOTES 全过。
- **绿**（新等待 + 400ms 仍在）：16/16 通过。
- **绿**（移除 400ms）：16/16 通过，用时从 8.97s 回到 4.82s。

### 验收结果

两个完整 vitest 套件并发 + 后端 `mvn test` 并发，连续三轮（20:57–21:03）：

| 轮次 | vitest A | vitest B | 后端 |
| --- | --- | --- | --- |
| 1 | 208/208 | 208/208 | 138/138 |
| 2 | 208/208 | 208/208 | 138/138 |
| 3 | 208/208 | 208/208 | 138/138 |

全量回归：`npm test` 绿（Electron 29/29、后端 138/138、前端 208/208），`npm run build` 通过
（它会对测试文件做类型检查）。

两点说明，不要当成比实际更强的证据：

- 这三轮只证明「修完之后在该负载下不再失败」。真正证明机制的是上面那个确定性的红，而不是这三轮——
  我没有在同样这三轮里把旧代码跑一遍。
- `pendingMarkdownRef` 那条用例（`:60`）仍保留固定的 20ms 等待。它的断言是「此刻**还没**上报」，
  属于另一种时序依赖，且它用的夹具 stale=0，不会被本票这个机制打到。真要加固得换一种写法，
  本票不顺手改。

Status 从 `needs-triage` 改为 `resolved`。
