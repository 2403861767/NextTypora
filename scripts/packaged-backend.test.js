// Runs the backend on the bundled runtime (resources/jre + resources/backend.jar), spawned the
// same way electron/main.js does in the packaged app. Unit tests run on the full JDK and cannot
// see modules missing from the jlink image (RW-P0-001: no jdk.charsets -> no Big5).
// NEXTTYPROA_RESOURCES_DIR=release/win-unpacked/resources checks an unpacked build instead.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const resourcesDir = path.resolve(process.env.NEXTTYPROA_RESOURCES_DIR || path.join(__dirname, '..', 'resources'));
const javaBin = path.join(resourcesDir, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
const jarPath = path.join(resourcesDir, 'backend.jar');
const token = crypto.randomBytes(24).toString('hex');

// Same text as FileServiceTest's legacy cases, encoded by the full JDK.
const GBK_TEXT = '# 标题\n中文内容';
const GBK_BYTES = Buffer.from('2320b1eacce20ad6d0cec4c4dac8dd', 'hex');
const BIG5_TEXT = '# 筆記\n這是一個繁體中文的測試文件，內容包含標點符號。';
const BIG5_BYTES = Buffer.from(
  '2320b5a7b04f0ab36fac4fa440add3c163c5e9a4a4a4e5aabab4fab8d5a4e5a5f3a141a4baae65a55da774bcd0c249b2c5b8b9a143',
  'hex',
);
const SJIS_TEXT = '# メモ\n日本語のテストファイルです。';
const SJIS_BYTES = Buffer.from('2320838183820a93fa967b8cea82cc836583588367837483408343838b82c582b78142', 'hex');
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const ASCII_TEXT = '# ASCII notes\n\nplain utf8 without bom packagedsearchtoken\n';
const CJK_TEXT = '# 学习笔记\n中文内容';
const BOM_TEXT = '# BOM note\n带 BOM 的笔记';

const fixtures = {
  'ascii-notes.md': Buffer.from(ASCII_TEXT, 'utf8'),
  '日记/中文笔记.md': Buffer.from(CJK_TEXT, 'utf8'),
  '空文件.md': Buffer.alloc(0),
  '编码/gbk.md': GBK_BYTES,
  '编码/big5.md': BIG5_BYTES,
  '编码/sjis.md': SJIS_BYTES,
  '编码/utf8-bom.md': Buffer.concat([UTF8_BOM, Buffer.from(BOM_TEXT, 'utf8')]),
  'pkg-test.md': Buffer.from('# pkg test\n', 'utf8'),
};

let tempRoot;
let vault;
let vault2;
let backend;
let backendLog = '';
let baseUrl;

function decode(encoding, bytes) {
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

function writeFixtures(root, files) {
  for (const [relative, bytes] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
}

async function api(method, pathname, body) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'X-Auth-Token': token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body; keep text for assertion messages
  }
  return { status: res.status, json, text };
}

function noteUrl(relative) {
  return `/api/note?path=${encodeURIComponent(relative)}`;
}

async function openNote(relative) {
  const res = await api('GET', noteUrl(relative));
  assert.equal(res.status, 200, `GET ${relative} -> ${res.status} ${res.text}`);
  return res.json;
}

function startBackend() {
  return new Promise((resolve, reject) => {
    backend = spawn(javaBin, ['-jar', jarPath], {
      env: {
        ...process.env,
        SPRING_PROFILES_ACTIVE: 'embedded',
        SERVER_PORT: '0',
        AUTH_TOKEN: token,
        VAULT_PATH: vault,
        PARENT_PID: String(process.pid),
        NEXTTYPROA_LOG_FILE: path.join(tempRoot, 'backend.log'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const timer = setTimeout(() => reject(new Error(`Backend did not report a port within 60s:\n${backendLog.slice(-2000)}`)), 60000);
    const onData = (chunk) => {
      backendLog += chunk.toString();
      const match = backendLog.match(/NEXTTYPROA_PORT=(\d+)/);
      if (match && !baseUrl) {
        baseUrl = `http://127.0.0.1:${match[1]}`;
        clearTimeout(timer);
        resolve();
      }
    };
    backend.stdout.on('data', onData);
    backend.stderr.on('data', onData);
    backend.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    backend.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Backend exited with code ${code}:\n${backendLog.slice(-2000)}`));
    });
  });
}

async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last.done) return last.value;
    await new Promise((r) => setTimeout(r, 250));
  }
  return last.value;
}

before(async () => {
  assert.ok(fs.existsSync(javaBin), `Bundled Java runtime not found: ${javaBin} (run npm run prepare:resources)`);
  assert.ok(fs.existsSync(jarPath), `Backend jar not found: ${jarPath} (run npm run prepare:resources)`);

  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexttyproa-packaged-'));
  vault = path.join(tempRoot, '工作区');
  vault2 = path.join(tempRoot, '第二工作区');
  writeFixtures(vault, fixtures);
  fs.mkdirSync(path.join(vault, '新目录'));
  writeFixtures(vault2, { '第二篇.md': Buffer.from('# 第二工作区\n普通 UTF-8 笔记', 'utf8') });

  for (const [encoding, bytes, text] of [['gbk', GBK_BYTES, GBK_TEXT], ['big5', BIG5_BYTES, BIG5_TEXT], ['shift_jis', SJIS_BYTES, SJIS_TEXT]]) {
    assert.equal(decode(encoding, bytes), text, `fixture bytes are not ${encoding}`);
  }

  await startBackend();
  const healthy = await waitFor(async () => {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      return { done: res.ok, value: res.ok };
    } catch {
      return { done: false, value: false };
    }
  }, 60000);
  assert.ok(healthy, `Backend never became healthy:\n${backendLog.slice(-2000)}`);
});

after(async () => {
  if (backend && backend.exitCode === null) {
    backend.removeAllListeners('exit');
    const exited = new Promise((resolve) => backend.once('exit', resolve));
    backend.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10000))]);
  }
  if (tempRoot) {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('startup reindex covers every note in the workspace', async () => {
  const status = await waitFor(async () => {
    const res = await api('GET', '/api/search/status');
    const done = res.status === 200 && res.json.lastIndexedAt != null && !res.json.indexing;
    return { done, value: res.json };
  }, 15000);

  assert.ok(status.lastIndexedAt, `startup reindex never finished: ${JSON.stringify(status)}`);
  assert.equal(status.indexedFiles, Object.keys(fixtures).length, JSON.stringify(status));
  assert.equal(status.failedFiles, 0, JSON.stringify(status));
  assert.doesNotMatch(backendLog, /Failed to reindex vault at startup/);
});

test('opens a UTF-8 note without BOM', async () => {
  const note = await openNote('ascii-notes.md');
  assert.equal(note.encoding, 'UTF-8');
  assert.equal(note.hasBom, false);
  assert.equal(note.content, ASCII_TEXT);
});

test('opens a UTF-8 CJK note without BOM and an empty note', async () => {
  const cjk = await openNote('日记/中文笔记.md');
  assert.equal(cjk.encoding, 'UTF-8');
  assert.equal(cjk.content, CJK_TEXT);

  const empty = await openNote('空文件.md');
  assert.equal(empty.encoding, 'UTF-8');
  assert.equal(empty.content, '');
});

test('opens GBK, Big5 and Shift_JIS notes with the detected encoding', async () => {
  for (const [relative, encoding, text] of [
    ['编码/gbk.md', 'GBK', GBK_TEXT],
    ['编码/big5.md', 'Big5', BIG5_TEXT],
    ['编码/sjis.md', 'Shift_JIS', SJIS_TEXT],
  ]) {
    const note = await openNote(relative);
    assert.equal(note.encoding, encoding, relative);
    assert.equal(note.content, text, relative);
  }
});

test('opens a UTF-8 note with BOM', async () => {
  const note = await openNote('编码/utf8-bom.md');
  assert.equal(note.encoding, 'UTF-8');
  assert.equal(note.hasBom, true);
  assert.equal(note.content, BOM_TEXT);
});

test('creates a note and auto-saves an edit with its baseHash', async () => {
  const relative = '打包版新笔记.md';
  const created = await api('POST', '/api/note', { path: relative, content: '# 打包版新笔记\n' });
  assert.equal(created.status, 200, created.text);

  const edited = '# 打包版新笔记\n\n自动保存的内容 packagedsavetoken\n';
  const saved = await api('PUT', '/api/note', { path: relative, content: edited, baseHash: created.json.contentHash });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(fs.readFileSync(path.join(vault, relative), 'utf8'), edited);

  const reopened = await openNote(relative);
  assert.equal(reopened.content, edited);
  assert.equal(reopened.contentHash, saved.json.contentHash);
});

test('saves an edit to a Big5 note back in Big5', async () => {
  const relative = '编码/big5.md';
  const note = await openNote(relative);
  const edited = `${note.content}\n測試`;

  const saved = await api('PUT', '/api/note', { path: relative, content: edited, baseHash: note.contentHash });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.encoding, 'Big5');
  assert.equal(decode('big5', fs.readFileSync(path.join(vault, relative))), edited);
});

test('search finds notes by body text, including legacy-encoded ones', async () => {
  for (const [query, expected] of [['packagedsearchtoken', 'ascii-notes.md'], ['繁體中文', '编码/big5.md']]) {
    const res = await api('GET', `/api/search?q=${encodeURIComponent(query)}`);
    assert.equal(res.status, 200, res.text);
    assert.ok(res.json.results.some((r) => r.path === expected), `${query}: ${res.text}`);
  }
});

test('tree refresh succeeds', async () => {
  const refreshed = await api('POST', '/api/tree/refresh');
  assert.equal(refreshed.status, 200, refreshed.text);
});

test('rename and move succeed', async () => {
  const renamed = await api('PUT', '/api/files/rename', { path: 'pkg-test.md', newName: 'pkg-renamed.md' });
  assert.equal(renamed.status, 200, renamed.text);
  assert.ok(fs.existsSync(path.join(vault, 'pkg-renamed.md')));

  const moved = await api('PUT', '/api/files/move', { path: 'pkg-renamed.md', targetFolder: '新目录' });
  assert.equal(moved.status, 200, moved.text);
  assert.ok(fs.existsSync(path.join(vault, '新目录', 'pkg-renamed.md')));
  assert.ok(!fs.existsSync(path.join(vault, 'pkg-renamed.md')));
});

test('exports a UTF-8 note to HTML', async () => {
  const res = await api('POST', '/api/export/html', { path: 'ascii-notes.md' });
  assert.equal(res.status, 200, res.text);
  assert.match(res.json.html, /packagedsearchtoken/);
});

test('switches to another workspace', async () => {
  const res = await api('POST', '/api/workspace', { path: vault2 });
  assert.equal(res.status, 200, res.text);

  const current = await api('GET', '/api/workspace');
  assert.equal(path.resolve(current.json.path), path.resolve(vault2));
  const note = await openNote('第二篇.md');
  assert.equal(note.content, '# 第二工作区\n普通 UTF-8 笔记');
});
