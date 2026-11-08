# V105-05: 后端改成普通 classpath 布局发布，构建时生成应用类缓存

Status: resolved
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

### 完成情况（2026-11-08）

**结果：两项目标都达到了。** `perf-measure.js --no-record`（`npm run dist:dir` 之后，暖缓存 1 轮 + 3 轮取中位数，机器上没有别的构建或会话在跑）：

| | 主窗口创建 | 启动时间 | 内存占用 | Java 后端 | JVM 启动到 Spring 就绪 |
| --- | --- | --- | --- | --- | --- |
| 1.0.4 基线 | 约 4.1 秒 | 4.76 秒 | 305.6MB | 158.5MB | 3.5 秒 |
| main，02+03+04（`170b2f0`） | 0.24 秒 | 3.28 秒 | 242.2MB | 102.9MB | 2.60 秒 |
| **本票** | **0.25 秒** | **1.84 秒（−61.3%）** | **243.0MB（−20.5%）** | **99.3MB** | **1.25 秒**（其中 Spring 0.98 秒） |
| 目标 | | ≤ 2.0 秒 | ≤ 250MB | | |

三轮是 1.83、1.85、1.84 秒，暖缓存那一轮 2.42 秒。各进程（中位数那一轮）：Java 后端 99.3MB，渲染进程 65.9MB，GPU 进程 42.8MB，主进程 27.1MB，网络服务 7.1MB，`java.exe` 的 conhost 0.8MB。内存和 04 之后基本一样，这在意料之中：spec「实验」一节已经说明内存的收益几乎都来自 04 的精简参数。5000 篇工作区（`--big-vault`）这次没有测。

**安装包**：`release/NextTypora-1.0.4-win-x64.exe` 160,829,172 字节，1.0.4 是 169,841,873 字节，少了 9,012,701 字节（−5.3%）。其中 `app.jsa` 44,236,800 字节，在 7z 里压到 8,640,332 字节；去掉的 `classes_nocoops.jsa` 压缩后约 2.3MB；其余是 V105-03 去掉的那些 jar。

#### 改动

- **布局**按工单的 (a)：`backend/pom.xml` 用 `spring-boot.repackage.skip` 不再打胖 jar，`maven-jar-plugin` 写 `Main-Class` 和指向 `lib/` 的相对 `Class-Path`，`maven-dependency-plugin` 把运行时依赖复制到 `target/lib/`。`<finalName>backend</finalName>` 保留，产物仍是 `target/backend.jar`（现在是只含应用类的普通 jar）。`mvn spring-boot:run` 实测照常：健康检查、文件树、Big5 笔记、导出都正常，父进程结束后正常退出。
  - `lib/` 是 67 个 jar，胖 jar 里是 62 个：多了 6 个空的 starter jar（`spring-boot-starter-*`，各约 5KB，Spring Boot 打胖 jar 时会去掉它们），少了用不到的 `spring-boot-jarmode-layertools`。starter 留着没有影响。
- **`scripts/copy-backend-jar.js`**：清空 `resources/backend/`（连带旧的 `app.jsa`、以及 1.0.4 布局留下的 `resources/backend.jar`），复制 `app.jar`，并**只按 manifest 的 `Class-Path`** 复制 `lib/`：`copy-dependencies` 不会删 `target/lib` 里早已不用的旧 jar。`Main-Class` 不是应用类（例如又打成了胖 jar）时直接失败。读 manifest 用新加的 `scripts/jarManifest.js`（这一步在 `prepare-jre` 之前，不能依赖 JDK 的 `jar` 工具）。
- **`scripts/train-backend-cds.js`**（新增，`prepare:resources` 里排在 `prepare-jre` 之后、`test:packaged` 之前，每次都重新生成）：用打包的 JRE 和 `buildTrainingLaunch` 启动后端（正式参数加 `-XX:ArchiveClassesAtExit=app.jsa`，工作目录 `resources/backend`），工作区是 `test/e2e-vault`（和 `e2e-vault-2`）复制到临时目录的副本。走一遍：健康检查、工作区、文件树、等启动索引完成、打开每篇笔记（五种编码、空文件、frontmatter）、读图片、不存在的笔记（404）、几种搜索、新建目录和笔记、保存、冲突（409）、强制保存、按原编码保存 GBK/Big5/UTF-16、导出三篇、重命名、移动、刷新、旧备份扫描、切换工作区再切回。每个请求都检查状态码。删除没有放进去：它走 Electron 的 `shell.trashItem`，会进系统回收站。走完后结束 `PARENT_PID` 指向的辅助进程，`ParentProcessMonitor` 调 `System.exit(0)`，缓存写出（约 20 秒，打印 8 条正常的 `Preload Warning`）。正式版没有加任何退出接口。
- **`electron/backendLaunch.js`**：`buildBackendArgs(jarPath)` 换成 `buildBackendLaunch(resourcesDir, { extraJvmArgs })`，返回 `{ args, cwd, jarPath }`；`args` 是 `[...BACKEND_JVM_ARGS, '-XX:SharedArchiveFile=app.jsa', ...extraJvmArgs, '-jar', 'app.jar']`，`cwd` 是 `resources/backend`，参数里不带任何绝对路径。`buildTrainingLaunch` 同参数、同目录，只把读缓存换成写缓存。`main.js`、训练和 `test:packaged` 都从这里取。默认的 `-Xshare:auto` 不变。
- **`classes_nocoops.jsa` 删掉了**（`prepare-jre.js`，jlink 和整个复制 JDK 两条路都删）：它只在关掉压缩指针（堆上限 ≥ 32GB）时用，后端固定 `-Xmx512m`，压缩指针永远开着。JRE 从 84MB 降到 72MB。代价是 JRE 和堆上限绑在一起，代码注释里写了。
- **`verify-dist-resources.js`**：检查 `app.jar`、`lib/`、`app.jsa`、`app.jsa.json` 都在；`app.jar` 的 `Main-Class` 是应用类；`lib/` 和 `Class-Path` 一一对应；`lib/` 里没有 V105-03 去掉的 jar（flexmark-all、icu4j、pdfbox、fontbox、xmpbox、openhtmltopdf、graphics2d、jsoup、commons-logging 等）；`app.jsa.json` 恰好覆盖 `app.jar` 和全部 `lib/*.jar`。造过反例（往 `lib/` 放一个 `icu4j-72.1.jar`、拿走 `app.jsa`）确认会失败。
- `package.json`：`extraResources` 改成 `resources/backend` → `backend`；`prepare:resources` 加训练这一步。`.gitignore` 加 `resources/backend/`。`perf-measure.js` 的构建输入加上两个新脚本。

#### 和工单不一样的地方：安装包不保存修改时间

**离线查证，再用真实安装确认：安装包里根本不存修改时间。** electron-builder 打 NSIS 用的 7z 时写死了 `-mtm=off`（`app-builder-lib/out/targets/archive.js`），`7za l -slt` 看 1.0.4 和本票的安装包，`backend.jar` / `app.jar` / `app.jsa` 的 `Modified` 都是空的。装出来以后 68 个 jar 的修改时间全是安装时刻，直接用 java 启动就是 `app.jar timestamp has changed` / `Unable to use shared archive`。

按工单「到这一步时回来跟用户确认」，2026-11-08 问了用户，用户选的是**由 Electron 在启动后端前把修改时间改回去**，而不是工单的备选方案（首次启动时在 `userData` 里生成缓存）：

- 新增 `electron/backendArchive.js`。训练之后 `recordArchiveJars` 把每个 jar 的大小、修改时间、SHA-256 记进 `resources/backend/app.jsa.json`；`main.js` 每次 spawn 后端之前调 `restoreJarTimes`：修改时间对不上、但大小和 SHA-256 都对得上的 jar，改回记录里的修改时间。任何一个 jar 缺失、大小或哈希不对，就一个都不改，交给 JVM 退回普通启动。从不抛异常，结果只记日志。
- 代价：安装或升级后的第一次启动要把 68 个 jar（26MB）算一遍哈希，约 0.13 秒；以后每次只是 68 次 stat，2–4 毫秒。它是同步的（`main.test.js` 的假后端靠同步时序），在 `whenReady` 里排在主窗口创建之前，所以第一次启动主窗口会晚这 0.13 秒。per-user 安装不提权，安装目录总是可写；真写不了时只是没提速。
- 好处：安装后第一次启动就命中，后端退出方式不用改；`npm run dist` 的 ZIP 包（ZIP 只存 2 秒精度的 DOS 时间）同样由它修正（ZIP 这条没有实测）。
- **实现时发现：Windows 上的 HotSpot 比修改时间时精确到秒以下。** 先按整秒记录、改回整秒，`test:packaged` 的安装模拟用例照样不命中。在副本上分别改回整秒（向下取整、四舍五入）和原来的毫秒值，三种都是 `timestamp has changed`；而 Node 只能用 double 秒数设置修改时间，表示不了 100 纳秒精度的原值。所以训练之前先用 `truncateJarTimes` 把每个 jar 的修改时间截成整秒，JVM 记下的和之后改回去的就是同一个精确值；截成整秒之后三种改法都命中。`recordArchiveJars` 遇到不是整秒的修改时间直接报错，免得以后有人去掉这一步。另外试过把 jar 的修改时间设成 1970-01-01（指望时间戳为 0 时 JVM 不比较），JDK 21 照样报 `timestamp has changed`，不可行。

#### `-jar app.jar` 加 manifest `Class-Path` 的验证（动手之前做的）

实验里只验证过 `-cp "app.jar;lib/*"`。先用当时的胖 jar 拆出同样的布局（manifest 按 `classpath.idx` 的顺序写 `Class-Path`）试了 `-jar app.jar`：原地命中，5975 个类来自应用类缓存；连同 JRE 复制到带空格和中文的路径（`…\normal-安装 目录-kept\resources\`，保留修改时间）照样命中；复制时不保留修改时间则 `app.jar timestamp has changed`、退回普通启动。打出端口：普通 classpath 不带应用类缓存 1.67 秒，带上 1.00 秒，修改时间不对时 1.68 秒。确认之后才往下做。

#### 红 → 绿

- `npm run test:electron`：先写测试。**red**：47 个里 14 个失败——`backendArchive.test.js` 整个文件 `Cannot find module './backendArchive'`，`backendLaunch.test.js` 的 `buildBackendLaunch is not a function`，`main.test.js` 里按新布局（`resources/backend/app.jar`）启动的用例全部因为 `main.js` 还在找 `resources/backend.jar` 而失败，包括新加的「spawn 用 backendLaunch 的参数和工作目录」「spawn 之前已经改回修改时间」两条。实现后 **green**，最终 54/54。
- `npm run test:packaged`：**red**：`Cannot find module '../electron/backendArchive'`。实现后第一次跑，类缓存命中用例通过，**安装模拟用例失败**（`app.jar timestamp has changed`），这就是上面「精确到秒以下」的发现；加上截成整秒以后 **green**，16/16。
- **证明类缓存用例能拦住回退**：把 `resources/backend/app.jar` 的修改时间改成当前时间，`test:packaged` 15 过 1 败，败的正是 `the backend starts on the app class archive (AppCDS hit)`，报 `app.jar timestamp has changed.`；改回原值（1794126469 秒）以后 16/16。安装模拟用例里本身也有一个反例：修改时间全新的副本在 `restoreJarTimes` 之前必须不命中。
- 类缓存命中的判据：输出里没有 `Unable to use shared archive`、`top archive failed`、`not the one used while building`、`timestamp has changed`，来自应用类缓存的类超过 1000 个（实际约 6000），其中有 `com.nexttyproa.` 和 `org.springframework.` 的类。

#### 回归

- `npm run dist:verify -- --expect-version 1.0.4`：退出码 0。Electron 54/54，后端 138/138，前端 243/243（23 个文件），`npm run build`，`prepare:resources`（jlink 输出 `Created CDS archive successfully`，训练生成 42.2MB 的 `app.jsa`、记录 68 个 jar，`test:packaged` 16/16），`Distribution resource verification passed.`
- `npm run dist:setup`：退出码 0，其中 `test:packaged` 16/16，`verify:release` 通过（`Release artifact verification passed: NextTypora 1.0.4 by NextTypora.`）。
- `npm run dist:dir` 之后：`release/win-unpacked` 里 68 个 jar 的修改时间和记录完全一致（electron-builder 的 dir 复制保留修改时间），`app.asar` 里有 `backendLaunch.js` 和 `backendArchive.js`，没有 `backend.jar` 和 `classes_nocoops.jsa`。`NEXTTYPROA_RESOURCES_DIR=release/win-unpacked/resources npm run test:packaged` 16/16。
- 测前测后真实 `%APPDATA%\NextTyproa\settings.json` 的 SHA-256 都是 `5604701E…21BFE6`。

#### 安装版（经用户同意的静默安装）

用户机器上装着正式的 NextTypora 1.0.3（per-user，`D:\software\nextTypora`）。同一个 appId 的安装包会把它当旧版本先静默卸载（`installSection.nsh` 的 `uninstallOldVersion`），测完再卸载测试版，1.0.3 就没了。另外这个版本的 electron-builder 在 `CHECK_APP_RUNNING` 里会 `taskkill /f` 当前用户**所有**叫 `NextTypora.exe` 的进程，不管装在哪里，静默模式也一样。回去问了用户，用户选：**用临时 appId 的测试安装包**。做法：同一份 resources、同样的 7z 打包，只改 `appId`（`com.nexttyproa.cdstest`）和产品名（exe 叫 `NextTyporaCdsTest.exe`），去掉文件关联和快捷方式，`nsis.include` 换成只有一个空 `customCheckAppRunning` 的文件，输出到 scratchpad，不动 `release/`。所以这次**没有**验证正式安装包的文件关联（本票没有改它）。

- 静默安装 `/S /currentuser /D=<…>\安装 目录`：`/D=` 在空格处被截断（测试脚本传参的问题），实际装到了 `…\testinstaller\install\安装`，路径有中文、没有空格。带空格的路径由前面的实验和 `test:packaged` 的安装模拟（`安装 目录`）覆盖。
- 装完：68 个 jar 的修改时间**全部**和记录不同（`app.jar` 是安装时刻 `08:58:16Z`，记录是 `08:27:49Z`）；直接用 java 启动：`app.jar timestamp has changed`、`Unable to use shared archive`。
- 用新的 `--user-data-dir` 启动安装出来的应用，`JAVA_TOOL_OPTIONS=-Xlog:cds,class+load:file=cds-check.log` 让应用自己 spawn 的后端记日志：没有任何类缓存失败，6283 个类来自 `app.jsa`，只有 6 个来自 jar；后端日志 `Started NextTyproaApplication in 1.134 seconds (process running for 1.456)`（带着类加载日志，且是装完第一次启动）。之后 68 个 jar 的修改时间和记录完全一致，再直接用 java 启动也命中。
- 卸载（`/S /currentuser`）之后：安装目录空了（留下空目录，已删）；测试版的卸载项和 `HKCU\Software\06e05ace-…` 都没了；卸载项列表和 `.md`、`.markdown`、`NextTypora.md` 三个键的 `reg export` 与安装前逐字节相同；1.0.3 还在；真实 `settings.json` 的 SHA-256 不变；没有残留进程和快捷方式。

#### 没做、留给别处的

- `CLAUDE.md`：`test:packaged` 那一行和「后端必须以普通 classpath 加类缓存启动」的说明只改在本地（被 `.gitignore` 忽略）。真正的防回退是 `test:packaged` 的类缓存用例和 `verify-dist-resources.js` 的 `Main-Class` 检查。memory 里打包版测试经验的那句 `BOOT-INF/classes` 也已更新。
- **`release/NextTypora-1.0.4-win-x64.exe` 已经被 `dist:setup` 覆盖成本票的构建**（版本号仍是 1.0.4）。原来那个 1.0.4 安装包不在了；需要的话从 `c244a95` 重新打。
- `perf:measure --big-vault` 没测。
