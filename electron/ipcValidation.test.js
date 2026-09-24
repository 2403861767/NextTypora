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
} = require('./ipcValidation');
const { loadSettings, patchSettings } = require('./settings');

const workspace = path.resolve('vault-中文');

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
