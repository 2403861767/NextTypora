// 后端 java 进程怎么启动：参数和工作目录。electron/main.js、scripts/train-backend-cds.js（构建时生成
// 应用类缓存）和 scripts/packaged-backend.test.js 都从这里取，免得测试测的、训练用的和实际发布的
// 是三套参数。依据见 .scratch/v1.0.5/issues/04-base-cds-and-jvm-flags.md、
// 05-plain-classpath-and-appcds.md 和 .scratch/v1.0.5/spec.md 的「实验」一节。
//
// 后端是普通 classpath 布局（V105-05），不是 Spring Boot 胖 jar：
//   resources/backend/app.jar   应用自己的类，manifest 里有 Main-Class 和指向 lib/ 的相对 Class-Path
//   resources/backend/lib/*.jar 依赖
//   resources/backend/app.jsa   应用类缓存（AppCDS），构建时用同一组参数训练生成
// 胖 jar 的嵌套 jar 由 Spring Boot 自己的类加载器加载，类缓存覆盖不到。改回 `-jar backend.jar`
// 不会报错，只会让后端启动悄悄慢 0.7 秒左右；test:packaged 的类缓存用例会拦住。
//
// app.jar 和 app.jsa 都用相对路径、工作目录设成 resources/backend：类缓存记下的是生成时的 classpath，
// 训练时就是这样启动的，装到哪个目录（带空格、中文）都对得上。
//
// 刻意不加的：
// - -Xshare:on：类缓存用不了时 JVM 会拒绝启动。保持默认的 auto，缓存用不了就退回普通启动。
//   打包的 JRE 和 app.jsa 能不能用，由 test:packaged 单独检查。
// - -Xss512k：线程栈用到才分配，改小省不了多少内存，反而可能让嵌套很深的 Markdown 解析时栈溢出。
const path = require('path');

const BACKEND_DIR = 'backend';
const APP_JAR = 'app.jar';
const APP_ARCHIVE = 'app.jsa';

const BACKEND_JVM_ARGS = Object.freeze([
  // 单线程回收，按实际使用量申请内存；默认的 G1 配 4GB 上限时堆会涨得比需要的大得多
  '-XX:+UseSerialGC',
  // 只用 C1：启动快约 0.45 秒、内存少约 12MB，5000 篇时搜索只慢 3ms
  '-XX:TieredStopAtLevel=1',
  // 初始堆从默认的物理内存 1/64（16GB 机器上 256MB）降到 16MB，按需增长
  '-Xms16m',
  // 128MB 和 512MB 的空闲内存没有区别，取 512MB 给大工作区的索引留空间
  '-Xmx512m',
  // 只用 C1 时代码缓存用不了默认的 240MB
  '-XX:ReservedCodeCacheSize=48m',
]);

function launchIn(resourcesDir, archiveFlag, extraJvmArgs, caller) {
  if (typeof resourcesDir !== 'string' || resourcesDir === '') {
    throw new TypeError(`${caller}: expected the resources directory, got ${JSON.stringify(resourcesDir)}`);
  }
  const cwd = path.join(resourcesDir, BACKEND_DIR);
  return {
    // JVM 参数必须在 -jar 之前，否则会被当成传给应用的参数
    args: [...BACKEND_JVM_ARGS, archiveFlag, ...extraJvmArgs, '-jar', APP_JAR],
    cwd,
    jarPath: path.join(cwd, APP_JAR),
  };
}

/**
 * 正式启动：spawn(javaBin, launch.args, { cwd: launch.cwd })。
 * extraJvmArgs 只给测试用（例如 -Xlog:cds），放在共用参数之后、-jar 之前。
 */
function buildBackendLaunch(resourcesDir, { extraJvmArgs = [] } = {}) {
  return launchIn(resourcesDir, `-XX:SharedArchiveFile=${APP_ARCHIVE}`, extraJvmArgs, 'buildBackendLaunch');
}

/** 构建时的训练运行：同样的参数和目录，JVM 正常退出时把用到的类写进 app.jsa。 */
function buildTrainingLaunch(resourcesDir) {
  return launchIn(resourcesDir, `-XX:ArchiveClassesAtExit=${APP_ARCHIVE}`, [], 'buildTrainingLaunch');
}

module.exports = { APP_ARCHIVE, APP_JAR, BACKEND_DIR, BACKEND_JVM_ARGS, buildBackendLaunch, buildTrainingLaunch };
