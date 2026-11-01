# V103-13: dist:verify 变成真正的全量验证

Status: ready-for-agent
Type: Change
Commit prefix: `Change V103-13:`
Spec section: 8（见 ../spec.md）

## 背景

`CLAUDE.md:23` 把 `npm run dist:verify` 写成 Full verification before packaging，但 `package.json:19` 实际是 `mvn test && npm run build && verify-dist-resources.js`：**漏掉 190 个前端用例和 26 个 Electron 用例**，而且跑的是 `mvn test` 不是 `mvn verify`，所以 `pom.xml:76-98` 那条 80% 覆盖率 gate 从未执行过。

没有 root `npm test`，跑全套要三次手工调用。没有 CI（无 `.github/`）。

## 改动

- 新增 root `npm test` = 前端 vitest + Electron + 打包测试 + 后端 `mvn test`
- `dist:verify` = `npm test` → `npm run build` → `verify-dist-resources.js`（带版本值校验）
- 覆盖率 gate 单独走 `npm run test:coverage` = `mvn verify`，**不放进 dist:verify`**

最后一条是故意的：`mvn verify` 会连带再 package 一次，而 `dist:verify` 里的 `npm run build` 已经 package 过了。且该 gate 设 80%、实测 89.4%，不是濒临失败的线，适合按需跑而非挂在发布关键路径上拖时间。

## 验收

`npm test` 一条命令跑出全部四个套件的结果；任一套件失败则整体失败（注意不要让管道吞掉退出码）。

## Comments
