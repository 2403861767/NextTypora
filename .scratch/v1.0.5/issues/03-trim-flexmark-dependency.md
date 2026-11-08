# V105-03: 把 flexmark-all 换成实际用到的模块

Status: ready-for-agent
Type: Change
Commit prefix: `Change V105-03:`
Spec section: 实验：方案依据（见 ../spec.md）
Blocked by: 01

## 背景

`backend/pom.xml` 依赖的是 `com.vladsch.flexmark:flexmark-all:0.64.8`。它把 flexmark 的全部扩展和转换器都带进来了，连同 icu4j（14MB）、pdfbox、fontbox、xmpbox、openhtmltopdf、jsoup 等。`backend.jar` 一共 46MB，其中约 20MB 是用不到的。

实际用到 flexmark 的只有 `ExportService`：核心解析器和 HTML 渲染器，加上 6 个扩展：autolink、footnotes、gfm-strikethrough、gfm-tasklist、tables、yaml-front-matter。后端测试代码没有直接引用 flexmark。

去掉这些依赖对内存影响不大（没用到的类本来就不会被加载），但能让安装包和后端目录变小，冷启动时少读一些文件。另外 V105-05 改成普通 classpath 布局后，`lib/` 下的 jar 少一大半，训练运行和类路径校验也更简单。

## 改动

- 把 `pom.xml` 里的 `flexmark-all` 换成：`flexmark`、`flexmark-ext-autolink`、`flexmark-ext-footnotes`、`flexmark-ext-gfm-strikethrough`、`flexmark-ext-gfm-tasklist`、`flexmark-ext-tables`、`flexmark-ext-yaml-front-matter`，版本都是 0.64.8。`flexmark-util-*` 会作为传递依赖带进来。
- 编译不过就按缺的类补模块，不要退回 `flexmark-all`。
- 顺带看一下 `jsoup` 和 `commons-logging`：去掉 `flexmark-all` 之后它们还在不在？如果 `commons-logging` 还在，Spring 启动时那条「please remove commons-logging.jar」的提示也一起处理掉。只在改动很小时顺手做；改动大就单独开票，按本版范围的规则办。

## 验收

- `npm run test:backend` 和 `npm run test:coverage` 全部通过。
- **导出结果逐字节不变。** 改动前后各用 e2e-vault 里的几篇笔记（含表格、脚注、任务列表、删除线、自动链接、frontmatter 的那几篇）调一次 `POST /api/export/html`，两次输出的 HTML 要逐字节相同。这里比的是后端产出的结构那一层；公式在渲染进程里替换（ADR-0003），不受这次改动影响。
- ADR-0003 提到「`flexmark-all` 0.64.8 的全部扩展里没有任何数学扩展」，这是当时做决定的依据，依然成立，ADR 不用改。
- `npm run test:packaged` 的导出测试通过。
- 记录 `backend.jar` 改动前后的大小（预计 46MB → 26MB 左右），以及 `perf:measure` 改动前后的数字。

## Comments
