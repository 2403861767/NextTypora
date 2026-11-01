# V103-06: package.json 作为版本号唯一权威，并在打包前校验值

Status: ready-for-agent
Type: Change
Commit prefix: `Change V103-06:`
Spec section: 4（见 ../spec.md）

## 背景

`package.json` 从未被 bump（唯一一次设置是 `ed859ea` 的 `1.0.0`），而 `release/` 里的 `NextTyproa-1.0.2-win-x64.exe` 是 electron-builder 按 `1.0.0` 命名后**手工改名**的产物：`latest.yml` 记录的 `1.0.0` 条目大小 `169835705` 与该 exe 字节数完全一致，`1.0.0` 的 `.blockmap` 孤零零留在原地，exe 的 PE 元数据仍是 `1.0.0`。代码是对的（构建在 `ba867ca` 之后两分钟），错的只是版本号。

`verify-dist-resources.js:33` 已经在检查 `artifactName` 含不含 `${version}` 模板，却从不检查值是什么——校验了模板、漏掉了值，正是这个洞。

## 改动

- `package.json` 的 version 改为 `1.0.3`，它是唯一喂给 electron-builder 产物名与 `app.getVersion()` 的来源
- `frontend/package.json` 与 `pom.xml` 的 version 从此与用户可见版本无关，不跟着动
- `verify-dist-resources.js` 增加值校验：`package.json` 的 version 必须等于**显式传入**的期望版本，不一致直接 fail

要求显式传入而非读 git tag：打包往往发生在打 tag 之前，让人把版本号说一遍，是让「我在发 1.0.3」被机器确认一次的机会。

## 验收

传错版本号时 `dist:verify` 失败并指出不一致；传对时通过。依赖 V103-05。

## Comments
