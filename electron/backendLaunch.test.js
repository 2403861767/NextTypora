const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { BACKEND_JVM_ARGS, buildBackendLaunch, buildTrainingLaunch } = require('./backendLaunch');

// V105-04：参数按 .scratch/v1.0.5/issues/04-base-cds-and-jvm-flags.md 的实验结果定。
const EXPECTED_JVM_ARGS = [
  '-XX:+UseSerialGC',
  '-XX:TieredStopAtLevel=1',
  '-Xms16m',
  '-Xmx512m',
  '-XX:ReservedCodeCacheSize=48m',
];

const RESOURCES = 'C:\\Program Files\\NextTypora\\resources';

// V105-05：后端是普通 classpath（app.jar + lib/），在 resources/backend 里用相对路径启动，
// 带上构建时生成的应用类缓存 app.jsa。
test('buildBackendLaunch starts app.jar on the app class archive, from inside resources/backend', () => {
  const launch = buildBackendLaunch(RESOURCES);
  assert.deepEqual(launch.args, [...EXPECTED_JVM_ARGS, '-XX:SharedArchiveFile=app.jsa', '-jar', 'app.jar']);
  assert.equal(launch.cwd, path.join(RESOURCES, 'backend'));
  assert.equal(launch.jarPath, path.join(RESOURCES, 'backend', 'app.jar'));
  assert.deepEqual([...BACKEND_JVM_ARGS], EXPECTED_JVM_ARGS);
});

test('the jar and the archive are named relative to the working directory, never by absolute path', () => {
  // 类缓存记下的是生成时的 classpath 字符串。训练时用的是 cwd=resources/backend 加相对的 app.jar，
  // 启动时也必须这样，装到哪个目录（带空格、中文）都对得上。
  const resources = 'D:\\我的 软件\\NextTypora\\resources';
  const { args, cwd } = buildBackendLaunch(resources);
  assert.equal(cwd, path.join(resources, 'backend'));
  for (const arg of args) {
    assert.ok(!arg.includes(resources), `${arg} must not carry the install path`);
  }
  assert.deepEqual(args.slice(-2), ['-jar', 'app.jar'], 'JVM flags must come before -jar, or java passes them to the app');
});

test('the training run uses the same flags and directory but writes the archive instead of reading it', () => {
  const launch = buildTrainingLaunch(RESOURCES);
  assert.deepEqual(launch.args, [...EXPECTED_JVM_ARGS, '-XX:ArchiveClassesAtExit=app.jsa', '-jar', 'app.jar']);
  assert.equal(launch.cwd, buildBackendLaunch(RESOURCES).cwd);
  assert.ok(!launch.args.some((arg) => arg.startsWith('-XX:SharedArchiveFile')), launch.args.join(' '));
});

test('extra JVM flags (for tests) go before -jar, after the shared flags', () => {
  const { args } = buildBackendLaunch(RESOURCES, { extraJvmArgs: ['-Xlog:cds', '-Xlog:class+load'] });
  assert.deepEqual(args, [
    ...EXPECTED_JVM_ARGS, '-XX:SharedArchiveFile=app.jsa', '-Xlog:cds', '-Xlog:class+load', '-jar', 'app.jar',
  ]);
});

test('leaves class data sharing at its default and does not shrink thread stacks', () => {
  for (const { args } of [buildBackendLaunch(RESOURCES), buildTrainingLaunch(RESOURCES)]) {
    // -Xshare:on 会在类缓存用不了时拒绝启动；正式启动要保持默认的 auto，缓存用不了就退回普通启动。
    assert.ok(!args.some((arg) => arg.startsWith('-Xshare')), args.join(' '));
    // -Xss 改小省不了多少内存，还可能让嵌套很深的 Markdown 解析时栈溢出。
    assert.ok(!args.some((arg) => arg.startsWith('-Xss')), args.join(' '));
  }
});

test('every call returns a fresh array and the shared flag list cannot be changed', () => {
  const first = buildBackendLaunch(RESOURCES).args;
  first.unshift('-Xmx4g');
  first.push('--extra');
  assert.deepEqual(buildBackendLaunch(RESOURCES).args, [...EXPECTED_JVM_ARGS, '-XX:SharedArchiveFile=app.jsa', '-jar', 'app.jar']);
  assert.ok(Object.isFrozen(BACKEND_JVM_ARGS));
});

test('rejects a missing resources directory instead of starting java somewhere else', () => {
  for (const bad of [undefined, null, '', 42]) {
    assert.throws(() => buildBackendLaunch(bad), TypeError, String(bad));
    assert.throws(() => buildTrainingLaunch(bad), TypeError, String(bad));
  }
});
