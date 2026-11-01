# V103-13: dist:verify 变成真正的全量验证

Status: resolved
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

## 完成情况（2026-11-01）

```
test             npm run test:electron && npm run test:backend && npm run test:frontend
test:frontend    cd frontend && npm test
test:backend     cd backend && mvn test
test:coverage    cd backend && mvn verify
dist:verify      npm test && npm run build && npm run prepare:resources && node scripts/verify-dist-resources.js
```

`npm test` 一条命令跑出 **369** 条：Electron 29 + 后端 132 + 前端 208，退出码 0。快的排前面，失败能早暴露。

### 与原票的偏差：`test:packaged` 不进 `npm test`

原票（和 Q20）写的是 `npm test` = 前端 + Electron + **打包测试** + 后端。实现时发现这样不对：`scripts/packaged-backend.test.js` 依赖 `resources/jre` 和 `resources/backend.jar`，两者都是 gitignore 的构建产物。放进 `npm test`，**干净 clone 上 `npm test` 直接失败**——而这条命令恰恰该是"拿到仓库先跑一下"的那条。

改为让它留在 `prepare:resources` 里（本来就在那儿），并把 `prepare:resources` 加进 `dist:verify`。于是打包测试仍然被覆盖，而且是在产物就位**之后**才跑——顺序比原方案更正确。`dist:verify` 现在覆盖全部四个套件。

### 退出码确实会传上来

这是本票特意点名的坑（"注意不要让管道吞掉退出码"），所以实测了一次：往前端套件里塞一条必失败的哨兵用例，

```
test:frontend 退出码 = 1
npm test      退出码 = 1
```

哨兵已移除。链式 `&&` 还保证失败后不继续跑后面的套件。

### 覆盖率门槛第一次真正执行

`test:coverage` 跑 `mvn verify`，输出 `All coverage checks have been met.`，退出码 0。

这条门槛（`pom.xml` 里 service 包行覆盖 ≥ 80%）**在此之前从未执行过**——旧的 `dist:verify` 跑的是 `mvn test`，而 jacoco 的 `check` 绑在 `verify` 阶段。现在它有了专门的入口。

刻意不放进 `dist:verify`：`mvn verify` 会连带再 package 一次，而 `dist:verify` 里的 `npm run build` 已经 package 过；而且门槛设 80%、实测约 89%，它的价值是"覆盖率掉下去时有人知道"，不是发布阻塞项。

### 文档

`CLAUDE.md` 的 Testing 段重写（含"为什么 test:packaged 不在 npm test 里"和"为什么 test:coverage 单独"两条理由），README 命令表补上 `npm test` 与 `npm run test:coverage`。
