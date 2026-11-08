// 生成应用类缓存 resources/backend/app.jsa（AppCDS，V105-05）。prepare:resources 里排在
// copy-backend-jar.js、prepare-jre.js 之后，test:packaged 之前，每次都重新生成：JDK、Spring Boot
// 或任何依赖一升级，缓存就跟着更新，不用人记着。
//
// 做法：用打包的 JRE 和正式启动完全相同的参数、相同的工作目录（backendLaunch.js 的
// buildTrainingLaunch）启动后端，把渲染进程会调的接口走一遍，这些代码路径上的类才会进缓存。
// -XX:ArchiveClassesAtExit 要等 JVM 正常退出才写出缓存，而结束后端的 TerminateProcess 不算。
// 所以 PARENT_PID 指向一个由这里控制的辅助进程：走完接口就结束它，ParentProcessMonitor 发现
// 父进程没了，调用 System.exit(0)。正式版里没有为此加任何能从外部调用的退出接口。
//
// 训练时会打印一批 `Preload Warning: Verification failed for …`（Reactor、JDBC、Redis 等自动配置类，
// 它们的依赖不在 classpath 上），这是正常的。
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { APP_ARCHIVE, buildTrainingLaunch } = require('../electron/backendLaunch');
const { RECORD_FILE, recordArchiveJars, truncateJarTimes } = require('../electron/backendArchive');

const projectRoot = path.join(__dirname, '..');
const resourcesDir = path.join(projectRoot, 'resources');
const javaBin = path.join(resourcesDir, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
const launch = buildTrainingLaunch(resourcesDir);
const archivePath = path.join(launch.cwd, APP_ARCHIVE);
const token = crypto.randomBytes(24).toString('hex');

const PORT_TIMEOUT_MS = 120000;
const EXIT_TIMEOUT_MS = 60000;
const REQUEST_TIMEOUT_MS = 30000;

function waitForPort(child, log) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`training backend did not report a port within ${PORT_TIMEOUT_MS / 1000}s`)), PORT_TIMEOUT_MS);
    const onData = () => {
      const match = log.text.match(/NEXTTYPROA_PORT=(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`training backend exited with code ${code} before reporting a port`));
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    const timer = setTimeout(() => reject(new Error(`training backend did not exit within ${EXIT_TIMEOUT_MS / 1000}s after its parent was gone`)), EXIT_TIMEOUT_MS);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function makeClient(port) {
  const base = `http://127.0.0.1:${port}`;
  return async function call(method, pathname, body, expectedStatus = 200) {
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: { 'X-Auth-Token': token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const isJson = (res.headers.get('content-type') || '').includes('json');
    const payload = isJson ? await res.text() : Buffer.from(await res.arrayBuffer());
    assert.equal(res.status, expectedStatus, `${method} ${pathname} -> ${res.status} ${isJson ? payload.slice(0, 300) : ''}`);
    return isJson && payload ? JSON.parse(payload) : payload;
  };
}

function flattenTree(nodes, out = []) {
  for (const node of nodes) {
    if (node.directory) flattenTree(node.children || [], out);
    else out.push(node.path);
  }
  return out;
}

const q = encodeURIComponent;

// 渲染进程启动时和日常会调的接口。删除不在这里：它走 Electron 的 shell.trashItem，会进系统回收站。
async function exercise(call, vault, vault2) {
  for (let i = 0; ; i += 1) {
    try {
      await call('GET', '/api/health');
      break;
    } catch (err) {
      if (i >= 40) throw err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  await call('GET', '/api/workspace');
  const files = flattenTree(await call('GET', '/api/tree'));
  const notes = files.filter((file) => file.endsWith('.md'));
  assert.ok(notes.length >= 10, `expected the e2e-vault notes in the tree, got ${files.join(', ')}`);

  for (let i = 0; ; i += 1) {
    const status = await call('GET', '/api/search/status');
    if (status.lastIndexedAt != null && !status.indexing) break;
    if (i >= 120) throw new Error(`startup reindex never finished: ${JSON.stringify(status)}`);
    await new Promise((r) => setTimeout(r, 250));
  }

  // 每种编码、每篇笔记都打开一次（GBK、Big5、Shift_JIS、UTF-8 带不带 BOM、UTF-16、空文件、frontmatter）
  for (const note of notes) await call('GET', `/api/note?path=${q(note)}`);
  for (const image of files.filter((file) => file.endsWith('.png'))) await call('GET', `/api/asset?path=${q(image)}`);
  await call('GET', `/api/note?path=${q('不存在.md')}`, undefined, 404);

  for (const query of ['笔记', 'table', '繁體', 'frontmatter']) {
    await call('GET', `/api/search?q=${q(query)}&sort=relevance&limit=20&offset=0`);
  }
  await call('GET', `/api/search?q=${q('笔记')}&sort=updated&limit=20&offset=0&scope=title,frontmatter`);

  // 新建、自动保存、冲突、按原编码保存
  await call('POST', '/api/files/folder', { path: '训练目录' });
  const created = await call('POST', '/api/note', { path: '训练目录/新笔记.md', content: '# 新笔记\n' });
  const saved = await call('PUT', '/api/note', { path: '训练目录/新笔记.md', content: '# 新笔记\n\n自动保存\n', baseHash: created.contentHash, force: false });
  await call('PUT', '/api/note', { path: '训练目录/新笔记.md', content: '冲突', baseHash: created.contentHash, force: false }, 409);
  await call('PUT', '/api/note', { path: '训练目录/新笔记.md', content: '# 强制保存\n', baseHash: saved.contentHash, force: true });
  for (const legacy of ['编码/gbk.md', '编码/big5.md', '编码/utf16.md']) {
    const note = await call('GET', `/api/note?path=${q(legacy)}`);
    await call('PUT', '/api/note', { path: legacy, content: `${note.content}\n训练`, baseHash: note.contentHash, force: false });
  }

  for (const note of ['ascii-notes.md', '数学公式.md', '读书笔记/frontmatter.md']) {
    await call('POST', '/api/export/html', { path: note });
  }

  await call('PUT', '/api/files/rename', { path: '训练目录/新笔记.md', newName: '改名.md' });
  await call('PUT', '/api/files/move', { path: '训练目录/改名.md', targetFolder: '日记' });
  await call('POST', '/api/tree/refresh');
  await call('GET', '/api/maintenance/legacy-backups');

  // 切换工作区再切回来
  await call('POST', '/api/workspace', { path: vault2 });
  await call('GET', '/api/tree');
  await call('POST', '/api/workspace', { path: vault });
  await call('GET', '/api/tree');
}

async function main() {
  assert.ok(fs.existsSync(javaBin), `Bundled Java runtime not found: ${javaBin} (run node scripts/prepare-jre.js)`);
  assert.ok(fs.existsSync(launch.jarPath), `Backend jar not found: ${launch.jarPath} (run node scripts/copy-backend-jar.js)`);
  fs.rmSync(archivePath, { force: true });
  fs.rmSync(path.join(launch.cwd, RECORD_FILE), { force: true });
  // 安装后 main.js 要把 jar 的修改时间改回生成缓存时的值，而 Windows 上的 HotSpot 比得比整秒还细、
  // Node 只能精确设置整秒，所以先截成整秒再训练（见 electron/backendArchive.js）
  truncateJarTimes(launch.cwd);

  // 工作区用 e2e-vault 的副本，训练会往里写，不能写进 test/
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexttyproa-cds-training-'));
  const vault = path.join(tempRoot, 'vault');
  const vault2 = path.join(tempRoot, 'vault-2');
  fs.cpSync(path.join(projectRoot, 'test', 'e2e-vault'), vault, { recursive: true });
  fs.cpSync(path.join(projectRoot, 'test', 'e2e-vault-2'), vault2, { recursive: true });

  const parent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], { stdio: 'ignore', windowsHide: true });
  const log = { text: '' };
  const started = Date.now();
  const backend = spawn(javaBin, launch.args, {
    cwd: launch.cwd,
    env: {
      ...process.env,
      SPRING_PROFILES_ACTIVE: 'embedded',
      SERVER_PORT: '0',
      AUTH_TOKEN: token,
      VAULT_PATH: vault,
      PARENT_PID: String(parent.pid),
      NEXTTYPROA_LOG_FILE: path.join(tempRoot, 'backend.log'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const append = (chunk) => {
    log.text += chunk.toString();
  };
  backend.stdout.on('data', append);
  backend.stderr.on('data', append);

  try {
    const port = await waitForPort(backend, log);
    await exercise(makeClient(port), vault, vault2);
    parent.kill();
    const code = await waitForExit(backend);
    assert.equal(code, 0, `training backend exited with code ${code}`);
  } catch (err) {
    parent.kill();
    if (backend.exitCode === null) {
      backend.kill();
      await waitForExit(backend).catch(() => {});
    }
    console.error(log.text.slice(-4000));
    throw err;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    if (fs.existsSync(tempRoot)) console.warn(`Could not remove ${tempRoot}; delete it by hand.`);
  }

  const size = fs.existsSync(archivePath) ? fs.statSync(archivePath).size : 0;
  assert.ok(size > 1024 * 1024, `${archivePath} was not written (size ${size}):\n${log.text.slice(-4000)}`);
  // JVM 把写出的缓存标成只读。和 prepare-jre.js 对 classes.jsa 的处理一样去掉只读位，免得覆盖安装、
  // 卸载时碰上只读文件。JVM 只读取、映射这个文件。
  fs.chmodSync(archivePath, 0o644);
  const record = recordArchiveJars(launch.cwd);

  const warnings = (log.text.match(/Preload Warning/g) || []).length;
  console.log(`App class archive ready: ${archivePath} (${(size / 1024 / 1024).toFixed(1)}MB, `
    + `${record.jars.length} jars recorded in ${RECORD_FILE}, ${((Date.now() - started) / 1000).toFixed(1)}s, `
    + `${warnings} expected Preload Warnings)`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
