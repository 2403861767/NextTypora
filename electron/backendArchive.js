// 应用类缓存（app.jsa，V105-05）只在 classpath 上每个 jar 的大小和修改时间都和生成时一致时才会被
// JVM 采用；对不上时 JVM 打一条警告、按普通方式启动，不报错。
//
// electron-builder 打 NSIS 安装包时，7z 的参数里写死了 -mtm=off（app-builder-lib 的
// targets/archive.js），安装包里根本不存修改时间，装出来的每个文件都是安装时刻。所以构建时把
// 生成 app.jsa 那一刻每个 jar 的大小、修改时间和 SHA-256 记进 app.jsa.json；main.js 每次启动后端
// 之前调 restoreJarTimes，把对得上的 jar 改回记录里的修改时间。
//
// 修改时间必须分毫不差。Windows 上的 HotSpot 比的不是整秒（实测：改回到同一毫秒也不行），而 Node
// 只能用一个 double 秒数设置修改时间，表示不了 100 纳秒精度的原值。所以训练之前先用
// truncateJarTimes 把每个 jar 的修改时间截成整秒：整秒两边都能精确表示，JVM 记下的和这里改回去的
// 是同一个值。recordArchiveJars 遇到不是整秒的修改时间会直接报错，免得忘了这一步。
//
// 只有大小和 SHA-256 都和记录一致才改：JVM 用修改时间判断 jar 是不是生成缓存时那一个，我们改回去
// 之前先用内容确认它确实是。任何一个 jar 对不上就一个都不改，缓存反正用不了，交给 JVM 退回普通启动。
// 只在修改时间不一致时才算哈希，也就是安装或升级后的第一次启动（26MB，约 0.1 秒）；以后每次只 stat。
// 这里是同步的：只在后端 spawn 之前跑一次，而且 main.test.js 的假后端靠同步时序。
//
// per-user 安装（perMachine: false）不提权，安装目录一定是当前用户可写的；真改不了时只是没提速。
const crypto = require('crypto');
const nodeFs = require('fs');
const path = require('path');
const { APP_JAR } = require('./backendLaunch');

const RECORD_FILE = 'app.jsa.json';
const LIB_DIR = 'lib';

function sha256(fs, file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** classpath 上的 jar：app.jar 和 lib/*.jar，路径用 / 分隔、相对 backendDir。 */
function listJars(fs, backendDir) {
  const libJars = fs.readdirSync(path.join(backendDir, LIB_DIR))
    .filter((name) => name.endsWith('.jar'))
    .sort()
    .map((name) => `${LIB_DIR}/${name}`);
  return [APP_JAR, ...libJars];
}

/** 构建时、训练之前调用：把每个 jar 的修改时间截成整秒。 */
function truncateJarTimes(backendDir, { fs = nodeFs } = {}) {
  for (const relative of listJars(fs, backendDir)) {
    const file = path.join(backendDir, relative);
    const stat = fs.statSync(file);
    fs.utimesSync(file, stat.atime, Math.floor(stat.mtimeMs / 1000));
  }
}

/** 构建时、生成 app.jsa 之后调用：记下每个 jar 当时的样子，写进 backendDir/app.jsa.json。 */
function recordArchiveJars(backendDir, { fs = nodeFs } = {}) {
  const jars = listJars(fs, backendDir).map((relative) => {
    const file = path.join(backendDir, relative);
    const stat = fs.statSync(file);
    if (stat.mtimeMs % 1000 !== 0) {
      throw new Error(`${relative} has a sub-second mtime (${stat.mtimeMs}); run truncateJarTimes before generating the archive`);
    }
    return { path: relative, size: stat.size, mtime: stat.mtimeMs / 1000, sha256: sha256(fs, file) };
  });
  const record = { jars };
  fs.writeFileSync(path.join(backendDir, RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/**
 * 启动后端之前调用。从不抛异常：结果只用来记日志，后端照样要启动。
 * status：ok（都对得上）、restored（改回了 restored 里这些）、no-record（没有记录，比如开发布局）、
 * mismatch（有 jar 和记录不一致，什么都没改）、error（读记录或改修改时间失败）。
 */
function restoreJarTimes(backendDir, { fs = nodeFs } = {}) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(path.join(backendDir, RECORD_FILE), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { status: 'no-record', restored: [] };
    return { status: 'error', restored: [], detail: `${RECORD_FILE}: ${err.message}` };
  }

  try {
    const toRestore = [];
    for (const jar of record.jars) {
      const file = path.join(backendDir, ...jar.path.split('/'));
      let stat;
      try {
        stat = fs.statSync(file);
      } catch (err) {
        if (err.code === 'ENOENT') return { status: 'mismatch', restored: [], detail: `${jar.path} is missing` };
        throw err;
      }
      if (stat.size !== jar.size) {
        return { status: 'mismatch', restored: [], detail: `${jar.path} is ${stat.size} bytes, the archive was built against ${jar.size}` };
      }
      if (stat.mtimeMs === jar.mtime * 1000) continue;
      if (sha256(fs, file) !== jar.sha256) {
        return { status: 'mismatch', restored: [], detail: `${jar.path} is not the jar the archive was built against (SHA-256 differs)` };
      }
      toRestore.push({ jar, file, stat });
    }

    for (const { jar, file, stat } of toRestore) {
      fs.utimesSync(file, stat.atime, jar.mtime);
    }
    if (toRestore.length === 0) return { status: 'ok', restored: [] };
    return { status: 'restored', restored: toRestore.map(({ jar }) => jar.path) };
  } catch (err) {
    return { status: 'error', restored: [], detail: err.message };
  }
}

module.exports = { RECORD_FILE, recordArchiveJars, restoreJarTimes, truncateJarTimes };
