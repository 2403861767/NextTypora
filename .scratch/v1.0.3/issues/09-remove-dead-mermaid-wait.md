# V103-09: 删掉 Mermaid 导出的死机械

Status: ready-for-agent
Type: Change
Commit prefix: `Change V103-09:`
Spec section: 6（见 ../spec.md）

## 背景

`ExportService.java:212` 无条件把 `window.__NEXTTYPROA_MERMAID_DONE__` 设为 `true`，于是 `main.js:896-914` 那个轮询该标志的 `waitForMermaidRender` 第一个 tick 就返回，什么都没等。这 19 行是死机械。

导出不渲染 Mermaid 是**刻意的**本地优先决定（`ExportServiceTest.java:97` 断言不得引用 CDN），README 也诚实写的是「Mermaid 源块」。所以这不是 bug，是该把死代码删掉。

## 改动

删 `waitForMermaidRender` 及其调用点，删 `ExportService` 里那个恒真标志。Mermaid 块继续以 `<pre class="mermaid">` 形式导出为源码块。

## 验收

PDF 导出路径变短但行为不变；导出产物中 Mermaid 仍是带样式的源码块。

## Comments
