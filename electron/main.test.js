const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// 用一个假的 electron 模块加载真实的 main.js：窗口/应用的生命周期按 Electron 文档建模，
// main.js 里注册的事件处理和 IPC 处理都是真实代码。
const MAIN_PATH = require.resolve('./main');

function cancellableEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

function createFakeElectron() {
  const windows = [];
  const ipcHandlers = new Map();
  const state = {
    quitInProgress: false,
    hasQuit: false,
    messageBoxes: [],
    messageBoxResponse: 0,
    // shell.trashItem 收到的路径（系统回收站的替身）
    trashed: [],
    trashError: null,
  };

  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: false,
    requestSingleInstanceLock: () => true,
    setAppUserModelId: () => undefined,
    whenReady: () => Promise.resolve(),
    getPath: (name) => `fake-${name}`,
    getAppPath: () => __dirname,
    // app.quit()：先发 before-quit（可取消），再依次关闭所有窗口；有窗口没关掉则退出中止
    quit() {
      const event = cancellableEvent();
      app.emit('before-quit', event);
      if (event.defaultPrevented) return;
      state.quitInProgress = true;
      for (const win of [...windows]) win.close();
      if (windows.length > 0) {
        state.quitInProgress = false;
        return;
      }
      app.emit('will-quit', cancellableEvent());
      state.hasQuit = true;
    },
  });

  class FakeBrowserWindow extends EventEmitter {
    constructor(options = {}) {
      super();
      this.options = options;
      this.destroyed = false;
      // 渲染进程（App.tsx）的替身，由测试设置
      this.renderer = null;
      this.webContents = new EventEmitter();
      this.webContents.sent = [];
      this.webContents.send = (channel, ...args) => {
        this.webContents.sent.push(channel);
        this.renderer?.onMessage?.(channel, ...args);
      };
      windows.push(this);
    }

    loadURL() {
      return Promise.resolve();
    }

    loadFile() {
      return Promise.resolve();
    }

    show() {}

    focus() {}

    isDestroyed() {
      return this.destroyed;
    }

    // BrowserWindow.close()：先发 close（可取消）；随后页面的 beforeunload 可以拦下卸载，
    // 这时 webContents 发 will-prevent-unload，只有对它 preventDefault 才会无视页面的拦截继续关闭
    close() {
      if (this.destroyed) return;
      const closeEvent = cancellableEvent();
      this.emit('close', closeEvent);
      if (closeEvent.defaultPrevented) return;
      if (this.renderer?.onBeforeUnload?.()) {
        const unloadEvent = cancellableEvent();
        this.webContents.emit('will-prevent-unload', unloadEvent);
        if (!unloadEvent.defaultPrevented) return;
      }
      this.destroy();
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      windows.splice(windows.indexOf(this), 1);
      this.emit('closed');
      if (windows.length === 0 && !state.quitInProgress) {
        app.emit('window-all-closed');
      }
    }
  }

  const electron = {
    app,
    BrowserWindow: FakeBrowserWindow,
    ipcMain: {
      handle: (channel, handler) => ipcHandlers.set(channel, handler),
    },
    dialog: {
      showErrorBox: () => undefined,
      showMessageBox: async (_window, options) => {
        state.messageBoxes.push(options);
        return { response: state.messageBoxResponse };
      },
      showMessageBoxSync: (_window, options) => {
        state.messageBoxes.push(options);
        return state.messageBoxResponse;
      },
    },
    Menu: {
      setApplicationMenu: () => undefined,
      buildFromTemplate: () => ({}),
    },
    shell: {
      trashItem: async (targetPath) => {
        if (state.trashError) throw state.trashError;
        state.trashed.push(targetPath);
      },
    },
  };

  return { electron, windows, ipcHandlers, state };
}

const nextTick = () => new Promise((resolve) => setImmediate(resolve));

async function settle() {
  for (let i = 0; i < 10; i += 1) await nextTick();
}

/**
 * 启动 main.js 直到主窗口创建完成。
 * renderer.unsaved：编辑器里有还没保存的修改；renderer.saveSucceeds：保存能否成功；
 * pageLoaded=false 表示界面还没加载完（渲染进程还没开始监听主进程的消息）。
 * workspace：后端（GET /api/workspace）报告的当前工作区。
 */
async function bootApp(t, { unsaved = false, saveSucceeds = true, pageLoaded = true, workspace = '' } = {}) {
  const fake = createFakeElectron();
  const originalLoad = Module._load;
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.AUTH_TOKEN;
  process.env.AUTH_TOKEN = 'test-token';
  const backendRequests = [];
  globalThis.fetch = async (url, options = {}) => {
    backendRequests.push({ url: String(url), headers: options.headers ?? {} });
    return { ok: true, status: 200, json: async () => (String(url).endsWith('/api/workspace') ? { path: workspace } : {}) };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.AUTH_TOKEN;
    else process.env.AUTH_TOKEN = originalToken;
    // 没关掉的窗口会留下 main.js 的定时器，拖住测试进程
    for (const win of [...fake.windows]) win.destroy();
    delete require.cache[MAIN_PATH];
  });

  delete require.cache[MAIN_PATH];
  Module._load = function load(request, ...rest) {
    return request === 'electron' ? fake.electron : originalLoad.call(this, request, ...rest);
  };
  try {
    require('./main');
  } finally {
    Module._load = originalLoad;
  }

  let mainWindow;
  for (let i = 0; i < 50 && !mainWindow; i += 1) {
    await nextTick();
    mainWindow = fake.windows.find((win) => win.options.webPreferences?.preload);
  }
  assert.ok(mainWindow, 'main window was created');

  const invoke = (channel, ...args) => {
    const handler = fake.ipcHandlers.get(channel);
    assert.ok(handler, `the main process handles "${channel}"`);
    return handler({ sender: mainWindow.webContents }, ...args);
  };
  const renderer = {
    unsaved,
    saveSucceeds,
    save() {
      if (renderer.saveSucceeds) renderer.unsaved = false;
      return renderer.saveSucceeds;
    },
    // App.tsx 的 beforeunload：有未保存修改时开始保存，并拦下这一次卸载
    onBeforeUnload() {
      if (!renderer.unsaved) return false;
      setImmediate(() => renderer.save());
      return true;
    },
    // App.tsx 的 onRequestFlushSave：保存后把结果告诉主进程
    onMessage(channel) {
      if (channel !== 'app:request-flush-save' || !pageLoaded) return;
      setImmediate(() => {
        const ok = renderer.save();
        void invoke('app:flush-save-done', { ok });
      });
    },
  };
  mainWindow.renderer = renderer;
  if (pageLoaded) {
    mainWindow.emit('ready-to-show');
    mainWindow.webContents.emit('did-finish-load');
  }

  return {
    fake,
    mainWindow,
    renderer,
    invoke,
    backendRequests,
    flushRequests: () => mainWindow.webContents.sent.filter((channel) => channel === 'app:request-flush-save').length,
  };
}

// BUG_BACKLOG_REAL_WORLD.md RW-P2-007：有未保存修改时，第一次点击关闭窗口没有任何反应，要再点一次才会退出
test('RW-P2-007: one click on the close button saves unsaved edits and closes the window', async (t) => {
  const app = await bootApp(t, { unsaved: true });

  await app.invoke('window:close');
  await settle();

  assert.equal(app.mainWindow.isDestroyed(), true, 'the window closed after a single click');
  assert.equal(app.renderer.unsaved, false, 'the edit was saved first');
  assert.equal(app.flushRequests(), 1);
  assert.equal(app.fake.state.hasQuit, true);
  assert.deepEqual(app.fake.state.messageBoxes, []);
});

test('RW-P2-007: when the save fails, closing asks instead of silently doing nothing', async (t) => {
  const app = await bootApp(t, { unsaved: true, saveSucceeds: false });

  // 取消退出：窗口保持打开
  app.fake.state.messageBoxResponse = 0;
  await app.invoke('window:close');
  await settle();

  assert.equal(app.fake.state.messageBoxes.length, 1);
  assert.equal(app.fake.state.messageBoxes[0].title, '保存失败');
  assert.deepEqual(app.fake.state.messageBoxes[0].buttons, ['取消退出', '仍然退出']);
  assert.equal(app.mainWindow.isDestroyed(), false);

  // 再点一次会再问一次；选择“仍然退出”才关闭
  app.fake.state.messageBoxResponse = 1;
  await app.invoke('window:close');
  await settle();

  assert.equal(app.fake.state.messageBoxes.length, 2);
  assert.equal(app.flushRequests(), 2);
  assert.equal(app.mainWindow.isDestroyed(), true);
  assert.equal(app.fake.state.hasQuit, true);
});

test('closing a window with nothing to save still takes one click', async (t) => {
  const app = await bootApp(t, { unsaved: false });

  await app.invoke('window:close');
  await settle();

  assert.equal(app.mainWindow.isDestroyed(), true);
  assert.equal(app.fake.state.hasQuit, true);
  assert.deepEqual(app.fake.state.messageBoxes, []);
});

test('quitting the app asks the renderer to save exactly once', async (t) => {
  const app = await bootApp(t, { unsaved: true });

  app.fake.electron.app.quit();
  await settle();

  assert.equal(app.flushRequests(), 1);
  assert.equal(app.renderer.unsaved, false);
  assert.equal(app.mainWindow.isDestroyed(), true);
  assert.equal(app.fake.state.hasQuit, true);
});

test('a window whose page has not loaded yet closes immediately', async (t) => {
  const app = await bootApp(t, { pageLoaded: false });

  await app.invoke('window:close');
  await settle();

  assert.equal(app.mainWindow.isDestroyed(), true);
  assert.equal(app.flushRequests(), 0);
});

/** 临时工作区：一篇笔记、一个带备份目录的文件夹，以及工作区之外的一个文件 */
function trashWorkspace(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nexttyproa-main-'));
  const vault = path.join(base, 'vault');
  const files = [
    path.join(vault, '日记', '图片笔记.md'),
    path.join(vault, '项目2026', '需求 v1.2.md'),
    path.join(vault, '项目2026', '.nexttyproa-backups', '需求 v1.2.md.2026-09-25T000000-000Z.bak'),
    path.join(base, 'outside.md'),
  ];
  for (const file of files) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'content');
  }
  t.after(() => {
    // Node 24 的 fs.rmSync 在 Windows 的中文路径上可能什么都不删，这里逐项删除
    for (const file of files) fs.unlinkSync(file);
    for (const dir of ['项目2026/.nexttyproa-backups', '项目2026', '日记', '']) fs.rmdirSync(path.join(vault, dir));
    fs.rmdirSync(base);
  });
  return { base, vault };
}

// BUG_BACKLOG_REAL_WORLD.md RW-P2-008：删除是永久删除，没有回收站
test('RW-P2-008: file:trashItem moves a note of the current workspace to the recycle bin', async (t) => {
  const { vault } = trashWorkspace(t);
  const app = await bootApp(t, { workspace: vault });

  await app.invoke('file:trashItem', '日记/图片笔记.md');

  assert.deepEqual(app.fake.state.trashed, [path.join(vault, '日记', '图片笔记.md')]);
  // 工作区根目录以后端为准，而不是渲染进程传来的路径
  const workspaceRequest = app.backendRequests.find((request) => request.url.endsWith('/api/workspace'));
  assert.equal(workspaceRequest?.headers['X-Auth-Token'], 'test-token');
});

test('RW-P2-008: file:trashItem moves a folder as a whole, so its backups stay recoverable', async (t) => {
  const { vault } = trashWorkspace(t);
  const app = await bootApp(t, { workspace: vault });

  await app.invoke('file:trashItem', '项目2026');

  assert.deepEqual(app.fake.state.trashed, [path.join(vault, '项目2026')]);
});

test('RW-P2-008: file:trashItem refuses paths outside the workspace, the workspace itself and missing files', async (t) => {
  const { base, vault } = trashWorkspace(t);
  const app = await bootApp(t, { workspace: vault });

  for (const target of ['../outside.md', path.join(base, 'outside.md'), '', '.', '日记/不存在.md', null]) {
    await assert.rejects(async () => app.invoke('file:trashItem', target), undefined, JSON.stringify(target));
  }

  assert.deepEqual(app.fake.state.trashed, []);
});

test('RW-P2-008: file:trashItem does nothing when no workspace is open', async (t) => {
  trashWorkspace(t);
  const app = await bootApp(t, { workspace: '' });

  await assert.rejects(async () => app.invoke('file:trashItem', '日记/图片笔记.md'));

  assert.deepEqual(app.fake.state.trashed, []);
});

test('RW-P2-008: a recycle bin failure is reported to the renderer', async (t) => {
  const { vault } = trashWorkspace(t);
  const app = await bootApp(t, { workspace: vault });
  app.fake.state.trashError = new Error('Failed to move item to trash');

  await assert.rejects(async () => app.invoke('file:trashItem', '日记/图片笔记.md'), /Failed to move item to trash/);
});
