# V105-04: 打包 JRE 时生成基础类缓存，后端启动加精简 JVM 参数

Status: ready-for-agent
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
