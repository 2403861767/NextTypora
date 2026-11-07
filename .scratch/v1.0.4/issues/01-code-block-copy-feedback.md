# V104-01: 代码块复制成功后没有任何提示

Status: resolved
Type: Bug
Commit prefix: `Fix Bug-V104-01:`
Spec section: 无（1.0.4 主题未定，`spec.md` 待写；本票来自用户反馈）

## 现象

用户反馈：在所见即所得模式下，鼠标悬停在代码块上，点右上角的复制按钮，代码确实已经进了剪贴板，但界面上什么都没发生：没有提示，按钮也没有变化。用户无从确认是否复制成功。

## 根因

复制按钮不是项目自己的代码，而是 Milkdown Crepe 的代码块组件（`@milkdown/components` 7.21.2，`code-block/view/components/copy-button.tsx`）。它复制成功后调用配置项 `onCopy(text)`，Crepe 给的默认值是空函数（`@milkdown/crepe/src/feature/code-mirror/index.ts`：`onCopy: config.onCopy || (() => {})`）。

`frontend/src/components/MarkdownEditor.tsx:174` 的 `[Crepe.Feature.CodeMirror]` 配置只设了预览相关的四项，没传 `onCopy`。

对照：应用里其他复制操作（复制绝对路径、相对路径、标签路径）都走 `App.tsx:626` 的 `copyText`，成功时 `messageApi.success('已复制…')`。代码块复制是唯一一个绕开这条约定的复制入口。

## 决定（2026-11-07 grilling）

- **提示形式**：全局 toast，文案「已复制代码」，和「已复制绝对路径」等保持一致。不做按钮原地变成「已复制 ✓」：`onCopy` 只拿到文本，拿不到按钮本身，要做原地反馈就得改 Milkdown 渲染出来的 DOM，一升级就会坏。
- **连续点击**：toast 用固定的 `key`，再次点击时刷新同一条，不叠加。和复制路径的行为不同是刻意的：复制路径是从右键菜单偶尔点一次，代码块复制按钮则经常被连续点击。
- **空代码块**：照样提示「已复制代码」，不做特殊处理。Milkdown 对空块照样执行 `writeText('')`，剪贴板确实被清空了，之后才调用 `onCopy('')`。
- **复制失败**：不处理，见下方「已知局限」。

## 改动方向

给 `MarkdownEditor` 加一个回调 prop（形式同已有的 `onImageUploadError`），传给 Crepe 的 `featureConfigs[CodeMirror].onCopy`；`App.tsx` 在这个回调里调用 `messageApi.success`，带上文案「已复制代码」和固定的 `key`。

回调要用 ref 持有，和 `onImageUploadErrorRef` 一样：Crepe 的配置只在 `useEditor` 创建编辑器时读取一次。

## 测试

先红后绿：

- **测试工具调整（red 阶段要写明）**：代码块是懒挂载的。`node-view.ts` 先渲染一个 `<pre class="milkdown-code-block-placeholder">` 占位，等 IntersectionObserver 报告它可见时才挂载 CodeMirror 和工具栏。`App.test.tsx:208` 和 `MarkdownEditor.test.tsx:213` 里的 IntersectionObserver 替身什么都不做，所以 jsdom 里**根本没有 `.copy-button`**。替身要改成在 `observe` 时以 `isIntersecting: true` 调用回调。注意 Milkdown 的 observer 是模块级单例（`sharedObserver`），同一个测试文件里第一个代码块创建时用的是哪个替身，之后就一直是它。
- 用类名 `.copy-button` 找按钮，不要按文字找：V104-02 会把「Copy」改成「复制」。
- 断言：stub 掉 `navigator.clipboard.writeText`，点击后剪贴板收到代码文本，且出现「已复制代码」；连续点两次，屏幕上只有一条提示。

真实应用：在开发版 Electron 里悬停代码块、点复制，确认看到提示，再粘贴核对内容。

## 已知局限：复制失败时仍然没有任何提示

Milkdown 的 `copyToClipboard`：

```ts
try {
  return navigator.clipboard.writeText(text)   // 没有 await
} catch {
  // execCommand('copy') 兜底
}
```

`writeText` 返回的 Promise 被拒绝时不会进入 `catch`，所以 `execCommand` 兜底只有在 `navigator.clipboard` 根本不存在（同步抛错）时才会执行。被拒绝的 Promise 最后落到按钮的 `.catch(console.error)`，`onCopy` 不会被调用。也就是说，复制失败时用户依然什么都看不到。

本票不处理，理由：

- 用户反馈的是复制**成功**后没有提示。
- Electron 里几乎不会失败：`electron/main.js` 没有设置权限处理器，打包版用 `loadFile` 加载，点击按钮时窗口必然处于聚焦状态。
- 要处理失败，只能自己接管复制（在捕获阶段拦截点击，从 ProseMirror 节点取文本；不能读 `.cm-content`，CodeMirror 只渲染可见的行），或者用 patch-package 改 Milkdown。两种做法都要长期绑在 Milkdown 的内部实现上，代价和收益不成比例。

以后真遇到复制失败的案例再另开票。漏写 `await` 这个问题也值得报给 Milkdown 上游（目前还没报）。

## 验收

- 点代码块的复制按钮，剪贴板得到代码，屏幕上出现一条「已复制代码」。
- 连续点击时只保留一条提示。
- 源码模式不受影响（那里本来就没有复制按钮）。

## Comments

### 完成情况（2026-11-07）

改动：

- `MarkdownEditor.tsx`：新增 `onCodeCopy` prop，用 `onCodeCopyRef` 持有，传给 Crepe 的 `[Crepe.Feature.CodeMirror].onCopy`。外层的 `MarkdownEditor` 包装组件要把这个 prop 显式转给 `EditorInner`，它是逐个列 prop 的，漏了这一处回调就是 `undefined`。
- `App.tsx`：`onCodeCopy` 调用 `messageApi.success({ content: '已复制代码', key: 'code-block-copy' })`。

测试工具调整：`App.test.tsx` 的 IntersectionObserver 替身改成可以按需报告“可见”的 `StubIntersectionObserver`，再加一个 `revealCodeBlocks()`。不调用它时行为和原来的空替身一样，其他用例不受影响。

红→绿（`App.test.tsx > V104-01: copying a code block`，3 条）：

- **red**：3 条全部失败，失败点都是“没有提示”（预期 1 条，实际 0 条）。同一用例里前面的断言已经通过：找到了复制按钮，`writeText` 收到了代码（空代码块收到 `''`）。所以失败落在缺陷本身，而不是测试环境上。
- **中间态**：先只接 toast、不加 `key`，“连续点击”那条失败，屏幕上叠出 2 条提示，证明这条断言不是摆设。
- **green**：加上 `key` 后 3 条全过。

回归（`npm run dist:verify -- --expect-version 1.0.3`，exit 0）：Electron 30/30，后端 138/138，前端 211/211（22 个文件，含新增 3 条），构建通过，`test:packaged` 12/12，发布资源校验通过。

真实应用（开发版 Electron + CDP，临时工作区，独立的 user-data-dir，鼠标事件走 `Input.dispatchMouseEvent`）：

- 悬停前复制按钮 `opacity` 为 0，悬停后为 1；点击后顶部出现「已复制代码」，系统剪贴板（`Get-Clipboard`）的内容是 `console.log("你好，V104-01");`。
- 间隔 400ms 连续点两次：只有一条提示。
- 空代码块：提示「已复制代码」，系统剪贴板被清空。
- 笔记文件的修改时间没有变化，复制操作不碰文件。

顺带看到：按钮文字仍是「Copy」，留给 V104-02。
