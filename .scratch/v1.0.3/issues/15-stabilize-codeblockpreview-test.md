# V103-15: CodeBlockPreview 的 Mermaid 异步用例在全量跑时超时

Status: ready-for-agent
Type: Bug
Commit prefix: `Fix Bug-V103-15:`
Spec section: 11（见 ../spec.md）

## 现象

`frontend/src/components/CodeBlockPreview.test.ts:48`「applies async previews for multiple Mermaid blocks independently」在全量跑时 5000ms 超时；**单独跑该文件 1.87 秒通过**。全量跑需 108 秒（import 阶段累计 172 秒）。

不是产品缺陷，是负载下的脆弱用例。但它证明了没有人跑过全量前端测试——否则这个会被看见。

## 改动

**改用例本身**（它等的是 Promise 链而非真实时间，用假定时器或显式 flush），不调高全局 `testTimeout`。

调高全局会让将来真正卡死的用例反馈更慢，而这是一个没有 CI 的项目最不该牺牲的东西。

## 验收

全量 `npm test` 连续跑三次都绿。

## Comments
