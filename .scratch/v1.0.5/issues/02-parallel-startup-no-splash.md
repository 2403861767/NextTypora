# V105-02: 主窗口和后端同时启动，去掉启动画面

Status: resolved
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

### 完成情况（2026-11-08）

改动：

- `electron/main.js`：删掉启动画面（`createSplashWindow`、`closeSplashWindow`、`splashWindow`，含 `second-instance` 里那一处）。新增 `launchBackend()`，即 `startBackend()` 加 `waitForHealth()`，结果存在 `backendReady` 这个 promise 里。`whenReady` 先 `launchBackend()` 让后端起跑，紧接着 `createWindow()`，然后再等后端，失败走 `failStartup`。`backend:getConfig` 返回 `backendReady`：健康检查通过时 resolve 成 `{port, token}`，启动失败时 reject。`restartBackend()` 改调 `launchBackend()`，换成新的 promise，所以重启之后、以及重启进行中读到的都是新端口和新令牌。`startBackend()` 内部一行没动，spawn 参数还是 `['-jar', jarPath]`，留给 V105-04 接 `backendLaunch.js`。后端超时只剩 `startBackend` 的 60 秒这一个来源。`WINDOW_READY_TIMEOUT_MS` 照旧。
- `frontend/src/App.tsx`：`bootstrap` 先 `loadAndApplyPreferenceSettings()`（走 IPC），再 `await initApiConfig()`，去掉了渲染进程自己的 30 × 500ms 健康检查和「无法连接后端服务」。删掉「正在连接后端...」那张卡片（连同 `styles.css` 里没人用了的 `.app-entry-spinner`），界面在后端就绪之前照常画出来。设置里有 `lastWorkspace` 时，文件树区域显示「正在打开工作区…」，没有时显示原来的空状态「暂无文件」。断线横幅不变：心跳只在 `ready` 之后才跑，`backendOnline` 初始为 true，所以等后端期间不会出现。
- `frontend/src/api.ts`：`initApiConfig()` 返回主进程的 promise。

工单没写死、实现时定下的几处：

- **启动失败的对话框**：主窗口已经显示时，用 `dialog.showMessageBoxSync(mainWindow, …)`，以主窗口为父窗口，窗口最小化了就先还原。主窗口还没显示时（比如 jar 不见了，几乎立刻失败），照旧用 `dialog.showErrorBox`。两条路的对话框长得一样：打包版实测 `showErrorBox` 的标题栏是 `Error`，正文是「NextTypora 启动失败」加错误信息，父窗口那条路照这个写。启动已经失败、正在退出时，晚到的 `ready-to-show` 不再显示窗口。
- **`getConfig` 失败时 reject**，不带错误信息 resolve。渲染进程 `bootstrap` 的 catch 会把它显示在错误卡片上，但主进程这时已经弹出错误框，关掉以后退出。
- **后端就绪之前发出的请求先等配置**（`api.ts` 的 `request()`）。窗口提前显示以后，用户可能马上点「打开文件夹」「新建笔记」等。不等的话，请求会打到默认的 8080 端口上，报「无法连接到后端服务」。只有启动时的那一次挡住请求；断线重连时（包括后端重启中）请求照旧立即失败，交给心跳和断线横幅处理。
- **编辑区先留空**：等后端、恢复工作区期间，以及排队的打开文件请求还没打开完时，标签栏和编辑区都不渲染。这样不会先闪一下「打开本地 Markdown 文件」占位，就绪后编辑区也是新挂载的（`AnimatePresence initial={false}`），恢复的笔记和文件树在同一次渲染里出现，和 1.0.4 一样，没有多出一段离场动画。`perf-measure.js` 的选择器不用改：等待期间的占位是 `.sidebar-empty`，不匹配 `.file-tree .tree-file-label`。
- **排队的打开文件请求**：`handleOpenAbsoluteFile` 原来就会在 `ready` 之前排队，这次加了 `openingRequestedNote`，排队的那篇打开之前编辑区保持空白。原因见下一节。打开失败时，编辑区显示恢复的那篇。

**发现的已有问题（没修，建议单开工单）**：在一篇笔记的编辑器刚挂上、Milkdown 还没触发 `onReady` 时打开另一篇，旧编辑器晚到的 `onReady` 会把旧正文写进新笔记的状态：它调用 `setContent(旧正文)`，并且因为此刻 `content === loadedContent`，连 `setLoadedContent(旧正文)` 也一起调。结果新标签页显示的是旧笔记的正文；这时一输入，自动保存会把旧正文写进新文件，而 baseHash 是新文件的，后端会接受。在 jsdom 里用改动前的代码复现过：恢复标签页 a.md，再在 `ready` 之前排队一个 `onOpenFilePath` 请求，就绪后 日记/双击.md 的标签页显示的是 a.md 的正文。1.0.4「双击 .md 启动、有恢复的标签页」走的是同一段代码，但没有在真实的 1.0.4 上复现过。这张票只在启动这条路上避开了它（排队的笔记打开之前不挂编辑器，只挂一次）。其他「刚打开又马上打开另一篇」的情况仍然可能触发。修法建议：让 `MarkdownEditor` 的 `onReady` 带上 noteKey，App 忽略 noteKey 不是当前 `editorNoteKey` 的上报。

红→绿：

- **主进程**（`electron/main.test.js`，新的 `bootPackaged` 用打包模式加载真实的 `main.js`，`child_process.spawn` 换成假的 java 进程，由测试决定它什么时候打出端口、什么时候退出；不断言 spawn 参数，V105-04 改参数不会碰坏它）。新增 6 条，改动前 4 条失败，都是缺陷本身：
  - 「主窗口立刻创建」：`the main window exists before the backend printed its port`，实际是 `undefined`。
  - 「getConfig 等后端就绪」：`getConfig waits while the backend has not printed its port`，实际立刻返回。
  - 「窗口显示后后端退出 → 以主窗口为父窗口的错误框，然后退出」：改动前主窗口根本还不存在。
  - 「重启后 getConfig 拿到新端口，重启进行中也要等」：改动前重启进行中直接返回旧端口。
  - 另外 2 条改动前就通过，是回归护栏：「backend.jar 不见了 → 错误框，然后退出」「开发模式 getConfig 给环境变量里的配置」。
  - 改动后 20/20。
  - **中间态**（证明断言起作用，改完立刻还原）：`failStartup` 改回只用 `showErrorBox`，父窗口那条失败；`restartBackend` 改回直接 `startBackend()` 加 `waitForHealth()`、不换 promise，重启那条失败在 `getConfig waits for the restarted backend`。
- **渲染进程**（`App.test.tsx` 新增 6 条，`api.test.ts` 新增 2 条）。改动前 7 条失败：
  - 「正在打开工作区…」：找不到这句，显示的是「正在连接后端...」卡片。
  - 「没有工作区时显示空状态」：找不到「暂无文件」。
  - 「主题在后端就绪之前应用」：`expected 'default-light' to be 'default-dark'`。
  - 「等待期间不出现断线横幅」：找不到「正在打开工作区…」。
  - 「等待期间收到的打开文件请求，就绪后打开」：`expected 'A恢复的笔记' to contain '双击打开的笔记'`。排队本身原来就有，失败的原因是上面那个 `onReady` 竞争：加日志确认过，`openNoteAt` 读到了双击那篇，随后 a.md 编辑器晚到的 `onReady` 把正文改了回去。
  - 「主进程交出配置就打开工作区，没有自己的健康检查超时」：健康检查返回 false 时，旧代码卡在 15 秒的循环里，10 秒内没打开。
  - `api.test.ts`「后端就绪前的请求等端口和令牌」：旧代码立刻请求 `http://127.0.0.1:8080/api/workspace`，令牌为空。
  - 「重连等待重启中的后端时不挡别的请求」改动前就通过，是护栏，固定「只挡启动那一次」这个选择。
  - 改动后 8/8。
  - **中间态**：去掉心跳的 `if (!ready)`，横幅那条失败；`editorAreaPending` 不算 `openingRequestedNote`，打开文件那条失败，还是那个竞争；`handleOpenAbsoluteFile` 不排队，同一条失败在「后端没就绪不能调 API」（`setWorkspace` 被调了一次）。

回归：`npm run dist:verify -- --expect-version 1.0.4` 跑了两次。第一次运行途中又改了三处（`failStartup` 先还原最小化窗口、测试替身加 `isMinimized`、删掉没用的 CSS），所以在最终代码上又跑了一遍，以第二次为准：退出码 0。其中 `test:electron` 36/36，`test:backend` 138/138，`test:frontend` 23 个文件 243/243，`build`（tsc + vite）通过，`test:packaged` 12/12，`verify-dist-resources` 通过。第一次的结果和第二次相同。

打包版冒烟测试（`npm run dist:dir` 生成的 `release/win-unpacked`；确认过 `app.asar` 里的 `main.js` 是新的，有「正在打开工作区」、没有「正在连接后端」）。驱动脚本放在 scratchpad，没有提交：CDP 用 `test/v103-17-retest/lib/cdp.mjs`，窗口和对话框用自己写的 PowerShell（Win32 + UIA）。每次启动都用新的 `--user-data-dir` 和新的 `test/e2e-vault` 副本（在仓库外），用参数数组 spawn，不经过 `cmd.exe`。四个场景都通过。下面的时间是在另外两个会话同时编译的机器上测的，只用来比先后，**不是 perf 数字**：

1. **窗口先于后端显示**：主窗口在 spawn 后 0.80 秒可见（1440×816），文件树区域 0.94 秒出现「正在打开工作区…」。后端日志 `Started NextTyproaApplication` 在 3.67 秒，NEXTTYPROA_PORT 紧接着打出。文件树 4.04 秒出现。
2. **命令行传 .md 启动**（恢复的标签页是 ascii-notes.md，argv 是 日记/笔记A.md）：4.19 秒编辑区显示笔记A的正文，没有混进 ascii-notes 的正文；标签页是 `ascii-notes.md`、`日记/笔记A.md`，激活的是笔记A。两篇文件的 SHA-256 和原件一致。
3. **`resources/backend.jar` 临时改名**：0.96 秒弹出错误框，标题栏 `Error`，正文「NextTypora 启动失败」「Backend jar not found: …\backend.jar」，在前台，没有任何主窗口可见。点「确定」以后进程退出（退出码 0）。jar 改回原名，SHA-256 前后一致（`5020a124…`）。
   另加一项：主窗口显示、文件树区域显示「正在打开工作区…」以后，用 taskkill 结束 java.exe。错误框的父窗口就是主窗口（`Chrome_WidgetWin_1`，hwnd 一致），在前台，正文「后端进程异常退出 (code=1)。」加日志尾部。点「确定」以后退出（退出码 0）。
4. **标题栏按钮退出**：在场景 2 结束时点 `.window-close-btn`，进程退出（退出码 0），java.exe 也没了。另加一项：等后端期间（「正在打开工作区…」还在）点关闭，0.13 秒退出（退出码 0），java.exe 也没了。

第一次冒烟的结果作废，没算进上面：我自己脚本里的 PowerShell 5.1 坑（单个 `[pscustomobject]` 没有 `.Count`）导致窗口时间没记上，后两个场景因此晚了 60 秒才开始。另外 UIA 里任务对话框的「确定」是 Pane 不是 Button，没点到，只能结束进程。修好脚本以后整组重跑，结果如上。

perf 数字待父会话串行测量：同时有别的会话在编译、跑测试，这里没跑 `npm run perf:measure`。

真实设置文件 `%APPDATA%\NextTyproa\settings.json`：两次冒烟前后的 SHA-256 都是 `5604701eb4c5dbbd6d7ec8caee310d1c15fd75d9a4ecbfe8fb6561304b21bfe6`（修改时间仍是 2026-10-01）。每个临时 user-data-dir 里都有 `Local State`、`logs/backend.log`，以及被应用改写过的 `settings.json`。跑完以后没有遗留的测试进程。

留下的边角：设置里有 `lastWorkspace` 时，如果用户在等后端那一两秒里从工具栏「打开文件夹」选了别的目录，请求会排队等后端，不报错。但它和启动时恢复上次工作区的请求谁后到，最后就停在谁上。概率很小，没处理。
