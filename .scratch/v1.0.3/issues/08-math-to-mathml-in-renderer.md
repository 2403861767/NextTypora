# V103-08: 数学公式导出后静默变成纯文本

Status: ready-for-agent
Type: Bug
Commit prefix: `Fix Bug-V103-08:`
Spec section: 5（见 ../spec.md）

## 现象

编辑器里 `$E=mc^2$` 经 `Crepe.Feature.Latex` + KaTeX 正常渲染，但导出 HTML/PDF 后变成纯文本，且不报错。`ExportService` 注册的 6 个 flexmark 扩展里没有数学扩展，导出模板里没有 KaTeX。

## 为什么不在后端修

`flexmark-all` 0.64.8 的全部 40 个扩展里**没有任何数学扩展**，Java 侧也没有 LaTeX→MathML 转换器。已逐一核对过本地仓库的扩展列表。

## 改动

见 `docs/adr/0003-export-fidelity-in-renderer.md`。在渲染进程用已有的 `katex@0.17.0`（`output: 'mathml'`）对后端产出的 HTML 做一次替换，后端 `ExportService` 一行不动。

- KaTeX 类型定义为 `output?: "html" | "mathml" | "htmlAndMathml"`，运行时确实处理 `output === "mathml"`
- 纯 MathML = 零 CSS、零 JS、零字体，导出产物自包含
- 导出 HTML 本来就流经渲染进程（`App.tsx:1277`），不需要新增依赖

## 验收

- HTML 与 PDF 两条导出通路都保留公式
- `ExportServiceTest.java:97`「导出 HTML 不得引用 CDN」的断言仍然通过
- 行内 `$…$` 与块级 `$$…$$` 都覆盖

## Comments
