# V105-05: 后端改成普通 classpath 布局发布，构建时生成应用类缓存

Status: ready-for-agent
Type: Change
Commit prefix: `Change V105-05:`
Spec section: 实验：方案依据、待在实现中确认（见 ../spec.md）
Blocked by: 03, 04

## 背景

这是 1.0.5 收益最大的一张票。实测：后端改成普通 classpath，再加上应用类缓存（AppCDS）和 V105-04 的参数之后，打出端口从 3.5 秒降到 **1.1 秒**，内存从 158MB 降到 **99MB**。5000 篇的工作区下内存从 262MB 降到 137MB。

应用类缓存把 Spring、Tomcat、Jackson 以及应用自身的类预先解析、校验好，存成一个文件，JVM 启动时直接映射进内存。由于是映射文件，这部分内存算共享页，不计入专用工作集，所以内存也跟着降了。

它有两个前提，现在的发布方式一个都不满足：

1. **不能用 `-jar` 胖 jar。** Spring Boot 的嵌套 jar 由它自己的类加载器（`JarLauncher`）加载，类缓存覆盖不到。应用类和依赖必须是普通 classpath 上的普通 jar。
2. **必须有基础类缓存。** 这一条由 V105-04 解决。

## 实验里已核实的事实

- 用相对 classpath（`app.jar;lib/*`，工作目录是后端目录）生成的缓存，连同 JRE 一起搬到带空格和中文的路径（`…\安装 目录\resources\…`）下照样命中。
- **jar 的修改时间必须和生成缓存时一致。** 复制时不保留修改时间的话，JVM 报 `A jar file is not the one used while building the shared archive file: app.jar` / `app.jar timestamp has changed`，然后不用缓存、按普通方式启动，不报错也不退出。所以最坏情况只是没提速，不会坏。
- 训练运行时 `-XX:ArchiveClassesAtExit` 要等 JVM **正常退出**才会写出缓存。Electron 结束后端用的是 `process.kill`，在 Windows 上就是 `TerminateProcess`，不会触发写出。实验里的做法是：把 `PARENT_PID` 设成一个几秒后就结束的进程，`ParentProcessMonitor` 发现父进程没了，就调用 `System.exit(0)`。
- 训练时会打印一批 `Preload Warning: Verification failed for …`（Reactor、JDBC、Redis 等自动配置类，它们的依赖不在 classpath 上），这是正常的。

## 改动

**后端布局。** `resources/backend.jar` 改成 `resources/backend/` 目录：

```
resources/backend/
  app.jar        应用自己的类（原来的 BOOT-INF/classes）
  lib/*.jar      依赖
  app.jsa        应用类缓存
```

产出这个布局有两种做法，实现时选一种：(a) Maven 侧用 `maven-dependency-plugin` 的 `copy-dependencies` 输出 `lib/`，再打一个普通 jar，manifest 里写 `Main-Class` 和指向 `lib/` 的相对 `Class-Path`，这样可以直接 `java -jar app.jar`；(b) 继续打胖 jar，由 `scripts/copy-backend-jar.js` 解压、重新打包成上面的布局。推荐 (a)：启动命令最简单，`mvn spring-boot:run`（开发模式）不受影响。注意：实验里用的是 `-cp "app.jar;lib/*"`，`-jar` 加 manifest `Class-Path` 这种方式没测过。选 (a) 的话，先确认缓存照样命中、搬到别的路径后也命中，再往下做。不管选哪种，`<finalName>backend</finalName>` 那条「产物名与版本号解耦」的约定（V103-05）都要保留。

**训练运行。** 放在 `prepare:resources` 里，排在 `prepare-jre` 之后、`test:packaged` 之前：

- 用打包的 JRE、V105-04 的那组参数（从同一个模块取）加上 `-XX:ArchiveClassesAtExit=app.jsa`，工作目录设成 `resources/backend`。
- 工作区用 `test/e2e-vault` 复制到临时目录的副本，不能写进 `test/`。
- 把渲染进程启动时会调的接口都走一遍：健康检查、工作区、文件树、打开每种编码的笔记、搜索、保存、导出。这些代码路径上的类才会进缓存。
- 走完之后让后端正常退出。可以沿用 `PARENT_PID` 的办法，也可以加一个只在训练时启用的退出方式。不要为此往正式版里加一个能被外部调用的退出接口。
- 每次 `prepare:resources` 都重新生成。JDK、Spring Boot 或任何依赖一升级，缓存就自动跟着更新，不需要人记着。

**启动。** `electron/backendLaunch.js`（V105-04 新增的模块）：

- 参数加上 `-XX:SharedArchiveFile=app.jsa`。
- spawn 的工作目录设成 `resources/backend`，路径要和训练时一致。
- 保持默认的 `-Xshare:auto`，缓存用不了就退回普通启动。

**打包和校验。**

- `package.json` 的 `extraResources`：`resources/backend.jar` 改成 `resources/backend/`。
- `scripts/verify-dist-resources.js` 检查 `app.jar`、`lib/`、`app.jsa` 都在，并且 `lib/` 里没有 V105-03 去掉的那些 jar。
- `scripts/packaged-backend.test.js` 改用新布局，并新增一个用例：带 `-Xlog:cds` 启动后端，断言日志里没有 `Unable to use shared archive`，也没有 `top archive failed`。这条是防回退的关键：以后谁把后端改回 `-jar` 胖 jar，或者让 jar 的修改时间对不上，这个测试就会失败。

**安装包是否保留修改时间。** 这一点只能靠真实安装来验证：

- `npm run dist:setup` 之后，静默安装到临时目录：`/S /currentuser /D=<临时目录>`，不需要提权。
- 用安装出来的 JRE 和后端目录带 `-Xlog:cds` 启动一次，看缓存是否命中。然后卸载。
- **安装前先问用户。** 静默安装会写入 HKCU 的卸载项和 `.md` 文件关联（细节见 memory 里的打包版测试经验）。
- 如果修改时间**没有**保留，改为首次启动时在 `userData` 里生成缓存：后端用 `-XX:+AutoCreateSharedArchive -XX:SharedArchiveFile=<userData>/app.jsa`（JDK 19+ 支持），同时把退出改成正常退出，否则缓存写不出来。这条路的代价是安装或升级后的第一次启动没有提速。到这一步时回来跟用户确认。

**文档。**

- CLAUDE.md：更新 `test:packaged` 那一行（它现在写的是需要 `resources/backend.jar`）。在「Critical Safety Rules」或单独一节里写清楚：后端必须以普通 classpath 加类缓存的方式启动，不要改回 `-jar` 胖 jar；改了也不会报错，只是启动会悄悄慢 2 秒以上，`test:packaged` 的类缓存用例会拦住。注意 `CLAUDE.md` 被 `.gitignore` 忽略（V105-01 时发现），这些说明只存在本地；防回退靠的是那个测试用例，不是这段文字。
- memory 里的打包版测试经验提到「grep the jar's `BOOT-INF/classes`」来确认构建是新的，布局改了以后要同步更新。

## 验收

- `npm run dist:verify -- --expect-version <当前版本>`、`npm run dist:setup`（包括其中的 `verify:release`）通过。
- `test:packaged` 的类缓存命中用例通过；把 `app.jar` 的修改时间改掉以后，这个用例确实失败（证明它能拦住回退）。
- 安装版的类缓存命中（经用户同意静默安装后确认），或者按上面的备选方案处理。
- **`perf:measure`：启动时间 ≤ 2.0 秒，内存占用 ≤ 250MB。**（内存目标原为 220MB，V105-01 按完整口径重测基线后改为 250MB，见 spec「目标」。）02–05 都完成后的最终数字写进 spec。如果内存仍超过 250MB，按 spec 开前端按需加载的工单。
- 记录安装包大小的变化（预计比 1.0.4 的 169.8MB 小 10MB 左右）。

## Comments
