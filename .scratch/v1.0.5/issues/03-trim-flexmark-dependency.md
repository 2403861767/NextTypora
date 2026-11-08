# V105-03: 把 flexmark-all 换成实际用到的模块

Status: resolved
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

### 完成情况（2026-11-08）

改动只有 `backend/pom.xml`：`flexmark-all` 换成工单列的 7 个模块（`flexmark` 和 6 个扩展），版本统一用新加的 `flexmark.version` 属性（0.64.8）。一次编译通过，没有缺类，不用补模块；`backend/src` 没改。

`backend.jar` 大小（`mvn -DskipTests package` 的产物，`resources/backend.jar` 和它逐字节相同）：

- 改动前 47,571,231 字节（45.4MiB），`BOOT-INF/lib` 里 102 个 jar。
- 改动后 26,037,863 字节（24.8MiB），62 个 jar。少了 21,533,368 字节。
- 去掉的 40 个 jar 合计 21,526,687 字节：`flexmark-all` 本身，24 个没用到的扩展（emoji、toc、wikilink、admonition 等），4 个转换器（`flexmark-pdf-converter`、`flexmark-html2md-converter`、jira、youtrack）和 `flexmark-profile-pegdown`，`icu4j-72.1`（14.4MB），`pdfbox`、`fontbox`、`xmpbox`、`openhtmltopdf-*`（3 个）、`graphics2d`，以及 `jsoup-1.15.4` 和 `commons-logging-1.2`。没有新增 jar。
- 剩下的 flexmark 相关 jar：`flexmark`、6 个扩展、12 个 `flexmark-util*`，加上 autolink 扩展用的 `org.nibor.autolink:autolink-0.6.0`。

`jsoup`、`commons-logging`：去掉 `flexmark-all` 以后两个都不在了，不用另外处理。后端启动日志里那两条「please remove commons-logging.jar from classpath」随之消失。改动前后的启动日志，除时间戳、PID、路径外只差这两行。

导出逐字节比较：

- 把 `test/e2e-vault` 复制到仓库外（scratchpad），另加一篇只存在于副本里的 `v105-03-feature-coverage.md`：e2e-vault 里没有删除线，`读书笔记/frontmatter.md` 也不是以 `---` 开头的 YAML frontmatter，这篇补上了。它覆盖 YAML frontmatter（含 title）、对齐表格（单元格里有转义竖线、删除线、链接）、编号和命名脚注、重复引用和未定义的脚注、嵌套/有序/松散任务列表、删除线（含单波浪线和三波浪线）、裸 URL/`www.`/邮箱/括号里的 URL/句末 URL 的自动链接，以及 mermaid、图片、行内 HTML、引用块。
- 用 `java -jar backend.jar` 起后端（`SPRING_PROFILES_ACTIVE=embedded`、`SERVER_PORT=0`、随机 `AUTH_TOKEN`、`VAULT_PATH` 指向每次重新复制的副本），对副本里全部 19 篇 `.md` 依次调 `POST /api/export/html`，原样保存响应体（JSON，含 path、title、html）。
- 改动前用旧 jar 跑了两次，19 份响应逐字节相同，说明输出是确定的。改动后用新 jar 跑一次，和改动前比：**19/19 逐字节相同，差异为零**，状态码都是 200。
- ADR-0003 依然成立，没改：这次只是去掉了没用到的模块，留下的模块里也没有数学扩展。

回归（都在本 worktree 跑，退出码都是 0）：

- `npm run dist:verify -- --expect-version 1.0.4`：`test:electron` 30/30，`test:backend` 138/138，`test:frontend` 235/235（23 个文件），build，`prepare:resources`（其中 `test:packaged` 12/12，含「exports a UTF-8 note to HTML」），最后「Distribution resource verification passed.」。
- `npm run test:coverage`：138/138，「All coverage checks have been met.」；service 包行覆盖率 90.9%（1023/1125）。

**perf 数字待父会话串行测量。** 本票没有跑 `npm run perf:measure`：02、04 两个会话在同时编译、跑测试，这时测出来的计时不可信。按 spec 实验一节的判断，这次对内存影响不大（没用到的类本来就不会加载），主要是安装包和后端目录变小。

### perf 数字（父会话串行测量，2026-11-08）

三个分支都做完以后，在没有别的任务的机器上逐个测各自的打包版（本票的 worktree 里补跑了一次 `electron-builder --win dir`）。暖缓存 1 轮，再测 3 轮取中位数，结果没有写入 `results.json`。

| | 启动时间 | 内存占用 | Java 后端 |
| --- | --- | --- | --- |
| 1.0.4 基线 | 4.76 秒 | 305.6MB | 158.5MB |
| 本票分支（`4e5395c`） | 4.63 秒（−2.7%） | 297.7MB（−2.6%） | 152.9MB |

两项都在噪声范围内：这台机器上轮与轮之间常差 0.5 秒、20MB 左右，第 1 轮的内存 278.3MB 偏低，把中位数也拉低了。符合工单的预期：没用到的类本来就不会被加载，这次的收益主要是 `backend.jar` 少了 21.5MB。

已 cherry-pick 到 main（`ba90639`），合并后的整体数字见 V105-04 的 Comments 和 spec「进度」一节。
