const path = require('path');

// 渲染进程视为不可信：IPC 入参只接受白名单内、类型正确的数据，其余一律丢弃或拒绝
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_PATH_LENGTH = 32767;
const MAX_TEXT_LENGTH = 4096;
const MAX_CSS_LENGTH = 2 * 1024 * 1024;
const MAX_LIST_ITEMS = 1000;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const DEFAULT_PICGO_SERVER_URL = 'http://127.0.0.1:36677';

function invalid(label, reason) {
  return new TypeError(`Invalid IPC argument "${label}": ${reason}`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function safeEntries(value, label) {
  if (!isPlainObject(value)) {
    throw invalid(label, 'expected a plain object');
  }
  return Object.keys(value).map((key) => {
    if (FORBIDDEN_KEYS.has(key)) {
      throw invalid(label, `forbidden key "${key}"`);
    }
    return [key, value[key]];
  });
}

const string = (max) => (value, label) => {
  if (typeof value !== 'string') throw invalid(label, 'expected a string');
  if (value.length > max) throw invalid(label, `string longer than ${max}`);
  return value;
};

const boolean = (value, label) => {
  if (typeof value !== 'boolean') throw invalid(label, 'expected a boolean');
  return value;
};

const oneOf = (...allowed) => (value, label) => {
  if (!allowed.includes(value)) throw invalid(label, `expected one of ${allowed.join(', ')}`);
  return value;
};

const arrayOf = (item, max = MAX_LIST_ITEMS) => (value, label) => {
  if (!Array.isArray(value)) throw invalid(label, 'expected an array');
  if (value.length > max) throw invalid(label, `more than ${max} items`);
  return value.map((entry, index) => item(entry, `${label}[${index}]`));
};

const recordOf = (item, max = MAX_LIST_ITEMS) => (value, label) => {
  const entries = safeEntries(value, label);
  if (entries.length > max) throw invalid(label, `more than ${max} keys`);
  const result = {};
  for (const [key, entry] of entries) {
    result[key] = item(entry, `${label}.${key}`);
  }
  return result;
};

/** 按字段白名单重建对象：未知字段丢弃，required 字段缺失即拒绝，可选字段为 undefined 时省略。 */
const shape = (fields, required = []) => (value, label) => {
  const input = Object.fromEntries(safeEntries(value, label));
  const result = {};
  for (const [key, validate] of Object.entries(fields)) {
    if (input[key] === undefined) {
      if (required.includes(key)) throw invalid(`${label}.${key}`, 'is required');
      continue;
    }
    result[key] = validate(input[key], `${label}.${key}`);
  }
  return result;
};

const pathString = string(MAX_PATH_LENGTH);
const absolutePath = (value, label) => {
  const checked = pathString(value, label);
  if (!path.isAbsolute(checked)) throw invalid(label, 'expected an absolute path');
  return checked;
};

// 与 frontend/src/types.ts 中的 AppSettings 保持一致
const SETTINGS_FIELDS = {
  lastWorkspace: absolutePath,
  lastOpenedFile: shape({ folder: absolutePath, relativePath: pathString }, ['folder', 'relativePath']),
  imageUploadMode: oneOf('local', 'picgo'),
  picgoServerUrl: string(MAX_TEXT_LENGTH),
  picgoSecret: string(MAX_TEXT_LENGTH),
  spellCheckEnabled: boolean,
  fileTreeExpandedFolders: recordOf(arrayOf(pathString, 10000)),
  themeId: string(256),
  editorThemeId: string(256),
  customCss: string(MAX_CSS_LENGTH),
  shortcuts: recordOf(arrayOf(string(256), 32), 512),
  recentFiles: arrayOf(shape(
    { folder: absolutePath, relativePath: pathString, title: string(MAX_TEXT_LENGTH), openedAt: string(64) },
    ['folder', 'relativePath', 'openedAt'],
  )),
  recentWorkspaces: arrayOf(shape({ path: absolutePath, openedAt: string(64) }, ['path', 'openedAt'])),
  openTabs: arrayOf(shape(
    { id: string(MAX_PATH_LENGTH), path: pathString, title: string(MAX_TEXT_LENGTH), missing: boolean },
    ['id', 'path', 'title'],
  )),
  activeTabPath: pathString,
  writingModes: shape({ focusMode: boolean, typewriterMode: boolean, distractionFreeMode: boolean }),
};

/**
 * Validates a settings:patch payload. Unknown keys are dropped; a known key with a value of the wrong
 * type rejects the whole patch. null/undefined values are kept as undefined, meaning "remove this key".
 */
function sanitizeSettingsPatch(patch) {
  const result = {};
  for (const [key, value] of safeEntries(patch, 'settings')) {
    const validate = SETTINGS_FIELDS[key];
    if (!validate) continue;
    result[key] = value === undefined || value === null ? undefined : validate(value, `settings.${key}`);
  }
  return result;
}

function sanitizeWorkspacePath(folderPath) {
  return absolutePath(folderPath, 'folderPath');
}

function sanitizeOpenedFile(payload) {
  return SETTINGS_FIELDS.lastOpenedFile(payload, 'openedFile');
}

/** Only title/defaultPath/filters reach dialog.showSaveDialog; other Electron options are dropped. */
function sanitizeSaveDialogOptions(options) {
  if (options === undefined || options === null) return {};
  return shape({
    title: string(MAX_TEXT_LENGTH),
    defaultPath: pathString,
    filters: arrayOf(shape({ name: string(256), extensions: arrayOf(string(32), 32) }, ['name', 'extensions']), 32),
  })(options, 'saveDialogOptions');
}

function normalizePicGoServerUrl(url) {
  const trimmed = String(url || DEFAULT_PICGO_SERVER_URL).trim().replace(/\/+$/, '');
  return trimmed || DEFAULT_PICGO_SERVER_URL;
}

function sanitizePicGoServerUrl(value) {
  const url = normalizePicGoServerUrl(value === undefined || value === null ? '' : string(2048)(value, 'serverUrl'));
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw invalid('serverUrl', 'not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw invalid('serverUrl', 'only http and https are allowed');
  }
  return url;
}

function optionalString(value, label, max) {
  return value === undefined || value === null ? '' : string(max)(value, label);
}

function sanitizePicGoConfig(config) {
  const input = Object.fromEntries(safeEntries(config, 'picgo'));
  return {
    serverUrl: sanitizePicGoServerUrl(input.serverUrl),
    secret: optionalString(input.secret, 'secret', MAX_TEXT_LENGTH),
  };
}

function sanitizePicGoUpload(payload) {
  const input = Object.fromEntries(safeEntries(payload, 'picgoUpload'));
  const { buffer } = input;
  if (!(buffer instanceof ArrayBuffer) && !ArrayBuffer.isView(buffer)) {
    throw invalid('buffer', 'expected an ArrayBuffer or typed array');
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw invalid('buffer', `larger than ${MAX_UPLOAD_BYTES} bytes`);
  }
  const filename = path.basename(optionalString(input.filename, 'filename', 255).replace(/\\/g, '/')) || 'image.png';
  const mimeType = optionalString(input.mimeType, 'mimeType', 255);
  return {
    ...sanitizePicGoConfig({ serverUrl: input.serverUrl, secret: input.secret }),
    buffer,
    filename,
    mimeType: /^[\w.+-]+\/[\w.+-]+$/.test(mimeType) ? mimeType : 'application/octet-stream',
  };
}

module.exports = {
  isPlainObject,
  normalizePicGoServerUrl,
  sanitizeSettingsPatch,
  sanitizeWorkspacePath,
  sanitizeOpenedFile,
  sanitizeSaveDialogOptions,
  sanitizePicGoConfig,
  sanitizePicGoUpload,
};
