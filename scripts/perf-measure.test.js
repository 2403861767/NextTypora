const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compareVersions,
  findReference,
  compareWithReference,
  median,
  summarizeRounds,
  classifyProcess,
  descendantsOf,
} = require('./perf-measure');

// 这一组只测纯函数。真正去启动打包版的部分没法放进单元测试，见 npm run perf:measure。

const baseline = { startupMs: 5000, memoryMB: 280 };

test('19% slower startup and 19% more memory: compared, no warning', () => {
  const result = compareWithReference(baseline, { startupMs: 5950, memoryMB: 333.2 });

  assert.ok(result, 'a reference exists, so there must be a comparison');
  assert.deepEqual(result.metrics.map((m) => m.key), ['startupMs', 'memoryMB']);
  assert.ok(Math.abs(result.metrics[0].change - 0.19) < 1e-9);
  assert.ok(Math.abs(result.metrics[1].change - 0.19) < 1e-9);
  assert.deepEqual(result.warnings, []);
});

test('21% slower startup: warns about startup only', () => {
  const result = compareWithReference(baseline, { startupMs: 6050, memoryMB: 280 });

  assert.deepEqual(result.warnings.map((m) => m.key), ['startupMs']);
  assert.ok(Math.abs(result.warnings[0].change - 0.21) < 1e-9);
});

test('21% more memory: warns about memory only', () => {
  const result = compareWithReference(baseline, { startupMs: 5000, memoryMB: 338.8 });

  assert.deepEqual(result.warnings.map((m) => m.key), ['memoryMB']);
});

test('getting faster or smaller never warns, however large the change', () => {
  const result = compareWithReference(baseline, { startupMs: 1500, memoryMB: 140 });

  assert.deepEqual(result.warnings, []);
  assert.ok(result.metrics[0].change < -0.6);
});

test('no previous version: nothing to compare against', () => {
  assert.equal(findReference({}, '1.0.4'), null);
  assert.equal(findReference(undefined, '1.0.4'), null);
  // 第一次给 1.0.4 记基线：results.json 里只有将要写入的这一版，它不能和自己比
  assert.equal(findReference({ '1.0.4': baseline }, '1.0.4', { excludeCurrent: true }), null);
  // 比现在还新的版本也不算“上一版”
  assert.equal(findReference({ '1.0.6': baseline }, '1.0.5', { excludeCurrent: true }), null);
  assert.equal(compareWithReference(null, { startupMs: 9999, memoryMB: 999 }), null);
});

test('reference is the highest version not above the current one, compared numerically', () => {
  const results = {
    '1.0.9': { startupMs: 1 },
    '1.0.10': { startupMs: 2 },
    '1.0.11': { startupMs: 3 },
    '1.1.0': { startupMs: 4 },
  };

  const reference = findReference(results, '1.0.11', { excludeCurrent: true });

  assert.equal(reference.version, '1.0.10');
  assert.equal(reference.record.startupMs, 2);
  assert.ok(compareVersions('1.0.10', '1.0.9') > 0);
  assert.equal(compareVersions('1.0.4', '1.0.4'), 0);
});

test('a run that does not write its version compares against that version\'s own record', () => {
  // 02–05 开发途中 package.json 还是 1.0.4、results.json 里已有 1.0.4 基线：比的就是这份基线
  const results = { '1.0.3': { startupMs: 1 }, '1.0.4': { startupMs: 2 } };

  assert.equal(findReference(results, '1.0.4', { excludeCurrent: false }).version, '1.0.4');
  assert.equal(findReference(results, '1.0.4', { excludeCurrent: true }).version, '1.0.3');
});

test('median of odd and even counts', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('summary takes the median startup and the per-process breakdown of the median-memory round', () => {
  const rounds = [
    { windowMs: 4400, treeMs: 5000, noteMs: 5100, startupMs: 5100, memoryMB: 290, processesMB: { java: 170 } },
    { windowMs: 4500, treeMs: 4900, noteMs: 5300, startupMs: 5300, memoryMB: 270, processesMB: { java: 150 } },
    { windowMs: 4300, treeMs: 4800, noteMs: 4900, startupMs: 4900, memoryMB: 280, processesMB: { java: 160 } },
  ];

  const summary = summarizeRounds(rounds);

  assert.equal(summary.startupMs, 5100);
  assert.equal(summary.treeMs, 4900);
  assert.equal(summary.noteMs, 5100);
  assert.equal(summary.windowMs, 4400);
  assert.equal(summary.memoryMB, 280);
  assert.deepEqual(summary.processesMB, { java: 160 });
});

test('process kinds follow the Chromium --type switch, java.exe is the backend', () => {
  const exe = 'C:\\x\\NextTypora.exe';
  assert.equal(classifyProcess({ Name: 'java.exe', CommandLine: 'java.exe -jar backend.jar' }), 'java');
  assert.equal(classifyProcess({ Name: 'NextTypora.exe', CommandLine: `"${exe}" --user-data-dir=C:\\t` }), 'main');
  assert.equal(classifyProcess({ Name: 'NextTypora.exe', CommandLine: `"${exe}" --type=renderer --foo` }), 'renderer');
  assert.equal(classifyProcess({ Name: 'NextTypora.exe', CommandLine: `"${exe}" --type=gpu-process` }), 'gpu');
  assert.equal(classifyProcess({
    Name: 'NextTypora.exe',
    CommandLine: `"${exe}" --type=utility --utility-sub-type=network.mojom.NetworkService`,
  }), 'network');
  assert.equal(classifyProcess({
    Name: 'NextTypora.exe',
    CommandLine: `"${exe}" --type=utility --utility-sub-type=storage.mojom.StorageService`,
  }), 'utility:StorageService');
  assert.equal(classifyProcess({ Name: 'NextTypora.exe', CommandLine: `"${exe}" --type=crashpad-handler` }), 'crashpad-handler');
  // 读不到命令行（权限不够）时不能猜成主进程
  assert.equal(classifyProcess({ Name: 'NextTypora.exe', CommandLine: null }), 'unknown');
});

test('a non-Electron child such as java.exe\'s conhost.exe is its own kind, not the main process', () => {
  // java.exe 是控制台程序，Windows 给它配一个 conhost.exe；它没有 --type 开关，但不是 Electron 主进程
  assert.equal(classifyProcess({ Name: 'conhost.exe', CommandLine: '\\??\\C:\\WINDOWS\\system32\\conhost.exe 0x4' }), 'conhost');
  assert.equal(classifyProcess({ Name: 'NEXTTYPORA.EXE', CommandLine: 'NEXTTYPORA.EXE' }), 'main');
  assert.equal(classifyProcess({ Name: 'Other.exe', CommandLine: 'Other.exe --type=renderer' }, 'Other.exe'), 'renderer');
});

test('process tree includes the root and every descendant, nothing else', () => {
  const processes = [
    { ProcessId: 10, ParentProcessId: 1 },
    { ProcessId: 11, ParentProcessId: 10 },
    { ProcessId: 12, ParentProcessId: 10 },
    { ProcessId: 13, ParentProcessId: 12 },
    { ProcessId: 20, ParentProcessId: 1 },
    { ProcessId: 21, ParentProcessId: 20 },
  ];

  assert.deepEqual(descendantsOf(10, processes).map((p) => p.ProcessId).sort(), [10, 11, 12, 13]);
  assert.deepEqual(descendantsOf(99, processes), []);
});
