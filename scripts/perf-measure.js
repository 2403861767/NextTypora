const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

/**
 * npm run perf:measure：测打包版（release/win-unpacked）的启动时间和内存占用。
 *
 * 口径见 GLOSSARY.md「性能」和 .scratch/v1.0.5/spec.md「口径」：
 *   启动时间：从 spawn exe 那一刻，到文件树里出现已知笔记名、并且编辑区里出现那篇恢复的笔记正文。
 *   内存占用：启动完成后空闲 20 秒，exe 整棵进程树（含 java.exe）的专用工作集之和，
 *             也就是任务管理器里那个数（Win32_PerfFormattedData_PerfProc_Process.WorkingSetPrivate；
 *             Win32_Process.PrivatePageCount 是提交量，不是这个数）。
 *
 * 只报告和警告：比参照版本差 20% 以上时打印警告，退出码仍然是 0。它不在 npm test、也不在
 * dist:verify 里：计时有噪声，而且 dist:verify 在打包之前跑，测不到打包版。
 *
 * 参数：
 *   --big-vault   另外生成 5000 篇（约 40MB）的工作区再测一组，只记录，不比较
 *   --rounds N    测量轮数，默认 3，取中位数（第一轮之前固定空跑一轮暖缓存）
 *   --no-record   只打印和比较，不写 results.json（02–05 报改动前后的数字时用）
 *   --replace     results.json 里已有这个版本时覆盖它（默认不覆盖）
 */

const projectRoot = path.join(__dirname, '..');
const RESULTS_PATH = path.join(projectRoot, 'test', 'perf', 'results.json');
const EXE_PATH = path.join(projectRoot, 'release', 'win-unpacked', 'NextTypora.exe');
const FIXTURE_VAULT = path.join(projectRoot, 'test', 'e2e-vault');
// app.setName('NextTyproa')，见 electron/main.js 和 ADR-0002。测量全程这个文件不能变。
const REAL_SETTINGS_PATH = path.join(process.env.APPDATA || os.homedir(), 'NextTyproa', 'settings.json');

// 恢复的那篇笔记，以及判断“启动完成”用的页面选择器。改了文件树或编辑器的 DOM，这里要跟着改，
// 否则每一轮都会超时（超时信息会说是哪一半没出现）。
const RESTORED_NOTE = 'ascii-notes.md';
const RESTORED_NOTE_TREE_NAME = 'ascii-notes';
const RESTORED_NOTE_PHRASE = 'Setext heading above';
const TREE_LABEL_SELECTOR = '.file-tree .tree-file-label';
const EDITOR_SELECTOR = '.ProseMirror, .cm-content';

const WARN_RATIO = 0.2;
const DEFAULT_ROUNDS = 3;
const IDLE_SECONDS = 20;
const STARTUP_TIMEOUT_MS = 90000;
const POLL_MS = 25;
const BIG_VAULT = { folders: 50, notesPerFolder: 100, noteBytes: 8 * 1024 };

// “构建 commit”取最近一次改动构建输入的提交。前提是打包版就是当前代码打的：先跑 verify:release。
const BUILD_INPUTS = [
  'frontend',
  'backend',
  'electron',
  'build',
  'package.json',
  'package-lock.json',
  'scripts/copy-backend-jar.js',
  'scripts/jarManifest.js',
  'scripts/prepare-jre.js',
  'scripts/train-backend-cds.js',
  ':(glob,exclude)**/*.test.*',
  ':(exclude)backend/src/test',
];

const METRICS = [
  { key: 'startupMs', label: '启动时间' },
  { key: 'memoryMB', label: '内存占用' },
];

const KIND_LABELS = {
  java: 'Java 后端',
  renderer: '渲染进程',
  gpu: 'GPU 进程',
  main: '主进程',
  network: '网络服务',
  conhost: '控制台宿主（java.exe 的 conhost）',
};

// ---- 纯函数（scripts/perf-measure.test.js 测这些） ------------------------------------

function parseVersion(version) {
  return String(version).split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

/**
 * 选参照：results 里不高于 version 的最高版本。本轮要写入 version 时把它自己排除（excludeCurrent），
 * 于是发布时比的是上一版；开发途中版本号还没改、本轮又不写入时，比的是这个版本已记录的数字。
 * 没有可比的版本返回 null。
 */
function findReference(results, version, { excludeCurrent = true } = {}) {
  const candidates = Object.keys(results || {}).filter((key) => {
    const order = compareVersions(key, version);
    return order < 0 || (order === 0 && !excludeCurrent);
  });
  if (candidates.length === 0) return null;
  candidates.sort(compareVersions);
  const key = candidates[candidates.length - 1];
  return { version: key, record: results[key] };
}

/**
 * 两个指标都是越小越好：变差超过 threshold（严格大于）才警告，变好多少都不警告。
 * 没有参照返回 null，表示不比较。
 */
function compareWithReference(reference, current, threshold = WARN_RATIO) {
  if (!reference) return null;
  const metrics = METRICS.map(({ key, label }) => {
    const previous = reference[key];
    const now = current[key];
    if (!(typeof previous === 'number' && previous > 0) || typeof now !== 'number') {
      return { key, label, previous, current: now, change: null, warn: false };
    }
    const change = (now - previous) / previous;
    return { key, label, previous, current: now, change, warn: change > threshold };
  });
  return { metrics, warnings: metrics.filter((metric) => metric.warn) };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * 时间取各自的中位数；内存取“内存合计是中位数的那一轮”，分项也用那一轮的，这样分项加起来等于合计。
 * 轮数是偶数时取偏小的那一轮。
 */
function summarizeRounds(rounds) {
  const timing = (key) => {
    const values = rounds.map((round) => round[key]).filter((value) => typeof value === 'number');
    return values.length ? Math.round(median(values)) : null;
  };
  const byMemory = [...rounds].sort((a, b) => a.memoryMB - b.memoryMB);
  const medianRound = byMemory[Math.floor((byMemory.length - 1) / 2)];
  return {
    startupMs: timing('startupMs'),
    windowMs: timing('windowMs'),
    treeMs: timing('treeMs'),
    noteMs: timing('noteMs'),
    memoryMB: medianRound.memoryMB,
    processesMB: medianRound.processesMB,
  };
}

function classifyProcess({ Name, CommandLine }, mainExeName = path.basename(EXE_PATH)) {
  const name = String(Name);
  if (/^javaw?\.exe$/i.test(name)) return 'java';
  // java.exe 是控制台程序，Windows 给它配一个 conhost.exe 子进程。任务管理器把它算在本应用这一组里，
  // 所以合计里要有它；但它没有 --type 开关，不能因此被当成 Electron 主进程
  if (name.toLowerCase() !== mainExeName.toLowerCase()) return name.replace(/\.exe$/i, '').toLowerCase();
  if (typeof CommandLine !== 'string') return 'unknown';
  const type = /--type=([\w-]+)/.exec(CommandLine);
  if (!type) return 'main';
  if (type[1] === 'renderer') return 'renderer';
  if (type[1] === 'gpu-process') return 'gpu';
  if (type[1] === 'utility') {
    const sub = /--utility-sub-type=([\w.]+)/.exec(CommandLine);
    if (sub && sub[1] === 'network.mojom.NetworkService') return 'network';
    return `utility:${sub ? sub[1].split('.').pop() : '?'}`;
  }
  return type[1];
}

function descendantsOf(rootPid, processes) {
  const root = processes.find((p) => p.ProcessId === rootPid);
  if (!root) return [];
  const tree = [root];
  const seen = new Set([rootPid]);
  for (let i = 0; i < tree.length; i += 1) {
    for (const p of processes) {
      if (p.ParentProcessId === tree[i].ProcessId && !seen.has(p.ProcessId)) {
        seen.add(p.ProcessId);
        tree.push(p);
      }
    }
  }
  return tree;
}

// ---- 文件系统（Node 24 的 fs.rmSync / cpSync 在中文路径上靠不住，一律逐项处理） ---------

const RETRYABLE_FS_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES']);

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function copyTree(source, target) {
  fs.mkdirSync(target, { recursive: true });
  let files = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      files += copyTree(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
      files += 1;
    }
  }
  return files;
}

function countFiles(dir) {
  let files = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) files += countFiles(path.join(dir, entry.name));
    else if (entry.isFile()) files += 1;
  }
  return files;
}

function removeTreeOnce(target) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat) return;
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target)) removeTreeOnce(path.join(target, name));
    fs.rmdirSync(target);
    return;
  }
  try {
    fs.unlinkSync(target);
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    fs.chmodSync(target, 0o666);
    fs.unlinkSync(target);
  }
}

// 进程刚被结束时 Chromium 的文件可能还被占着一小会儿，所以要重试；删完必须核实目录真的没了
function removeTree(target) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      removeTreeOnce(target);
    } catch (error) {
      if (!RETRYABLE_FS_CODES.has(error.code)) throw error;
    }
    if (!fs.existsSync(target)) return;
    sleepSync(250);
  }
  throw new Error(`临时目录删不掉：${target}`);
}

function fileSha256(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (error) {
    return error.code === 'ENOENT' ? '（文件不存在）' : `（读取失败：${error.code}）`;
  }
}

function generateBigVault(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(FIXTURE_VAULT, RESTORED_NOTE), path.join(dir, RESTORED_NOTE));
  const line = '这是一段用于压力测试的中文正文，包含一些 English words 和 **粗体**、`代码`。\n';
  let bytes = 0;
  let notes = 0;
  for (let f = 0; f < BIG_VAULT.folders; f += 1) {
    const folder = path.join(dir, `目录${f}`);
    fs.mkdirSync(folder);
    for (let n = 0; n < BIG_VAULT.notesPerFolder; n += 1) {
      let text = `---\ntags: [perf, t${n % 20}]\n---\n# 标题 ${f}-${n}\n\n`;
      while (Buffer.byteLength(text) < BIG_VAULT.noteBytes) text += line;
      fs.writeFileSync(path.join(folder, `笔记${n}.md`), text, 'utf8');
      bytes += Buffer.byteLength(text);
      notes += 1;
    }
  }
  return { notes, bytes };
}

// ---- 进程 ---------------------------------------------------------------------------

function powershell(script) {
  return execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`,
  ], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

function exeFileVersion(exe) {
  return powershell(`(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.FileVersion`).trim();
}

function listProcesses({ withMemory = false } = {}) {
  const processes = '@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine)';
  const memory = withMemory
    ? '@(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Select-Object IDProcess,WorkingSetPrivate)'
    : '@()';
  const parsed = JSON.parse(powershell(`ConvertTo-Json -Compress -Depth 3 @{ p = ${processes}; w = ${memory} }`));
  const privateWorkingSet = new Map((parsed.w || []).map((row) => [row.IDProcess, row.WorkingSetPrivate]));
  return { processes: parsed.p || [], privateWorkingSet };
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// taskkill /T 只能沿着还活着的父进程往下找；主进程先没了的话 java.exe 会落下，所以再按已知 PID 逐个补
function killTree(rootPid, knownPids) {
  const pids = [...new Set([rootPid, ...knownPids])];
  try {
    execFileSync('taskkill.exe', ['/PID', String(rootPid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } catch {
    // 已经退出了，下面会核实
  }
  const deadline = Date.now() + 10000;
  let alive = pids.filter(isAlive);
  while (alive.length && Date.now() < deadline) {
    for (const pid of alive) {
      try {
        execFileSync('taskkill.exe', ['/PID', String(pid), '/F'], { stdio: 'ignore', windowsHide: true });
      } catch {
        // 同上
      }
    }
    sleepSync(200);
    alive = pids.filter(isAlive);
  }
  return alive;
}

// Ctrl+C 时也要结束进程、删掉临时目录
const active = { roots: new Map(), dirs: new Set() };
process.on('SIGINT', () => {
  console.error('\n中断：正在结束测量进程、删除临时目录…');
  for (const [root, pids] of active.roots) killTree(root, [...pids]);
  for (const dir of active.dirs) {
    try {
      removeTree(dir);
    } catch (error) {
      console.error(error.message);
    }
  }
  process.exit(130);
});

// ---- CDP ----------------------------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// 只认 file:// 的页面。启动画面是 data: 开头的另一个 page 目标，它关闭以后，连在它上面的
// Runtime.evaluate 会一直挂到超时（1.0.4 有启动画面，V105-02 之后没有，两种都要能测）。
async function findMainPageTarget(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
    const targets = await response.json();
    return targets.find((t) => t.type === 'page' && String(t.url).startsWith('file:')) || null;
  } catch {
    return null;
  }
}

function connectCdp(webSocketUrl, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketUrl);
    const pending = new Map();
    let nextId = 0;
    const settle = (id, fn, value) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      clearTimeout(entry.timer);
      entry[fn](value);
    };
    const client = {
      send(method, params = {}, ms = 5000) {
        return new Promise((res, rej) => {
          nextId += 1;
          const id = nextId;
          const timer = setTimeout(() => settle(id, 'reject', new Error(`CDP ${method} 超时`)), ms);
          pending.set(id, { resolve: res, reject: rej, timer });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      async evaluate(expression) {
        const result = await client.send('Runtime.evaluate', { expression, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluate 抛错');
        return result.result.value;
      },
      close() {
        try {
          ws.close();
        } catch {
          // 已经关了
        }
      },
    };
    const connectTimer = setTimeout(() => {
      client.close();
      reject(new Error('CDP 连接超时'));
    }, timeoutMs);
    ws.addEventListener('open', () => {
      clearTimeout(connectTimer);
      resolve(client);
    });
    ws.addEventListener('error', () => {
      clearTimeout(connectTimer);
      reject(new Error('CDP 连接失败'));
    });
    ws.addEventListener('close', () => {
      for (const id of [...pending.keys()]) settle(id, 'reject', new Error('CDP 连接已关闭'));
    });
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.error) settle(message.id, 'reject', new Error(message.error.message));
      else settle(message.id, 'resolve', message.result);
    });
  });
}

const READY_EXPRESSION = `(() => {
  const has = (selector, text) => [...document.querySelectorAll(selector)].some((el) => el.textContent.includes(text));
  return {
    tree: has(${JSON.stringify(TREE_LABEL_SELECTOR)}, ${JSON.stringify(RESTORED_NOTE_TREE_NAME)}),
    note: has(${JSON.stringify(EDITOR_SELECTOR)}, ${JSON.stringify(RESTORED_NOTE_PHRASE)}),
  };
})()`;

// ---- 一轮测量 -----------------------------------------------------------------------

function writeSettings(userData, vault) {
  fs.mkdirSync(userData, { recursive: true });
  // 字段见 electron/ipcValidation.js 的 SETTINGS_FIELDS
  const settings = {
    lastWorkspace: vault,
    openTabs: [{ id: RESTORED_NOTE, path: RESTORED_NOTE, title: RESTORED_NOTE_TREE_NAME }],
    activeTabPath: RESTORED_NOTE,
    openTabsWorkspace: vault,
  };
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
}

function readBackendTimes(userData) {
  try {
    const log = fs.readFileSync(path.join(userData, 'logs', 'backend.log'), 'utf8');
    const match = /Started NextTyproaApplication in ([\d.]+) seconds \(process running for ([\d.]+)\)/.exec(log);
    return match ? { springSec: Number(match[1]), jvmSec: Number(match[2]) } : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round1 = (value) => Math.round(value * 10) / 10;
const toMB = (bytes) => round1((Number(bytes) || 0) / 1048576);

async function runRound({ exe, sourceVault, preparedVault, idleSeconds, label }) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexttypora-perf-'));
  active.dirs.add(workDir);
  const userData = path.join(workDir, 'userdata');
  const knownPids = new Set();
  let child = null;
  let cdp = null;
  let leftovers = [];
  let succeeded = false;
  try {
    let vault = preparedVault;
    if (!vault) {
      vault = path.join(workDir, 'vault');
      const copied = copyTree(sourceVault, vault);
      const expected = countFiles(sourceVault);
      if (copied !== expected || countFiles(vault) !== expected) {
        throw new Error(`工作区副本不完整：应有 ${expected} 个文件，复制了 ${copied} 个（${vault}）`);
      }
    }
    writeSettings(userData, vault);
    const port = await freePort();

    // 不经过 cmd.exe：带引号的 --user-data-dir 在 cmd 里转一道可能失效，就会用上真实的 %APPDATA%\NextTyproa
    const t0 = performance.now();
    child = spawn(exe, [`--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], { stdio: 'ignore' });
    const elapsed = () => Math.round(performance.now() - t0);
    active.roots.set(child.pid, knownPids);
    let exited = null;
    child.once('exit', (code) => { exited = `退出码 ${code}`; });
    child.once('error', (error) => { exited = error.message; });

    const marks = { windowMs: null, treeMs: null, noteMs: null, startupMs: null };
    while (marks.startupMs === null) {
      if (exited) throw new Error(`${label}：NextTypora.exe 在启动完成前退出了（${exited}）`);
      if (performance.now() - t0 > STARTUP_TIMEOUT_MS) {
        throw new Error(`${label}：${STARTUP_TIMEOUT_MS / 1000} 秒内没有启动完成。`
          + `主窗口${marks.windowMs === null ? '没有' : '已经'}出现，`
          + `文件树里的「${RESTORED_NOTE_TREE_NAME}」${marks.treeMs === null ? '没有' : '已经'}出现，`
          + `笔记正文「${RESTORED_NOTE_PHRASE}」${marks.noteMs === null ? '没有' : '已经'}出现。`
          + '页面结构改了的话，改脚本顶部的选择器。');
      }
      if (!cdp) {
        const target = await findMainPageTarget(port);
        if (target) {
          if (marks.windowMs === null) marks.windowMs = elapsed();
          cdp = await connectCdp(target.webSocketDebuggerUrl).catch(() => null);
        }
      } else {
        try {
          const state = await cdp.evaluate(READY_EXPRESSION);
          const now = elapsed();
          if (state && state.tree && marks.treeMs === null) marks.treeMs = now;
          if (state && state.note && marks.noteMs === null) marks.noteMs = now;
          if (state && state.tree && state.note) marks.startupMs = now;
        } catch {
          // 页面在导航或重新加载：重新找目标再连
          cdp.close();
          cdp = null;
        }
      }
      if (marks.startupMs === null) await sleep(POLL_MS);
    }
    // 空闲期间不挂着 DevTools 会话，免得它自己占内存
    cdp.close();
    cdp = null;

    await sleep(idleSeconds * 1000);
    if (exited) throw new Error(`${label}：NextTypora.exe 在空闲期间退出了（${exited}）`);

    const { processes, privateWorkingSet } = listProcesses({ withMemory: true });
    const tree = descendantsOf(child.pid, processes);
    for (const p of tree) knownPids.add(p.ProcessId);
    const root = tree.find((p) => p.ProcessId === child.pid);
    if (!root || typeof root.CommandLine !== 'string' || !root.CommandLine.includes(userData)
      || !fs.existsSync(path.join(userData, 'Local State'))) {
      throw new Error(`${label}：主进程没有用上临时的 user-data-dir（${userData}），数字作废。`
        + '检查真实的 %APPDATA%\\NextTyproa\\settings.json 有没有被改。');
    }
    const rows = tree.map((p) => ({ kind: classifyProcess(p), pid: p.ProcessId, mb: toMB(privateWorkingSet.get(p.ProcessId)) }));
    const processesMB = {};
    for (const row of rows) processesMB[row.kind] = round1((processesMB[row.kind] || 0) + row.mb);
    const result = {
      ...marks,
      memoryMB: round1(rows.reduce((total, row) => total + row.mb, 0)),
      processesMB,
      processCount: rows.length,
      backend: readBackendTimes(userData),
    };
    succeeded = true;
    return result;
  } finally {
    if (cdp) cdp.close();
    if (child && child.pid) {
      try {
        for (const p of descendantsOf(child.pid, listProcesses().processes)) knownPids.add(p.ProcessId);
      } catch {
        // 列不出来也照样按已知 PID 结束
      }
      leftovers = killTree(child.pid, [...knownPids]);
      active.roots.delete(child.pid);
    }
    removeTree(workDir);
    active.dirs.delete(workDir);
    if (leftovers.length) {
      const message = `${label}：这些进程结束不掉：${leftovers.join(', ')}`;
      // 已经有错误在往外抛时不要盖掉它
      // eslint-disable-next-line no-unsafe-finally
      if (succeeded) throw new Error(message);
      console.error(message);
    }
  }
}

async function measureSet({ name, sourceVault, preparedVault, rounds, idleSeconds, exe }) {
  const all = [];
  for (let i = 0; i <= rounds; i += 1) {
    const label = i === 0 ? '暖缓存' : `第 ${i} 轮`;
    process.stdout.write(`  ${name} ${label} … `);
    const result = await runRound({ exe, sourceVault, preparedVault, idleSeconds, label: `${name} ${label}` });
    console.log(`启动 ${seconds(result.startupMs)}，内存占用 ${result.memoryMB.toFixed(1)} MB`);
    all.push(result);
  }
  const [warmup, ...measured] = all;
  return { warmup, rounds: measured, summary: summarizeRounds(measured) };
}

// ---- 输出 ---------------------------------------------------------------------------

const seconds = (ms) => (typeof ms === 'number' ? `${(ms / 1000).toFixed(2)} 秒` : '—');
const percent = (change) => `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%`;
const formatMetric = (key, value) => (key === 'startupMs' ? seconds(value) : `${Number(value).toFixed(1)} MB`);

function displayWidth(text) {
  let width = 0;
  for (const ch of String(text)) {
    width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
  }
  return width;
}

function printTable(headers, rows) {
  const widths = headers.map((header, i) => Math.max(displayWidth(header), ...rows.map((row) => displayWidth(row[i]))));
  const line = (cells) => cells.map((cell, i) => {
    const gap = ' '.repeat(widths[i] - displayWidth(cell));
    return i === 0 ? `${cell}${gap}` : `${gap}${cell}`;
  }).join('   ');
  if (headers.some(Boolean)) console.log(`  ${line(headers)}`);
  for (const row of rows) console.log(`  ${line(row)}`);
}

function printSet(title, set) {
  console.log(`\n${title}`);
  const roundRow = (label, r) => [label, seconds(r.windowMs), seconds(r.treeMs), seconds(r.noteMs), seconds(r.startupMs), `${r.memoryMB.toFixed(1)} MB`];
  printTable(
    ['', '主窗口创建', '文件树出现', '笔记正文出现', '启动时间', '内存占用'],
    [
      roundRow('暖缓存（不计）', set.warmup),
      ...set.rounds.map((r, i) => roundRow(`第 ${i + 1} 轮`, r)),
      roundRow('中位数', set.summary),
    ],
  );
  console.log('\n  各进程内存占用（取内存合计为中位数的那一轮）：');
  const kinds = Object.entries(set.summary.processesMB).sort((a, b) => b[1] - a[1]);
  printTable(['', ''], [
    ...kinds.map(([kind, mb]) => [KIND_LABELS[kind] || kind, `${mb.toFixed(1)} MB`]),
    ['合计', `${set.summary.memoryMB.toFixed(1)} MB`],
  ]);
  const backend = set.rounds.map((r) => r.backend).filter(Boolean);
  if (backend.length) {
    console.log(`\n  后端日志（中位数）：JVM 启动到 Spring 就绪 ${median(backend.map((b) => b.jvmSec)).toFixed(2)} 秒，`
      + `其中 Spring ${median(backend.map((b) => b.springSec)).toFixed(2)} 秒`);
  }
}

// ---- 版本、构建、机器信息 -------------------------------------------------------------

function git(args) {
  try {
    return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd: projectRoot, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function buildInfo(fileVersion) {
  const status = git(['status', '--porcelain', '--', ...BUILD_INPUTS]);
  return {
    commit: git(['log', '-1', '--format=%h', '--', ...BUILD_INPUTS]),
    uncommittedBuildInputs: status ? status.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3)) : [],
    exe: path.relative(projectRoot, EXE_PATH).replace(/\\/g, '/'),
    fileVersion,
  };
}

function machineInfo() {
  const cpus = os.cpus();
  return {
    cpu: cpus[0] ? cpus[0].model.trim() : 'unknown',
    logicalCpus: cpus.length,
    memoryGB: round1(os.totalmem() / 1024 ** 3),
    os: `Windows ${os.release()}`,
  };
}

function localDate() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function readResults() {
  try {
    return JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`读不了 ${RESULTS_PATH}：${error.message}`);
  }
}

function writeResults(results) {
  const sorted = {};
  for (const key of Object.keys(results).sort(compareVersions)) sorted[key] = results[key];
  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  fs.writeFileSync(RESULTS_PATH, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

function parseArgs(argv) {
  const options = { bigVault: false, rounds: DEFAULT_ROUNDS, record: true, replace: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--big-vault') options.bigVault = true;
    else if (arg === '--no-record') options.record = false;
    else if (arg === '--replace') options.replace = true;
    else if (arg === '--rounds' || arg.startsWith('--rounds=')) {
      const value = arg.includes('=') ? arg.split('=')[1] : argv[++i];
      options.rounds = Number.parseInt(value, 10);
      if (!(options.rounds >= 1)) throw new Error(`--rounds 要是正整数，收到的是 ${value}`);
    } else {
      throw new Error(`不认识的参数：${arg}（可用：--big-vault、--rounds N、--no-record、--replace）`);
    }
  }
  return options;
}

// ---- 主流程 -------------------------------------------------------------------------

async function main(argv) {
  const options = parseArgs(argv);
  if (process.platform !== 'win32') throw new Error('perf:measure 只测 Windows 打包版。');

  const version = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version;
  if (!fs.existsSync(EXE_PATH)) {
    throw new Error(`找不到 ${EXE_PATH}。perf:measure 只测打包版，先打包：npm run dist:dir`);
  }
  const fileVersion = exeFileVersion(EXE_PATH);
  if (!fileVersion.startsWith(version)) {
    throw new Error(`打包版的版本是 ${fileVersion}，package.json 是 ${version}：数字会记到错的版本下。先重新打包（npm run dist:dir）。`);
  }
  const fixtureNote = fs.readFileSync(path.join(FIXTURE_VAULT, RESTORED_NOTE), 'utf8');
  if (!fixtureNote.includes(RESTORED_NOTE_PHRASE)) {
    throw new Error(`test/e2e-vault/${RESTORED_NOTE} 里没有「${RESTORED_NOTE_PHRASE}」了：夹具被改过，改脚本顶部的 RESTORED_NOTE_PHRASE。`);
  }

  const settingsBefore = fileSha256(REAL_SETTINGS_PATH);
  const results = readResults();
  const existing = results[version];
  const willRecord = options.record && (!existing || options.replace);
  const build = buildInfo(fileVersion);
  const machine = machineInfo();

  console.log(`NextTypora ${version} 性能测量（打包版 ${build.exe}，FileVersion ${fileVersion}，构建输入最近的提交 ${build.commit}）`);
  console.log(`机器：${machine.cpu}，${machine.logicalCpus} 线程，${machine.memoryGB} GB 内存，${machine.os}`);
  console.log(`每组：暖缓存 1 轮 + 测量 ${options.rounds} 轮，取中位数；启动完成后空闲 ${IDLE_SECONDS} 秒再读内存占用。`);
  console.log(`恢复的笔记：${RESTORED_NOTE}（正文里找「${RESTORED_NOTE_PHRASE}」）\n`);

  const vaultSet = await measureSet({
    name: 'e2e-vault', sourceVault: FIXTURE_VAULT, rounds: options.rounds, idleSeconds: IDLE_SECONDS, exe: EXE_PATH,
  });

  let big = null;
  if (options.bigVault) {
    const bigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexttypora-perf-big-'));
    active.dirs.add(bigDir);
    try {
      const vault = path.join(bigDir, 'vault');
      process.stdout.write(`  生成 ${BIG_VAULT.folders * BIG_VAULT.notesPerFolder} 篇的工作区 … `);
      const generated = generateBigVault(vault);
      console.log(`${generated.notes} 篇，${toMB(generated.bytes)} MB`);
      // 大工作区只生成一次，各轮共用（每轮仍然是新的 user-data-dir）；应用打开工作区不会写笔记文件
      const set = await measureSet({
        name: '5000 篇', preparedVault: vault, rounds: options.rounds, idleSeconds: IDLE_SECONDS, exe: EXE_PATH,
      });
      big = { ...set, notes: generated.notes, sizeMB: toMB(generated.bytes) };
    } finally {
      removeTree(bigDir);
      active.dirs.delete(bigDir);
    }
  }

  printSet(`e2e-vault（${version}）`, vaultSet);
  if (big) printSet(`5000 篇、${big.sizeMB} MB 的工作区（只记录，不比较）`, big);

  // 和参照版本比：只报告和警告，不改退出码
  const reference = findReference(results, version, { excludeCurrent: willRecord });
  const comparison = compareWithReference(reference && reference.record, vaultSet.summary);
  console.log('');
  if (!comparison) {
    console.log(`results.json 里没有可以比较的版本（不高于 ${version}${willRecord ? '、且不是本次写入的这一版' : ''}），这次不比较。`);
  } else {
    console.log(`对比 ${reference.version}（${reference.record.date || '日期未知'} 记录）：`);
    for (const m of comparison.metrics) {
      if (m.change === null) console.log(`  ${m.label}：${reference.version} 没有这一项`);
      else console.log(`  ${m.label}：${formatMetric(m.key, m.current)}，${reference.version} 是 ${formatMetric(m.key, m.previous)}（${percent(m.change)}）`);
    }
    for (const m of comparison.warnings) {
      console.log(`  ⚠ 警告：${m.label}比 ${reference.version} 差了 ${percent(m.change)}，超过 ${WARN_RATIO * 100}%。只是提醒，不拦发布。`);
    }
  }

  const trimRound = ({ backend, ...round }) => (backend ? { ...round, backend } : round);
  const record = {
    date: localDate(),
    machine,
    build,
    method: {
      workspace: 'test/e2e-vault',
      restoredNote: RESTORED_NOTE,
      warmupRounds: 1,
      rounds: options.rounds,
      idleSeconds: IDLE_SECONDS,
    },
    ...vaultSet.summary,
    rounds: vaultSet.rounds.map(trimRound),
    warmup: { startupMs: vaultSet.warmup.startupMs, memoryMB: vaultSet.warmup.memoryMB },
  };
  if (big) {
    record.bigVault = {
      notes: big.notes,
      sizeMB: big.sizeMB,
      ...big.summary,
      rounds: big.rounds.map(trimRound),
    };
  }

  const relativeResults = path.relative(projectRoot, RESULTS_PATH).replace(/\\/g, '/');
  if (willRecord) {
    writeResults({ ...results, [version]: record });
    console.log(`\n已写入 ${relativeResults}（键 ${version}${existing ? '，覆盖了原来的记录' : ''}）。`);
  } else if (!options.record) {
    console.log(`\n--no-record：没有写入 ${relativeResults}。`);
  } else {
    console.log(`\n${relativeResults} 里已有 ${version}（${existing.date || '日期未知'}），没有覆盖。要覆盖就加 --replace。`);
  }

  const settingsAfter = fileSha256(REAL_SETTINGS_PATH);
  if (settingsAfter === settingsBefore) {
    console.log(`真实设置文件没有变（${REAL_SETTINGS_PATH}，SHA-256 ${settingsBefore}）。`);
  } else {
    // 你自己开着的 NextTypora 也会改这个文件，所以只警告；但测量用的进程都核实过用的是临时目录
    console.log(`⚠ 真实设置文件在测量期间变了：${REAL_SETTINGS_PATH}\n  之前 ${settingsBefore}\n  之后 ${settingsAfter}`);
  }
}

module.exports = {
  WARN_RATIO,
  compareVersions,
  findReference,
  compareWithReference,
  median,
  summarizeRounds,
  classifyProcess,
  descendantsOf,
};

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`\nperf:measure 失败：${error.message}`);
    process.exit(1);
  });
}
