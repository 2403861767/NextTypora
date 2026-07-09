const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { loadSettings, patchSettings } = require('./settings');

const isDev = !app.isPackaged;
let mainWindow = null;
let splashWindow = null;
let backendProcess = null;
let backendConfig = { port: 8080, token: 'dev-token-change-me' };
let pendingOpenFile = null;
let pageReady = false;
let quitting = false;
let flushSaveTimeout = null;

const gotLock = app.requestSingleInstanceLock();
if (process.platform === 'win32') {
  app.setAppUserModelId('com.nexttyproa.app');
}
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else if (splashWindow) {
      splashWindow.focus();
    }
    const filePath = extractMarkdownFromArgs(argv);
    if (filePath) {
      queueOpenFile(filePath);
    }
  });
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  queueOpenFile(filePath);
});

function extractMarkdownFromArgs(argv) {
  return argv.find((arg) => {
    if (!arg || arg.startsWith('-')) return false;
    const lower = arg.toLowerCase();
    return lower.endsWith('.md') || lower.endsWith('.markdown');
  }) || null;
}

function queueOpenFile(filePath) {
  if (!filePath) return;
  pendingOpenFile = filePath;
  deliverOpenFileIfReady();
}

function deliverOpenFileIfReady() {
  if (!pageReady || !mainWindow || mainWindow.isDestroyed()) return;

  let fileToOpen = pendingOpenFile;
  pendingOpenFile = null;

  if (!fileToOpen) {
    fileToOpen = extractMarkdownFromArgs(process.argv);
  }

  if (fileToOpen) {
    mainWindow.webContents.send('app:open-file', fileToOpen);
  }
}

function getResourcesPath(...segments) {
  if (isDev) {
    return path.join(__dirname, '..', 'resources', ...segments);
  }
  return path.join(process.resourcesPath, ...segments);
}

function resolveJavaBin() {
  const bundled = path.join(getResourcesPath('jre'), 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  return 'java';
}

function resolveFrontendIndex() {
  if (isDev) {
    return null;
  }
  return path.join(app.getAppPath(), 'frontend', 'dist', 'index.html');
}

function resolveAppIcon() {
  const iconPath = isDev
    ? path.join(__dirname, '..', 'build', 'icon.ico')
    : path.join(process.resourcesPath, 'icon.ico');
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 520,
    height: 300,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    icon: resolveAppIcon(),
    resizable: false,
    center: true,
    alwaysOnTop: true,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const html = `
    <!doctype html>
    <html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        height: 100vh;
        display: grid;
        place-items: center;
        background: transparent;
        color: #1f2329;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
        overflow: hidden;
      }
      .splash {
        width: 460px;
        height: 236px;
        position: relative;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 22px 24px;
        border: 1px solid rgba(159, 174, 194, 0.28);
        border-radius: 22px;
        background:
          radial-gradient(circle at 18% 4%, rgba(10, 132, 255, 0.14), transparent 36%),
          linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(239, 244, 250, 0.96));
        box-shadow: 0 28px 70px rgba(56, 72, 92, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.82);
      }
      .traffic { display: flex; gap: 8px; }
      .traffic span {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18);
      }
      .red { background: #ff5f57; }
      .yellow { background: #febc2e; }
      .green { background: #28c840; }
      .brand { display: grid; gap: 10px; justify-items: center; }
      .mark {
        width: 42px;
        height: 42px;
        display: grid;
        place-items: center;
        border-radius: 12px;
        background: linear-gradient(145deg, #5fb2ff, #0a84ff);
        color: #fff;
        font-size: 24px;
        font-weight: 800;
        box-shadow: 0 12px 26px rgba(10, 132, 255, 0.26);
      }
      h1 {
        margin: 0;
        font-size: 30px;
        font-weight: 760;
        letter-spacing: 0;
      }
      p {
        margin: 0;
        color: #687486;
        font-size: 14px;
      }
      .bar {
        height: 5px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(135, 154, 178, 0.22);
      }
      .bar::before {
        content: '';
        display: block;
        width: 42%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #0a84ff, #b8ddff);
        animation: loading 1.15s ease-in-out infinite alternate;
      }
      @keyframes loading {
        from { transform: translateX(-8%); }
        to { transform: translateX(150%); }
      }
    </style></head>
    <body>
      <section class="splash">
        <div class="traffic"><span class="red"></span><span class="yellow"></span><span class="green"></span></div>
        <div class="brand">
          <div class="mark">N</div>
          <h1>NextTypora</h1>
          <p>正在准备你的写作空间...</p>
        </div>
        <div class="bar"></div>
      </section>
    </body></html>
  `;
  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const token = `token-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    backendConfig.token = token;

    if (isDev) {
      backendConfig.port = Number(process.env.BACKEND_PORT || 8080);
      resolve(backendConfig);
      return;
    }

    const javaBin = resolveJavaBin();
    const jarPath = getResourcesPath('backend.jar');

    if (!fs.existsSync(jarPath)) {
      reject(new Error(`Backend jar not found: ${jarPath}`));
      return;
    }

    const settings = loadSettings(app.getPath('userData'));
    const env = {
      ...process.env,
      SPRING_PROFILES_ACTIVE: 'embedded',
      SERVER_PORT: '0',
      AUTH_TOKEN: token,
      VAULT_PATH: settings.lastWorkspace || '',
    };

    backendProcess = spawn(javaBin, ['-jar', jarPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let resolved = false;
    let backendLog = '';
    const timeout = setTimeout(() => {
      if (!resolved) {
        reject(new Error(`后端启动超时（60秒）。\n\n${backendLog.slice(-1500)}`));
      }
    }, 60000);

    const appendLog = (chunk) => {
      backendLog += chunk;
      if (backendLog.length > 8000) backendLog = backendLog.slice(-8000);
    };

    let portReady = false;

    const handleLine = (line) => {
      appendLog(`${line}\n`);
      const portMatch = line.match(/NEXTTYPROA_PORT=(\d+)/);
      const tokenMatch = line.match(/NEXTTYPROA_TOKEN=(.+)/);
      if (portMatch) {
        backendConfig.port = Number(portMatch[1]);
        portReady = true;
      }
      if (tokenMatch) {
        backendConfig.token = tokenMatch[1].trim();
      }
      if (portReady && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(backendConfig);
      }
    };

    backendProcess.stdout.on('data', (data) => {
      data.toString().split(/\r?\n/).forEach((line) => line && handleLine(line));
    });
    backendProcess.stderr.on('data', (data) => {
      data.toString().split(/\r?\n/).forEach((line) => line && handleLine(line));
    });
    backendProcess.on('exit', (code) => {
      if (!resolved) {
        clearTimeout(timeout);
        const hint = backendLog.includes('Access denied')
          ? '数据库连接失败，请检查应用数据目录权限。'
          : backendLog.includes('Communications link failure')
            ? '无法连接数据库服务。'
            : `后端进程异常退出 (code=${code})。`;
        reject(new Error(`${hint}\n\n${backendLog.slice(-1500)}`));
      }
    });
  });
}

async function waitForHealth(port, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function normalizePicGoServerUrl(url) {
  const trimmed = String(url || 'http://127.0.0.1:36677').trim().replace(/\/+$/, '');
  return trimmed || 'http://127.0.0.1:36677';
}

function picGoAuthHeaders(secret) {
  const headers = {};
  if (secret && String(secret).trim()) {
    headers.Authorization = `Bearer ${String(secret).trim()}`;
  }
  return headers;
}

function themesDirectory() {
  const directory = path.join(app.getPath('userData'), 'themes');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function parseThemeMetadata(css, fallbackName) {
  const metadata = {};
  const comment = String(css || '').match(/\/\*([\s\S]*?)\*\//);
  if (comment) {
    comment[1].split(/\r?\n/).forEach((line) => {
      const match = line.replace(/^\s*\*\s?/, '').match(/^@?([\w-]+)\s*:\s*(.+)$/);
      if (match) {
        metadata[match[1].toLowerCase()] = match[2].trim();
      }
    });
  }
  const mode = String(metadata.mode || '').toLowerCase();
  return {
    name: metadata.name || metadata.theme || fallbackName,
    author: metadata.author,
    version: metadata.version,
    mode: ['light', 'dark', 'both'].includes(mode) ? mode : undefined,
    previewColor: metadata['preview-color'] || metadata.preview,
  };
}

function themeRecordFromFile(filePath) {
  const css = fs.readFileSync(filePath, 'utf8');
  const filename = path.basename(filePath);
  const id = filename.replace(/\.css$/i, '');
  return {
    id,
    filename,
    css,
    ...parseThemeMetadata(css, id),
  };
}

function listImportedThemes() {
  const directory = themesDirectory();
  return fs.readdirSync(directory)
    .filter((filename) => filename.toLowerCase().endsWith('.css'))
    .map((filename) => {
      try {
        return themeRecordFromFile(path.join(directory, filename));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function picGoRequest(serverUrl, secret, pathname, options = {}) {
  const base = normalizePicGoServerUrl(serverUrl);
  const headers = { ...picGoAuthHeaders(secret), ...(options.headers || {}) };
  const response = await fetch(`${base}${pathname}`, { ...options, headers });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!response.ok) {
    const message = data.message || response.statusText || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open-file'),
        },
        {
          label: '打开文件夹…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => mainWindow?.webContents.send('menu:open-folder'),
        },
        {
          label: '新建文件',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:create-note'),
        },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        { type: 'separator' },
        {
          label: '导出为 HTML',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => mainWindow?.webContents.send('menu:export-html'),
        },
        {
          label: '导出为 PDF',
          accelerator: 'CmdOrCtrl+Alt+P',
          click: () => mainWindow?.webContents.send('menu:export-pdf'),
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '偏好设置',
      submenu: [
        {
          label: '打开偏好设置…',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu:open-settings'),
        },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '切换源码模式',
          accelerator: 'CmdOrCtrl+/',
          click: () => mainWindow?.webContents.send('menu:toggle-source'),
        },
        {
          label: '显示/隐藏侧边栏',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => mainWindow?.webContents.send('menu:toggle-sidebar'),
        },
        { type: 'separator' },
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
  ];
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    return;
  }
  Menu.setApplicationMenu(null);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#eef2f7',
    icon: resolveAppIcon(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    closeSplashWindow();
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const onPageReady = () => {
    pageReady = true;
    deliverOpenFileIfReady();
  };

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
    mainWindow.webContents.once('did-finish-load', onPageReady);
  } else {
    const indexPath = resolveFrontendIndex();
    mainWindow.loadFile(indexPath)
      .then(onPageReady)
      .catch((err) => {
        closeSplashWindow();
        dialog.showErrorBox('NextTyproa 启动失败', `无法加载界面文件:\n${indexPath}\n\n${err.message}`);
        app.quit();
      });
  }
}

ipcMain.handle('backend:getConfig', () => backendConfig);

ipcMain.handle('settings:get', () => loadSettings(app.getPath('userData')));

ipcMain.handle('settings:setLastWorkspace', (_event, folderPath) => {
  if (!folderPath) return loadSettings(app.getPath('userData'));
  return patchSettings(app.getPath('userData'), { lastWorkspace: folderPath });
});

ipcMain.handle('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  }
  mainWindow.maximize();
  return true;
});

ipcMain.handle('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

ipcMain.handle('settings:rememberOpenedFile', (_event, payload) => {
  if (!payload?.folder || !payload?.relativePath) {
    return loadSettings(app.getPath('userData'));
  }
  return patchSettings(app.getPath('userData'), {
    lastWorkspace: payload.folder,
    lastOpenedFile: {
      folder: payload.folder,
      relativePath: payload.relativePath,
    },
  });
});

ipcMain.handle('settings:patch', (_event, patch) => {
  if (!patch || typeof patch !== 'object') {
    return loadSettings(app.getPath('userData'));
  }
  return patchSettings(app.getPath('userData'), patch);
});

ipcMain.handle('themes:list', () => listImportedThemes());

ipcMain.handle('themes:openDirectory', async () => {
  const directory = themesDirectory();
  await shell.openPath(directory);
  return directory;
});

ipcMain.handle('themes:importCss', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: '导入 CSS 主题',
    filters: [
      { name: 'CSS Theme', extensions: ['css'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const sourcePath = result.filePaths[0];
  const targetName = path.basename(sourcePath).replace(/[<>:"/\\|?*]/g, '-');
  const targetPath = path.join(themesDirectory(), targetName);
  await fs.promises.copyFile(sourcePath, targetPath);
  return themeRecordFromFile(targetPath);
});

ipcMain.handle('picgo:heartbeat', async (_event, { serverUrl, secret }) => {
  return picGoRequest(serverUrl, secret, '/heartbeat', { method: 'POST' });
});

ipcMain.handle('picgo:upload', async (_event, { serverUrl, secret, buffer, filename, mimeType }) => {
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
  form.append('files', blob, filename || 'image.png');
  return picGoRequest(serverUrl, secret, '/upload', { method: 'POST', body: form });
});

ipcMain.handle('app:flush-save-done', () => {
  if (flushSaveTimeout) {
    clearTimeout(flushSaveTimeout);
    flushSaveTimeout = null;
  }
  quitting = true;
  app.quit();
});

ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: '打开文件夹',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:selectFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: '打开 Markdown 文件',
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const fullPath = result.filePaths[0];
  const dir = path.dirname(fullPath);
  const relativePath = path.basename(fullPath).replace(/\\/g, '/');
  return { fullPath, dir, relativePath };
});

ipcMain.handle('dialog:showSaveDialog', async (_event, options = {}) => {
  const dialogOptions = options && typeof options === 'object' ? options : {};
  const result = await dialog.showSaveDialog(mainWindow, dialogOptions);
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

ipcMain.handle('file:saveText', async (_event, payload) => {
  const targetPath = typeof payload?.path === 'string' ? payload.path.trim() : '';
  if (!targetPath) {
    throw new Error('保存路径不能为空。');
  }

  const content = typeof payload?.content === 'string' ? payload.content : String(payload?.content ?? '');
  await fs.promises.writeFile(targetPath, content, 'utf8');
  return { path: targetPath };
});

ipcMain.handle('file:revealInExplorer', async (_event, targetPath) => {
  const normalizedPath = typeof targetPath === 'string' ? targetPath.trim() : '';
  if (!normalizedPath) {
    throw new Error('显示路径不能为空。');
  }
  if (!path.isAbsolute(normalizedPath)) {
    throw new Error('只能在资源管理器中显示绝对路径。');
  }
  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`路径不存在：${normalizedPath}`);
  }

  shell.showItemInFolder(normalizedPath);
});

ipcMain.handle('export:pdf', async (_event, payload) => {
  const html = typeof payload?.html === 'string' ? payload.html : '';
  if (!html) {
    throw new Error('导出 PDF 需要 HTML 内容。');
  }

  const defaultPath = typeof payload?.defaultPath === 'string' && payload.defaultPath.trim()
    ? payload.defaultPath.trim()
    : 'document.pdf';
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出为 PDF',
    defaultPath,
    filters: [
      { name: 'PDF', extensions: ['pdf'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) return null;
  const targetPath = result.filePath;

  const exportWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await exportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await waitForMermaidRender(exportWindow);
    const pdf = await exportWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
    });
    await fs.promises.writeFile(targetPath, pdf);
    return { path: targetPath };
  } finally {
    if (!exportWindow.isDestroyed()) {
      exportWindow.destroy();
    }
  }
});

async function waitForMermaidRender(exportWindow) {
  if (!exportWindow || exportWindow.isDestroyed()) return;
  await exportWindow.webContents.executeJavaScript(`
    new Promise((resolve) => {
      if (!document.querySelector('.mermaid')) {
        resolve(true);
        return;
      }

      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (window.__NEXTTYPROA_MERMAID_DONE__ || Date.now() - startedAt > 5000) {
          clearInterval(timer);
          resolve(Boolean(window.__NEXTTYPROA_MERMAID_DONE__));
        }
      }, 100);
    })
  `, true);
}

if (gotLock) {
  app.whenReady().then(async () => {
    createSplashWindow();
    createMenu();
    try {
      await startBackend();
      const healthy = await waitForHealth(backendConfig.port);
      if (!healthy) {
        throw new Error('后端健康检查失败，请稍后重试。');
      }
      createWindow();
    } catch (err) {
      closeSplashWindow();
      dialog.showErrorBox('NextTyproa 启动失败', err.message || String(err));
      app.quit();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (quitting || !mainWindow || mainWindow.isDestroyed()) {
    if (backendProcess && !backendProcess.killed) {
      backendProcess.kill();
    }
    return;
  }
  event.preventDefault();
  mainWindow.webContents.send('app:request-flush-save');
  flushSaveTimeout = setTimeout(() => {
    quitting = true;
    app.quit();
  }, 3000);
});

app.on('will-quit', () => {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
});
