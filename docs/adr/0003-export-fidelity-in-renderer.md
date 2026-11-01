# 导出的公式渲染放在渲染进程

Status: accepted

后端 `ExportService` 负责 markdown→HTML，但它渲染不了数学公式：`flexmark-all` 0.64.8 的全部扩展里没有任何数学扩展，Java 侧也没有 LaTeX→MathML 转换器。我们因此把公式渲染放在**渲染进程**，用前端已有的 KaTeX（`output: 'mathml'`）对后端产出的 HTML 做一次替换。

原因：MathML 不需要 CSS、JS 或字体，导出产物保持自包含——而「导出 HTML 不得引用 CDN」这条本地优先约束已由 `ExportServiceTest` 锁定。另外，编辑器里的公式本来就是同一个 KaTeX 渲染的，所见即所得由**同一个实现**保证，而不是靠前后端两套渲染器碰巧对齐。

## Consequences

markdown→最终产物这条链被切成两层：**后端管结构，前端管保真**。任何绕过渲染进程、直接消费 `/api/export/html` 的新通路都会丢掉公式。

已导出的文件不会随后续改动而变，所以将来若从 MathML 换成内联 KaTeX，只对之后的导出生效。
