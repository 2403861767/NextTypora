# V103-08: 数学公式导出后静默变成纯文本

Status: resolved
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

## 完成情况（2026-11-01）

新增 `frontend/src/utils/exportMath.ts`，接在 `App.tsx` 的 `prepareExportHtml()` 出口处——**HTML 与 PDF 两条导出通路共用它**，所以一处接入两条都覆盖。后端 `ExportService` 一行未动。

### 用 DOM 遍历而不是对 HTML 做正则

直接正则替换会误伤代码块里的 `$HOME`、`$PATH`，也可能命中属性值。实现改为 `DOMParser` 解析 + `TreeWalker` 走文本节点，跳过 `CODE / PRE / SCRIPT / STYLE / MATH / TEXTAREA` 祖先。行内公式还要求 `$` 后不接空白、`$` 前不接空白、结束 `$` 后不接数字，避免把"单价 $5 到 $10"吃掉。

输出用 `katex.renderToString(..., { output: 'mathml' })`：**零 CSS、零 JS、零字体**，导出产物自包含，满足"不得引用 CDN"这条本地优先约束。

### 用真实后端输出验证，而不是只用手写夹具

起了后端、放了一篇含行内公式、块级公式、bash 代码块和金额的笔记，`curl` 打 `/api/export/html` 拿到真实导出，再把它喂给这个函数。

先确认缺陷真实存在——后端导出里公式就是纯文本：

```
<p>质能方程 $E = mc^2$ 在行内。</p>
<p>$$
  ...
$$</p>
含 math 标签: False     含 katex: False
```

处理后：`<math>` 元素 2 个、`$E = mc^2$` 消失、金额 `$5`/`$10` 原样、不含 `cdn.`。

### 一个真实输出才暴露的副作用

对照前后文档逐项数了一遍：

```
<style>   before=1 after=1      lang="    before=1 after=1
<meta     before=2 after=2      charset   before=1 after=1
<title>   before=1 after=1      mermaid   before=1 after=1
<math     before=0 after=2      &quot;    before=2 after=0
```

结构、样式、编码声明、Mermaid 块全部保留；唯一的额外变化是**实体归一化**（`&quot;` → `"`）和行尾 CRLF → LF，这是 `DOMParser` + `outerHTML` 往返的必然结果。两者对浏览器渲染完全等价。

爆炸半径已经被限制住：**不含公式的文档原样返回、一个字节都不动**（有用例保证），只有确实含公式的文档才会被重新序列化。这个取舍已经写成一条断言留在用例里，免得将来被当成 bug 重新"修"一次。

### 测试

`exportMath.test.ts` 10 条：行内、块级 display 模式、不引入任何外部资源、代码块不动、行内代码不动、金额不动、无公式原样返回、同段多条公式、坏公式不抛异常、以及上面那条记录序列化取舍的。

全量：前端 **208/208**（22 个文件）、类型检查 0 错。
