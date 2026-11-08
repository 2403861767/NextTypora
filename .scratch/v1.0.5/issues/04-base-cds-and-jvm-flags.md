# V105-04: 打包 JRE 时生成基础类缓存，后端启动加精简 JVM 参数

Status: resolved
Type: Change
Commit prefix: `Change V105-04:`
Spec section: 实验：方案依据（见 ../spec.md）
Blocked by: 01

## 背景

后端现在的启动方式是 `java -jar backend.jar`，不带任何 JVM 参数（`electron/main.js` 的 `startBackend`）。在 16GB 内存的机器上，JVM 默认用 G1，堆上限是物理内存的 1/4（4GB），初始堆是 1/64（256MB），C1 和 C2 两级编译都开着。对一个只服务本机一个窗口的小后端来说，这些默认值都太大了。

另外，`scripts/prepare-jre.js` 用 jlink 精简出来的 JRE 里没有基础类缓存（`bin/server/classes.jsa`）：jlink 默认不生成，JDK 自带的那份也没有复制过来。所以 JVM 每次启动都要从头加载、校验 JDK 自身的类。V105-05 的应用类缓存也必须建立在基础类缓存之上，否则 `-XX:ArchiveClassesAtExit` 直接报 unsupported。

实测（只测后端，从启动到打出端口）：1.0.4 现状 3.5 秒；加精简参数 2.6 秒；再加基础类缓存 2.5 秒。基础类缓存这一项本身省得不多，主要是给 V105-05 打基础。

## 决定（2026-11-08 grilling，参数根据实验确定）

后端启动参数：

| 参数 | 原因 |
| --- | --- |
| `-XX:+UseSerialGC` | 单线程回收，按实际使用量申请内存。默认的 G1 配 4GB 上限时，堆会涨得比实际需要大得多：小工作区下 1.0.4 比调优后多 59MB，5000 篇时多到 125MB，多出来的差距主要来自堆。（这一点没有单独隔离测量，是对比两组数字推断的） |
| `-XX:TieredStopAtLevel=1` | 只用 C1。启动快 0.45 秒、内存少 12MB，5000 篇时搜索只慢 3ms |
| `-Xms16m` | 初始堆从 256MB 降到 16MB，按需增长 |
| `-Xmx512m` | 设 128MB 还是 512MB，空闲内存没有区别。取 512MB，给大工作区的索引留出空间 |
| `-XX:ReservedCodeCacheSize=48m` | 只用 C1 时代码缓存用不了那么多 |

实验里还用过 `-Xss512k`，这里**不采用**：线程栈是用到才分配的，改小省不了多少内存，反而可能让嵌套很深的 Markdown 在解析时栈溢出。

## 改动

- `scripts/prepare-jre.js`：jlink 的参数里加上 `--generate-cds-archive`（JDK 21 的 jlink 支持，已核实）。不用 jlink、整个复制 JDK 的那条路径（`copyRuntime`）会把 JDK 自带的 `classes.jsa` 一起复制过来，核实一下确实如此。
- 把后端的启动参数抽成一个模块（例如 `electron/backendLaunch.js`），导出 `buildBackendArgs(...)`。`electron/main.js` 和 `scripts/packaged-backend.test.js` 都从这里取参数，避免「测试测的是一套参数、实际发布的是另一套」。这个模块要能被 electron-builder 打进包里（`files` 里的 `electron/**/*` 已经覆盖）。
- `scripts/verify-dist-resources.js`：检查 `resources/jre/bin/server/classes.jsa` 是否存在。
- `npm run test:packaged`：新增一个用例，用打包的 JRE 跑 `java -Xshare:on -version`。基础类缓存不存在或用不了时，`-Xshare:on` 会直接报错退出。这条检查只放在测试里；实际启动后端时**不能**用 `-Xshare:on`，要保持默认的 `auto`，缓存用不了就退回普通启动。

## 验收

- `npm run test:electron`、`npm run test:packaged`、`npm run dist:verify -- --expect-version <当前版本>` 通过。
- `perf:measure` 报改动前后的数字，并补上 spec「实验」表里两行缺的专用工作集。
- 用 5000 篇的工作区（`npm run perf:measure -- --big-vault`）确认搜索和打开笔记都正常，后端内存明显低于 1.0.4 的 262MB。
- 后端日志里没有 `OutOfMemoryError`。可以在测试里专门造一个大工作区跑一遍索引来确认。

## Comments

### 完成情况（2026-11-08）

**`electron/main.js` 的接入留到合并时。** V105-02 正在另一个会话里重写 `main.js` 的启动流程，本票没有改这个文件。合并时在 `startBackend` 里加 `const { buildBackendArgs } = require('./backendLaunch')`，把 `spawn(javaBin, ['-jar', jarPath], …)` 换成 `spawn(javaBin, buildBackendArgs(jarPath), …)`。接入之前，打包版启动后端时仍然不带参数；基础类缓存已经在 JRE 里，默认的 `-Xshare:auto` 会用上它。`test:packaged` 测的已经是新参数。

改动：

- `electron/backendLaunch.js`（新增）：导出 `BACKEND_JVM_ARGS`（冻结数组）和 `buildBackendArgs(jarPath)`，返回 `[...BACKEND_JVM_ARGS, '-jar', jarPath]`。参数按「决定」表：`-XX:+UseSerialGC -XX:TieredStopAtLevel=1 -Xms16m -Xmx512m -XX:ReservedCodeCacheSize=48m`，不加 `-Xss512k`，也不加任何 `-Xshare`。`jarPath` 不是非空字符串时抛 `TypeError`。electron-builder 已把它打进 `app.asar`：`asar list` 里有 `\electron\backendLaunch.js`，测试文件被 `!electron/**/*.test.js` 排除。
- `scripts/prepare-jre.js`：jlink 加 `--generate-cds-archive`，生成 `bin/server/classes.jsa` 和 `classes_nocoops.jsa`，各 12.5MB，JRE 从 60MB 涨到 84MB。jlink 把这两个文件标成只读，JDK 自带的那几份却是可写的，所以生成后照 JDK 的样子去掉只读位，免得覆盖安装、卸载时碰上只读文件。这个风险没有用安装包实际验证过（要真的安装一次），去掉只读位只是预防。JRE 里有只读 `.jsa` 时，`prepare-jre.js` 的 `rmSync` 照样删得掉（重跑过一次）；`electron-builder --win dir` 在带只读 `.jsa` 的 `release/win-unpacked` 上覆盖打包也成功了。
- 不走 jlink 的 `copyRuntime` 路径，已核实会带上 JDK 自带的 `classes.jsa`。核实方法：在 scratchpad 里拼一个没有 `jlink.exe` 的「JDK」（`bin` 复制过来、删掉 `jlink.exe`，`conf`、`legal`、`lib` 用目录联接指向真 JDK），把 `JAVA_HOME` 指过去跑 `prepare-jre.js`。脚本走了 `jlink unavailable, copying JDK runtime` 分支，`resources/jre/bin/server/classes.jsa` 和 JDK 的那份逐字节相同（`cmp`），`java -Xshare:on -version` 退出 0（`mixed mode, sharing`），`verify-dist-resources.js` 通过，`test:packaged` 14/14。核实完用 jlink 重建。
- `scripts/verify-dist-resources.js`：检查 `resources/jre/bin/server/classes.jsa` 是否存在。
- `scripts/packaged-backend.test.js`：后端改用 `buildBackendArgs(jarPath)` 启动。新增两条用例：`java -Xshare:on -version`；带上 `BACKEND_JVM_ARGS` 再跑一次 `java … -Xshare:on -version`。第二条确认基础类缓存在 SerialGC、只用 C1 这些参数下也能映射；映射不了的话，正式启动用的 `auto` 会悄悄退回普通启动，没有任何报错。两条都断言退出码是 0、输出里有 `sharing`。正式启动不用 `-Xshare:on`。

红 → 绿：

- `npm run test:electron`：先写 `electron/backendLaunch.test.js`（5 条）。**red**：`Cannot find module './backendLaunch'`，这个文件整体失败（31 个测试里 1 个失败）。加上模块后 **green**，5/5。
- `npm run test:packaged`，此时模块已经加上、`prepare-jre.js` 还没改，JRE 是按旧做法打的。**red**：12 条通过、2 条失败，失败的正是两条新用例：`[error][cds] Unable to map shared spaces`、`Unable to use shared archive`，退出码 1。其余 12 条在新参数起的后端上全部通过。`prepare-jre.js` 加上 `--generate-cds-archive`、重建 JRE 以后 **green**，14/14。
- `verify-dist-resources.js`：旧 JRE 上 **red**，只报 `Missing base CDS archive of the bundled Java runtime: …\resources\jre\bin\server\classes.jsa`；新 JRE 上 **green**，`Distribution resource verification passed.`
- 打包版：去掉只读位以后重新 `electron-builder --win dir`，用 `NEXTTYPROA_RESOURCES_DIR=release/win-unpacked/resources npm run test:packaged` 测打包出来的资源，14/14。

回归：`npm run dist:verify -- --expect-version 1.0.4` 通过（退出码 0）。`test:electron` 35/35，后端 138/138，前端 235/235（23 个文件），`npm run build`，`prepare:resources`（jlink 输出 `Created CDS archive successfully`）里的 `test:packaged` 14/14，最后 `Distribution resource verification passed.`

参考测量（**不是正式数字**）：用打包的 JRE 直接起后端（同一个 `backend.jar`，`test/e2e-vault` 的副本放在仓库外），从 spawn 计到输出 `NEXTTYPROA_PORT=`；打出端口后空闲 8 秒，读 `java.exe` 的 `Win32_PerfFormattedData_PerfProc_Process.WorkingSetPrivate`。四种启动方式每轮轮换顺序，先空跑一轮，再测 5 轮取中位数。测量时另外两个会话正在编译、跑测试（开始时 CPU 占用 77%），所以只能当参考。正式数字由父会话事后用 `perf:measure` 串行测量，本票没有跑 `perf:measure`。

| 启动方式 | 打出端口 | 专用工作集 |
| --- | --- | --- |
| 1.0.4 现状（旧 JRE，`-jar`，默认参数） | 3.69 秒 | 151.8MB |
| + 精简参数（旧 JRE） | 2.56 秒 | 100.9MB |
| 只加基础类缓存（新 JRE，默认参数） | 3.37 秒 | 153.9MB |
| 基础类缓存 + 精简参数（本票发布的组合） | 2.42 秒 | 100.0MB |

时间和 spec「实验」表对得上（3.5 → 2.6 → 2.5 秒）。表里缺专用工作集的两行，这里的参考值是 100.9MB 和 100.0MB。也就是说，精简参数单独就让后端少了约 51MB，基础类缓存本身几乎不影响内存。spec 原先把 99MB 记在 V105-05 做完以后。

5000 篇、39.4MB 的工作区（形状同 `perf:measure --big-vault`：50 个目录 × 100 篇 × 8KB，再加 `ascii-notes.md`），1.0.4 现状和本票组合交替各跑 2 轮，本票组合修好树的计数后又补跑 1 轮：

| | 1.0.4 现状 | 本票组合 |
| --- | --- | --- |
| 打出端口 | 3.26、3.07 秒 | 2.24、2.26、2.33 秒 |
| 从启动到索引完成 | 60.8¹、5.9 秒 | 5.1、5.2、5.7 秒 |
| 搜索平均（5 个词各 10 次） | 25.2、24.4ms | 28.4、20.8、24.7ms |
| 打开笔记平均（20 篇） | 4.2、3.9ms | 3.5、4.0、4.2ms |
| 空闲 8 秒后的专用工作集 | 265.5、292.2MB | 170.9、171.7、170.9MB |

¹ 第一轮紧跟在生成工作区之后，可能赶上了系统扫描新文件，不计。

每一轮都索引了 5001 篇、失败 0 篇，五个搜索词的命中数两种启动方式完全一样（`uniqtoken37x42` 只命中 `目录37/笔记42.md`），20 篇笔记打开后内容正确，文件树里是 5001 个文件（只在补跑那轮数过，前四轮的计数有 bug）。后端日志和 stdout/stderr 里都没有 `OutOfMemoryError`，日志里没有任何 `ERROR` 或 `Exception` 行。后端内存从 1.0.4 的约 266–292MB 降到约 171MB，明显低于 262MB。

没做、留给别处的：

- `main.js` 接入：合并时做，见上。
- `perf:measure` 的改动前后数字、spec「实验」表的正式补数：父会话串行测量。
- 观察到但没动：`classes_nocoops.jsa` 只在关掉压缩指针时（堆 ≥ 32GB）才用得上，`-Xmx512m` 下永远用不到；删掉能省 12.5MB 磁盘空间、安装包约 2.3MB。删了以后 JRE 和堆上限就绑在一起了，工单里也没说要删，交给 V105-05 决定。
