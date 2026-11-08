const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RECORD_FILE, recordArchiveJars, restoreJarTimes, truncateJarTimes } = require('./backendArchive');

// V105-05：JVM 只在每个 jar 的大小和修改时间都和生成 app.jsa 时一致时才用应用类缓存。
// electron-builder 打安装包的 7z 时写死了 -mtm=off，装出来的文件修改时间全是安装时刻，
// 缓存就悄悄失效。所以构建时记下每个 jar 的大小、修改时间、SHA-256，启动前按记录改回来。
// Windows 上的 HotSpot 比修改时间时精确到秒以下，Node 又设不出 100 纳秒精度的原值，
// 所以训练前把修改时间截成整秒，改回去的也是那个整秒。

const BUILD_TIME = new Date('2026-11-08T05:51:13.000Z');
const INSTALL_TIME = new Date('2026-12-01T09:30:47.250Z');

function seconds(date) {
  return Math.floor(date.getTime() / 1000);
}

function mtimeSeconds(file) {
  return Math.floor(fs.statSync(file).mtimeMs / 1000);
}

/** 造一个 resources/backend：app.jar + lib/*.jar，修改时间都是 BUILD_TIME。 */
function makeBackend(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexttyproa-archive-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = {
    'app.jar': 'app classes',
    'lib/spring-core-6.1.6.jar': 'spring core',
    'lib/flexmark-0.64.8.jar': 'flexmark',
  };
  fs.mkdirSync(path.join(dir, 'lib'));
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(dir, relative);
    fs.writeFileSync(file, content);
    fs.utimesSync(file, BUILD_TIME, BUILD_TIME);
  }
  return dir;
}

/** 模拟安装：内容不变，修改时间全变成安装时刻（安装包里没存修改时间）。 */
function install(dir) {
  for (const relative of ['app.jar', 'lib/spring-core-6.1.6.jar', 'lib/flexmark-0.64.8.jar']) {
    fs.utimesSync(path.join(dir, relative), INSTALL_TIME, INSTALL_TIME);
  }
}

test('recordArchiveJars writes size, whole-second mtime and SHA-256 of app.jar and every lib jar', (t) => {
  const dir = makeBackend(t);
  fs.writeFileSync(path.join(dir, 'lib', 'notes.txt'), 'not a jar');

  const record = recordArchiveJars(dir);

  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, RECORD_FILE), 'utf8')), record);
  assert.deepEqual(record.jars.map((jar) => jar.path), ['app.jar', 'lib/flexmark-0.64.8.jar', 'lib/spring-core-6.1.6.jar']);
  const app = record.jars[0];
  assert.equal(app.size, Buffer.byteLength('app classes'));
  assert.equal(app.mtime, seconds(BUILD_TIME));
  assert.equal(app.sha256, crypto.createHash('sha256').update('app classes').digest('hex'));
});

test('after an install that dropped the mtimes, restoreJarTimes puts every jar back to the recorded second', (t) => {
  const dir = makeBackend(t);
  recordArchiveJars(dir);
  install(dir);

  const result = restoreJarTimes(dir);

  assert.equal(result.status, 'restored', JSON.stringify(result));
  assert.deepEqual(result.restored.sort(), ['app.jar', 'lib/flexmark-0.64.8.jar', 'lib/spring-core-6.1.6.jar']);
  for (const relative of result.restored) {
    assert.equal(mtimeSeconds(path.join(dir, relative)), seconds(BUILD_TIME), relative);
  }
  // 第二次启动什么都不用改，也不用再算哈希
  assert.deepEqual(restoreJarTimes(dir), { status: 'ok', restored: [] });
});

test('a sub-second difference is restored too: HotSpot on Windows compares finer than whole seconds', (t) => {
  const dir = makeBackend(t);
  recordArchiveJars(dir);
  const sameSecond = new Date(BUILD_TIME.getTime() + 700);
  fs.utimesSync(path.join(dir, 'app.jar'), sameSecond, sameSecond);

  assert.deepEqual(restoreJarTimes(dir), { status: 'restored', restored: ['app.jar'] });
  assert.equal(fs.statSync(path.join(dir, 'app.jar')).mtimeMs, BUILD_TIME.getTime(), 'back to the exact recorded second');
});

test('truncateJarTimes cuts every jar mtime to its whole second, and recordArchiveJars refuses anything else', (t) => {
  const dir = makeBackend(t);
  const jagged = new Date(BUILD_TIME.getTime() + 644.797);
  for (const relative of ['app.jar', 'lib/spring-core-6.1.6.jar']) {
    fs.utimesSync(path.join(dir, relative), jagged, jagged);
  }
  assert.throws(() => recordArchiveJars(dir), /sub-second mtime/);
  assert.equal(fs.existsSync(path.join(dir, RECORD_FILE)), false);

  truncateJarTimes(dir);

  for (const relative of ['app.jar', 'lib/spring-core-6.1.6.jar', 'lib/flexmark-0.64.8.jar']) {
    assert.equal(fs.statSync(path.join(dir, relative)).mtimeMs, BUILD_TIME.getTime(), relative);
  }
  assert.equal(recordArchiveJars(dir).jars[0].mtime, seconds(BUILD_TIME));
});

test('a jar whose content differs from the record is left alone, and so is every other jar', (t) => {
  const dir = makeBackend(t);
  recordArchiveJars(dir);
  install(dir);
  // 同样大小、不同内容：只有哈希能认出来
  fs.writeFileSync(path.join(dir, 'lib', 'flexmark-0.64.8.jar'), 'FLEXMARK');
  fs.utimesSync(path.join(dir, 'lib', 'flexmark-0.64.8.jar'), INSTALL_TIME, INSTALL_TIME);

  const result = restoreJarTimes(dir);

  assert.equal(result.status, 'mismatch');
  assert.match(result.detail, /lib\/flexmark-0\.64\.8\.jar/);
  assert.deepEqual(result.restored, []);
  // 缓存反正用不上了：一个都不改，JVM 自己会退回普通启动
  assert.equal(mtimeSeconds(path.join(dir, 'app.jar')), seconds(INSTALL_TIME));
});

test('a jar with a different size, or a missing jar, is a mismatch and nothing is touched', (t) => {
  const dir = makeBackend(t);
  recordArchiveJars(dir);
  install(dir);
  fs.writeFileSync(path.join(dir, 'app.jar'), 'app classes, rebuilt');
  assert.equal(restoreJarTimes(dir).status, 'mismatch');

  fs.unlinkSync(path.join(dir, 'app.jar'));
  const result = restoreJarTimes(dir);
  assert.equal(result.status, 'mismatch');
  assert.match(result.detail, /app\.jar/);
  assert.equal(mtimeSeconds(path.join(dir, 'lib', 'spring-core-6.1.6.jar')), seconds(INSTALL_TIME));
});

test('no record (an unpacked dev layout) is not an error', (t) => {
  const dir = makeBackend(t);
  install(dir);
  assert.deepEqual(restoreJarTimes(dir), { status: 'no-record', restored: [] });
  assert.equal(mtimeSeconds(path.join(dir, 'app.jar')), seconds(INSTALL_TIME));
});

test('a damaged record or a failing write is reported, never thrown: the backend still has to start', (t) => {
  const dir = makeBackend(t);
  fs.writeFileSync(path.join(dir, RECORD_FILE), '{ not json');
  assert.equal(restoreJarTimes(dir).status, 'error');

  recordArchiveJars(dir);
  install(dir);
  const failingFs = { ...fs, utimesSync() { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); } };
  const result = restoreJarTimes(dir, { fs: failingFs });
  assert.equal(result.status, 'error');
  assert.match(result.detail, /EPERM/);
});
