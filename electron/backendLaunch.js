// 后端 java 进程的启动参数。electron/main.js 和 scripts/packaged-backend.test.js 都从这里取，
// 免得测试测的是一套参数、实际发布的是另一套。参数的依据见
// .scratch/v1.0.5/issues/04-base-cds-and-jvm-flags.md 和 .scratch/v1.0.5/spec.md 的「实验」一节。
//
// 刻意不加的：
// - -Xshare:on：类缓存用不了时 JVM 会拒绝启动。保持默认的 auto，缓存用不了就退回普通启动。
//   打包的 JRE 里有没有可用的类缓存，由 test:packaged 用 -Xshare:on 单独检查。
// - -Xss512k：线程栈用到才分配，改小省不了多少内存，反而可能让嵌套很深的 Markdown 解析时栈溢出。
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

/** spawn(javaBin, buildBackendArgs(jarPath)) 用的参数列表：JVM 参数必须在 -jar 之前，否则会被当成应用参数。 */
function buildBackendArgs(jarPath) {
  if (typeof jarPath !== 'string' || jarPath === '') {
    throw new TypeError(`buildBackendArgs: expected the backend jar path, got ${JSON.stringify(jarPath)}`);
  }
  return [...BACKEND_JVM_ARGS, '-jar', jarPath];
}

module.exports = { BACKEND_JVM_ARGS, buildBackendArgs };
