const test = require('node:test');
const assert = require('node:assert/strict');
const { BACKEND_JVM_ARGS, buildBackendArgs } = require('./backendLaunch');

// V105-04：参数按 .scratch/v1.0.5/issues/04-base-cds-and-jvm-flags.md 的实验结果定。
const EXPECTED_JVM_ARGS = [
  '-XX:+UseSerialGC',
  '-XX:TieredStopAtLevel=1',
  '-Xms16m',
  '-Xmx512m',
  '-XX:ReservedCodeCacheSize=48m',
];

test('buildBackendArgs puts the lean JVM flags before -jar <jar>', () => {
  const jar = 'C:\\Program Files\\NextTypora\\resources\\backend.jar';
  assert.deepEqual(buildBackendArgs(jar), [...EXPECTED_JVM_ARGS, '-jar', jar]);
  assert.deepEqual([...BACKEND_JVM_ARGS], EXPECTED_JVM_ARGS);
});

test('a jar path with spaces and Chinese stays one argument, unquoted', () => {
  const jar = 'D:\\我的 软件\\NextTypora\\resources\\backend.jar';
  const args = buildBackendArgs(jar);
  assert.equal(args.at(-1), jar);
  assert.equal(args.at(-2), '-jar');
  assert.equal(args.indexOf('-jar'), args.length - 2, 'JVM flags must come before -jar, or java passes them to the app');
});

test('leaves class data sharing at its default and does not shrink thread stacks', () => {
  const args = buildBackendArgs('backend.jar');
  // -Xshare:on 会在类缓存用不了时拒绝启动；正式启动要保持默认的 auto，缓存用不了就退回普通启动。
  assert.ok(!args.some((arg) => arg.startsWith('-Xshare')), args.join(' '));
  // -Xss 改小省不了多少内存，还可能让嵌套很深的 Markdown 解析时栈溢出。
  assert.ok(!args.some((arg) => arg.startsWith('-Xss')), args.join(' '));
});

test('every call returns a fresh array and the shared flag list cannot be changed', () => {
  const first = buildBackendArgs('a.jar');
  first.unshift('-Xmx4g');
  first.push('--extra');
  assert.deepEqual(buildBackendArgs('b.jar'), [...EXPECTED_JVM_ARGS, '-jar', 'b.jar']);
  assert.ok(Object.isFrozen(BACKEND_JVM_ARGS));
});

test('rejects a missing jar path instead of starting java without one', () => {
  for (const bad of [undefined, null, '', 42]) {
    assert.throws(() => buildBackendArgs(bad), TypeError, String(bad));
  }
});
