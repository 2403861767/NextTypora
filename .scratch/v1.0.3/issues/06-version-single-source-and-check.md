# V103-06: package.json 作为版本号唯一权威，并在打包前校验值

Status: resolved
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

## 完成情况（2026-11-01）

- `package.json` 的 version：`1.0.0` → **`1.0.3`**（自 `ed859ea` 以来第一次真正被改）。
- `frontend/package.json` 与 `backend/pom.xml` 的 version 保持不动，从此与用户可见版本无关。
- `scripts/verify-dist-resources.js` 新增**值**校验：读 `--expect-version <v>`（也支持 `--expect-version=v` 与环境变量 `EXPECT_VERSION`），与 `package.json` 不符即失败；**不给期望版本也失败**，并在错误信息里直接给出可复制的命令。

要求显式说出版本号是刻意的：打包往往发生在打 tag 之前，这是唯一一个能让机器确认"我在发 1.0.3"的时刻。原来的脚本只检查 `artifactName` 模板里有没有 `${version}`，从不检查值——1.0.2 就是这样错出去的。

### 实测退出码

| 调用 | 退出码 |
| --- | --- |
| 不给版本号 | **1**（并打印 `Re-run as: npm run dist:verify -- --expect-version 1.0.3`） |
| `--expect-version 1.0.2`（值不符） | **1** |
| `--expect-version 1.0.3` | 0 |
| `EXPECT_VERSION=1.0.2` | **1** |
| `EXPECT_VERSION=1.0.3` | 0 |

### 文档同步

- `README.md`：产物名从写死的 `NextTyproa-1.0.0-win-x64.exe` 改为 `NextTyproa-<版本>-win-x64.exe`，并写明"不要手工改名，否则 latest.yml 和 .blockmap 会和产物对不上"；三处 `npm run dist:verify` 都补上了 `-- --expect-version 1.0.3`。
- `CLAUDE.md`：命令块同步，并新增「Version numbers」一节说明 `package.json` 是唯一来源、另外两个 version 是构建元数据、以及禁止手工改名产物（该文件在 .gitignore 里，不进版本库）。

### 顺带修掉我自己在 V103-04 留下的类型错误

跑 `npm run dist:verify` 时在 `npm run build` 阶段炸了：

```
src/api.test.ts(230,18): error TS2352: Conversion of type 'undefined' to type 'RequestInit'...
src/api.test.ts(230,42): error TS2493: Tuple type '[]' of length '0' has no element at index '1'.
```

`vi.fn(() => ...)` 推断出的 `mock.calls` 是空元组，取 `[0][1]` 过不了类型检查。**而 `vitest run` 不做类型检查**，所以 V103-04 当时报的"四套件全绿"是真的，但不完整——我没跑 `npm run build`。已给 mock 显式标注 `(_input: RequestInfo | URL, _init?: RequestInit)` 并去掉强制转型。

教训：这条坑项目备忘里本来就写着（"`npm run build` type-checks test files"），我读过还是踩了。新增前端测试之后应当跑一次类型检查，而不是只跑 vitest。

### 未做

`release/` 里还留着上次的 `NextTyproa-1.0.2-win-x64.exe`（内含 1.0.0 元数据）、孤立的 `NextTyproa-1.0.0-win-x64.exe.blockmap` 和停在 1.0.0 的 `latest.yml`。它们是 gitignore 的构建产物，下次打包会重新生成；我没有删除用户的发布产物。
