# V105-02: 主窗口和后端同时启动，去掉启动画面

Status: ready-for-agent
Type: Change
Commit prefix: `Change V105-02:`
Spec section: 范围（见 ../spec.md）
Blocked by: 01

## 背景

`electron/main.js` 的 `app.whenReady()` 现在完全是串行的：先显示启动画面，然后 `await startBackend()`，再 `await waitForHealth()`，最后才 `createWindow()`。1.0.4 实测，主窗口约 4.5 秒才开始创建；创建之后渲染进程又花约 0.6 秒加载界面、读文件树。这 0.6 秒本来可以和后端启动同时进行。

后端调优（V105-04、V105-05）完成后，后端约 1.1 秒就绪；渲染进程的界面约 0.6 秒就能画好。如果同时启动，用户在 1 秒内就能看到主窗口。

## 决定（2026-11-08 grilling）

- **去掉启动画面。** 主窗口界面画好（`ready-to-show`）就显示，文件树区域先显示「正在打开工作区…」，后端就绪后再把内容填上。
- 启动失败时的行为不变：错误对话框（`failStartup`），然后退出。
- 双击 .md 打开笔记的流程不变：后端没就绪时，这篇笔记要等后端就绪后再打开，不能报错。

## 改动

主进程（`electron/main.js`）：

- 在 `whenReady` 里先 `createWindow()`，同时 `startBackend()` + `waitForHealth()`，两者并行。删掉 `createSplashWindow`、`closeSplashWindow` 和 `splashWindow` 相关的分支（`second-instance` 里也有一处）。
- `backend:getConfig` 改为返回一个 promise：后端健康检查通过时 resolve 成 `{port, token}`；启动失败时 reject（或者带上错误信息 resolve，看渲染进程怎么处理更简单）。`backend:restart` 之后，再调用 `getConfig` 拿到的要是新的端口和令牌。现在渲染进程依赖的就是这一点，不能改坏。
- `failStartup` 不再关闭启动画面。主窗口这时可能已经显示了，错误对话框要以主窗口为父窗口，或者至少不能被主窗口挡在后面。`WINDOW_READY_TIMEOUT_MS`（30 秒）照旧保留。
- 后端启动超时还是 60 秒，这是唯一的超时来源。

渲染进程（`frontend/src/App.tsx` 的 `bootstrap`、`frontend/src/api.ts`）：

- **先应用偏好设置，再等后端。** 现在 `loadAndApplyPreferenceSettings()` 要等健康检查通过才执行，窗口提前显示就会先闪一下默认主题。偏好设置走 IPC，不经过后端，可以挪到 `initApiConfig()` 之前。
- `initApiConfig()` 改为等待 `getBackendConfig()` 的 promise。现在 `bootstrap` 里的健康检查是 30 次 × 500ms = 15 秒，比主进程的 60 秒短：冷启动慢的时候，渲染进程会先报「无法连接后端服务，请确认 Spring Boot 已启动」，而后端其实马上就要起来了。改成等主进程的结果，不再自己另设一个更短的超时。
- 等待期间，文件树区域显示「正在打开工作区…」。只有设置里有 `lastWorkspace` 时才显示这句；没有工作区时显示现在的空状态。
- `onOpenFilePath`（双击 .md、第二个实例转发过来的文件）在后端就绪之前到达的话，要排队等待，不能直接调用 API。
- 断线横幅（「与后端服务的连接已断开，正在自动重连…」）在启动等待期间不能出现。「还没连上」和「连上后又断了」是两种状态。

开发模式：`npm run dev` 的后端是单独启动的，`getConfig` 直接 resolve 成环境变量里的配置，行为不变。

## 验收

- `electron/main.test.js`（已经 mock 了 electron 模块）新增测试：
  - `whenReady` 之后立刻创建主窗口，不等后端；
  - 后端就绪之前调用 `getConfig`，拿到的 promise 在后端就绪后才 resolve；
  - 后端启动失败时弹出错误对话框，然后退出；
  - `backend:restart` 之后 `getConfig` 拿到新端口。
- 前端测试：
  - 后端没就绪时显示「正在打开工作区…」；
  - 偏好设置（主题）在后端就绪之前就已应用；
  - 等待期间不出现断线横幅；
  - 等待期间收到的打开文件请求，在后端就绪后被打开。
- 打包版（用 V105-01 的脚本和 CDP）：
  - 窗口在后端打出端口之前就显示出来；
  - 双击 .md 启动时那篇笔记能被打开；
  - 把 `backend.jar` 临时改名后启动，错误对话框能出现、应用能退出（测完改回来）；
  - 从标题栏按钮正常退出。
- `perf:measure` 报改动前后的数字（这张票单独做时，后端还没调优，预计能省 0.5 秒左右）。

## Comments
