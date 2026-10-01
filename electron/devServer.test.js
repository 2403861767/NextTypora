const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const projectRoot = path.join(__dirname, '..');
const frontendDir = path.join(projectRoot, 'frontend');

/** Electron 开发模式下加载的前端地址（main.js 里 isDev 分支的 loadURL） */
function electronDevUrl() {
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const match = source.match(/mainWindow\.loadURL\('(http:\/\/[^']+)'\)/);
  assert.ok(match, 'main.js loads the dev frontend from an http URL');
  return new URL(match[1]);
}

/** npm run dev:electron 在启动 Electron 之前用 wait-on 等待的前端地址 */
function waitOnFrontendUrl() {
  const script = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).scripts['dev:electron'];
  const frontendUrl = (script.match(/https?:\/\/[^\s"&]+/g) ?? [])
    .map((url) => new URL(url))
    .find((url) => !url.pathname.startsWith('/api'));
  assert.ok(frontendUrl, 'dev:electron waits for the frontend dev server');
  return frontendUrl;
}

/** 用 Vite 自己的 resolveConfig 得到 `npm run dev:frontend` 实际生效的 server 选项 */
async function viteDevServerOptions() {
  const viteDir = path.join(frontendDir, 'node_modules', 'vite');
  const vitePackage = JSON.parse(fs.readFileSync(path.join(viteDir, 'package.json'), 'utf8'));
  const { resolveConfig } = await import(pathToFileURL(path.join(viteDir, vitePackage.exports['.'].import)).href);
  const config = await resolveConfig(
    { root: frontendDir, configFile: path.join(frontendDir, 'vite.config.ts'), logLevel: 'silent' },
    'serve',
  );
  return config.server;
}

// BUG_BACKLOG_REAL_WORLD.md RW-P2-010：Vite 没有设置 host 时监听 localhost，Node 17+ 在 Windows 上把它解析成 ::1，
// 而 Electron dev 和 wait-on 连接的是 127.0.0.1:5173：窗口一片空白，npm run dev 一直卡在 wait-on
test('RW-P2-010: the Vite dev server listens on the address Electron dev and wait-on connect to', async () => {
  const electronUrl = electronDevUrl();
  const waitOnUrl = waitOnFrontendUrl();
  const server = await viteDevServerOptions();

  assert.equal(waitOnUrl.host, electronUrl.host, 'wait-on and Electron use the same address');
  assert.equal(server.host, electronUrl.hostname, 'Vite binds the host Electron loads');
  assert.equal(String(server.port), electronUrl.port, 'Vite binds the port Electron loads');
  assert.equal(server.strictPort, true, 'Vite must not silently move to another port');
});
