# 升级 Electron

Status: needs-triage
Type: Change
来源：1.0.5 grilling（2026-11-08）Q8，见 [`../../v1.0.5/spec.md`](../../v1.0.5/spec.md)「本版不做」

## 背景

根 `package.json` 用的是 `electron ^33.2.0`，已经过了 Electron 的支持期，不再有 Chromium 安全修复。1.0.5 只做性能，所以没有夹带升级。

## 升级时要注意

- 换了 Chromium 版本，各进程的内存都会变。升级前后各跑一次 `npm run perf:measure`。1.0.4 的 Electron 一侧（主进程、GPU、网络服务、渲染进程）合计约 120MB 专用工作集。
- 打包版测试工具链依赖 CDP（`--remote-debugging-port`、`/json/list`、`Runtime.evaluate`）。memory 里的打包版测试经验和 `test/v103-17-retest/lib/` 要一起验证。
- `electron-builder` 很可能也要跟着升级。`verify:release` 读的是安装包自身的 PE 元数据和 `latest.yml`，升级后要确认这些校验依然成立；`build/installer.nsh` 里的 `custom*` 宏也要确认 hook 名没有变（`verify-dist-resources.js` 会拦住不认识的宏名）。
- 主进程用到的 API（`shell.trashItem`、`webContents.printToPDF`、`will-prevent-unload`、`requestSingleInstanceLock` 等）对照各版本的 breaking changes 过一遍。`electron/main.test.js` 是 mock 出来的，测不出这类问题，要靠打包版冒烟测试。

## Comments
