const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  sanitizeSettingsPatch,
  sanitizeWorkspacePath,
  sanitizeOpenedFile,
  sanitizeSaveDialogOptions,
  sanitizePicGoConfig,
  sanitizePicGoUpload,
  resolveTrashTarget,
} = require('./ipcValidation');
const { loadSettings, patchSettings } = require('./settings');

const workspace = path.resolve('vault-中文');

// Node 24 的 fs.rmSync 在 Windows 的中文路径上可能什么都不删，这里逐项删除
function removeTree(target) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat) return;
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    for (const entry of fs.readdirSync(target)) removeTree(path.join(target, entry));
    fs.rmdirSync(target);
  } else if (stat.isSymbolicLink() && process.platform === 'win32') {
    // 目录联接（junction）在 Windows 上要按目录删除
    try {
      fs.rmdirSync(target);
    } catch {
      fs.unlinkSync(target);
    }
  } else {
    fs.unlinkSync(target);
  }
}

/** 临时工作区：日记/图片笔记.md、项目2026/（含备份目录）以及工作区外的一个文件 */
function trashFixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nexttyproa-trash-'));
  t.after(() => removeTree(base));
  const vault = path.join(base, 'vault');
  fs.mkdirSync(path.join(vault, '日记'), { recursive: true });
  fs.mkdirSync(path.join(vault, '项目2026', '.nexttyproa-backups'), { recursive: true });
  fs.writeFileSync(path.join(vault, '日记', '图片笔记.md'), '# 图片笔记');
  fs.writeFileSync(path.join(vault, '项目2026', '需求 v1.2.md'), '# 需求');
  fs.mkdirSync(path.join(base, 'outside'));
  fs.writeFileSync(path.join(base, 'outside', 'secret.md'), 'secret');
  return { base, vault };
}

test('settings patch keeps every field the renderer legitimately sends', () => {
  const patch = {
    lastWorkspace: workspace,
    lastOpenedFile: { folder: workspace, relativePath: 'notes/笔记.md' },
    imageUploadMode: 'picgo',
    picgoServerUrl: 'http://127.0.0.1:36677',
    picgoSecret: '',
    spellCheckEnabled: true,
    fileTreeExpandedFolders: { [workspace]: ['notes', 'notes/sub'] },
    themeId: 'sepia',
    editorThemeId: 'github',
    customCss: 'body { color: red; }',
    shortcuts: { save: ['Ctrl+S'] },
    recentFiles: [{ folder: workspace, relativePath: 'a.md', title: 'A', openedAt: '2026-09-24T00:00:00.000Z' }],
    recentWorkspaces: [{ path: workspace, openedAt: '2026-09-24T00:00:00.000Z' }],
    openTabs: [{ id: 'a.md', path: 'a.md', title: 'A' }, { id: 'b.md', path: 'b.md', title: 'B', missing: true }],
    activeTabPath: 'a.md',
    openTabsWorkspace: workspace,
    writingModes: { focusMode: true, typewriterMode: false, distractionFreeMode: false },
  };

  assert.deepEqual(sanitizeSettingsPatch(patch), patch);
});

test('settings patch drops unknown keys and unknown nested fields', () => {
  const result = sanitizeSettingsPatch({
    themeId: 'sepia',
    isAdmin: true,
    backendJar: 'C:/evil.jar',
    openTabs: [{ id: 'a.md', path: 'a.md', title: 'A', content: 'full text', loadedContent: 'x' }],
  });

  assert.deepEqual(result, { themeId: 'sepia', openTabs: [{ id: 'a.md', path: 'a.md', title: 'A' }] });
});

test('settings patch treats null and undefined as removal', () => {
  const result = sanitizeSettingsPatch({ lastOpenedFile: undefined, activeTabPath: null });

  assert.ok(Object.hasOwn(result, 'lastOpenedFile'));
  assert.equal(result.lastOpenedFile, undefined);
  assert.equal(result.activeTabPath, undefined);
});

test('settings patch rejects prototype pollution attempts at any depth', () => {
  const attempts = [
    { __proto__: { isAdmin: true } },
    JSON.parse('{"__proto__": {"isAdmin": true}}'),
    JSON.parse('{"constructor": {"prototype": {"isAdmin": true}}}'),
    { shortcuts: JSON.parse('{"__proto__": ["Ctrl+X"]}') },
    { fileTreeExpandedFolders: JSON.parse('{"prototype": ["a"]}') },
    { writingModes: JSON.parse('{"__proto__": {"focusMode": true}}') },
    { recentFiles: [{ ...JSON.parse('{"__proto__": {}}'), folder: workspace, relativePath: 'a.md', openedAt: 'now' }] },
  ];

  for (const attempt of attempts) {
    assert.throws(() => sanitizeSettingsPatch(attempt), TypeError);
  }
  assert.equal({}.isAdmin, undefined);
  assert.equal(Object.prototype.isAdmin, undefined);
});

test('settings patch rejects values of the wrong type', () => {
  const invalidPatches = [
    null,
    'themeId=sepia',
    [],
    new Date(),
    { spellCheckEnabled: 'yes' },
    { imageUploadMode: 'ftp' },
    { lastWorkspace: 'relative/path' },
    { lastWorkspace: 42 },
    { lastOpenedFile: { folder: workspace } },
    { openTabs: [{ id: 1, path: 'a.md', title: 'A' }] },
    { openTabs: 'a.md' },
    { openTabsWorkspace: 'relative/path' },
    { recentWorkspaces: [{ path: workspace }] },
    { shortcuts: { save: 'Ctrl+S' } },
    { writingModes: { focusMode: 'on' } },
    { customCss: 'x'.repeat(2 * 1024 * 1024 + 1) },
  ];

  for (const patch of invalidPatches) {
    assert.throws(() => sanitizeSettingsPatch(patch), TypeError, JSON.stringify(patch)?.slice(0, 80));
  }
});

test('patchSettings persists validated values and removes undefined keys', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nexttyproa-settings-'));
  try {
    patchSettings(userData, sanitizeSettingsPatch({
      themeId: 'sepia',
      lastOpenedFile: { folder: workspace, relativePath: 'a.md' },
    }));
    const next = patchSettings(userData, sanitizeSettingsPatch({ lastOpenedFile: undefined, spellCheckEnabled: true }));

    assert.deepEqual(next, { themeId: 'sepia', spellCheckEnabled: true });
    assert.deepEqual(loadSettings(userData), { themeId: 'sepia', spellCheckEnabled: true });
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('loadSettings ignores a settings file that is not a JSON object', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nexttyproa-settings-'));
  try {
    fs.writeFileSync(path.join(userData, 'settings.json'), '["not", "an", "object"]');
    assert.deepEqual(loadSettings(userData), {});
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('workspace and opened-file payloads require absolute folders', () => {
  assert.equal(sanitizeWorkspacePath(workspace), workspace);
  assert.throws(() => sanitizeWorkspacePath('relative'), TypeError);
  assert.throws(() => sanitizeWorkspacePath({ path: workspace }), TypeError);

  assert.deepEqual(
    sanitizeOpenedFile({ folder: workspace, relativePath: 'a.md', extra: 'dropped' }),
    { folder: workspace, relativePath: 'a.md' },
  );
  assert.throws(() => sanitizeOpenedFile({ folder: 'relative', relativePath: 'a.md' }), TypeError);
});

test('save dialog options keep only title, defaultPath and filters', () => {
  const options = sanitizeSaveDialogOptions({
    title: '导出为 HTML',
    defaultPath: 'note.html',
    filters: [{ name: 'HTML', extensions: ['html'] }],
    properties: ['showHiddenFiles', 'createDirectory'],
    securityScopedBookmarks: true,
  });

  assert.deepEqual(options, {
    title: '导出为 HTML',
    defaultPath: 'note.html',
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  assert.deepEqual(sanitizeSaveDialogOptions(undefined), {});
  assert.throws(() => sanitizeSaveDialogOptions({ filters: [{ name: 'HTML', extensions: 'html' }] }), TypeError);
  assert.throws(() => sanitizeSaveDialogOptions('note.html'), TypeError);
});

test('PicGo config only allows http(s) servers', () => {
  assert.deepEqual(sanitizePicGoConfig({}), { serverUrl: 'http://127.0.0.1:36677', secret: '' });
  assert.deepEqual(
    sanitizePicGoConfig({ serverUrl: ' https://picgo.local:36677// ', secret: 's3cret' }),
    { serverUrl: 'https://picgo.local:36677', secret: 's3cret' },
  );

  for (const serverUrl of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'not a url', 42]) {
    assert.throws(() => sanitizePicGoConfig({ serverUrl }), TypeError, String(serverUrl));
  }
  assert.throws(() => sanitizePicGoConfig(undefined), TypeError);
  assert.throws(() => sanitizePicGoConfig({ secret: { toString: () => 'x' } }), TypeError);
});

test('PicGo upload requires binary data and sanitizes filename and MIME type', () => {
  const upload = sanitizePicGoUpload({
    buffer: new Uint8Array([1, 2, 3]).buffer,
    filename: '..\\..\\Windows\\evil.png',
    mimeType: 'image/png\r\nX-Injected: 1',
  });

  assert.equal(upload.filename, 'evil.png');
  assert.equal(upload.mimeType, 'application/octet-stream');
  assert.equal(upload.serverUrl, 'http://127.0.0.1:36677');
  assert.equal(upload.buffer.byteLength, 3);

  assert.equal(sanitizePicGoUpload({ buffer: new Uint8Array(1), mimeType: 'image/webp' }).mimeType, 'image/webp');
  assert.equal(sanitizePicGoUpload({ buffer: new Uint8Array(1) }).filename, 'image.png');
  assert.throws(() => sanitizePicGoUpload({ buffer: 'AAAA' }), TypeError);
  assert.throws(() => sanitizePicGoUpload({ buffer: [1, 2, 3] }), TypeError);
});

// BUG_BACKLOG_REAL_WORLD.md RW-P2-008：删除改为移到系统回收站，主进程只接受当前工作区之内的相对路径
test('trash target resolves a workspace-relative file or folder to its absolute path', (t) => {
  const { vault } = trashFixture(t);

  assert.equal(resolveTrashTarget(vault, '日记/图片笔记.md'), path.join(vault, '日记', '图片笔记.md'));
  assert.equal(resolveTrashTarget(vault, '项目2026'), path.join(vault, '项目2026'));
  assert.equal(resolveTrashTarget(`${vault}${path.sep}`, '项目2026/需求 v1.2.md'), path.join(vault, '项目2026', '需求 v1.2.md'));
});

test('trash target rejects anything that is not strictly inside the workspace', (t) => {
  const { base, vault } = trashFixture(t);

  const escapes = [
    '',
    '   ',
    '.',
    '日记/..',
    '..',
    '../outside/secret.md',
    '日记/../../outside/secret.md',
    path.join(base, 'outside', 'secret.md'),
    path.join(vault, '日记', '图片笔记.md'),
    '日记/图片笔记.md\0.txt',
    42,
    null,
    { path: '日记/图片笔记.md' },
  ];
  for (const relativePath of escapes) {
    assert.throws(() => resolveTrashTarget(vault, relativePath), TypeError, JSON.stringify(relativePath));
  }

  assert.throws(() => resolveTrashTarget('', '日记/图片笔记.md'), TypeError);
  assert.throws(() => resolveTrashTarget(undefined, '日记/图片笔记.md'), TypeError);
  assert.throws(() => resolveTrashTarget('relative-vault', '日记/图片笔记.md'), TypeError);
});

test('trash target must exist', (t) => {
  const { vault } = trashFixture(t);

  assert.throws(() => resolveTrashTarget(vault, '日记/不存在.md'), /路径不存在/);
  assert.throws(() => resolveTrashTarget(vault, '没有这个目录/a.md'), /路径不存在/);
});

test('trash target refuses symbolic links and junctions, which may point outside the workspace', (t) => {
  const { base, vault } = trashFixture(t);
  const link = path.join(vault, 'link');
  try {
    fs.symlinkSync(path.join(base, 'outside'), link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`cannot create a link on this machine: ${error.message}`);
    return;
  }

  assert.throws(() => resolveTrashTarget(vault, 'link/secret.md'), TypeError);
  assert.throws(() => resolveTrashTarget(vault, 'link'), TypeError);
  assert.equal(fs.existsSync(path.join(base, 'outside', 'secret.md')), true);
});
