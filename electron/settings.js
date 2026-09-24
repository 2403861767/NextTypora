const fs = require('fs');
const path = require('path');

function getSettingsPath(userDataPath) {
  return path.join(userDataPath, 'settings.json');
}

function loadSettings(userDataPath) {
  try {
    const raw = fs.readFileSync(getSettingsPath(userDataPath), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveSettings(userDataPath, settings) {
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(getSettingsPath(userDataPath), JSON.stringify(settings, null, 2), 'utf8');
}

// patch 需先经 ipcValidation.sanitizeSettingsPatch 校验；值为 undefined 的键表示删除该设置
function patchSettings(userDataPath, patch) {
  const current = loadSettings(userDataPath);
  const next = { ...current, ...patch };
  for (const key of Object.keys(next)) {
    if (next[key] === undefined) delete next[key];
  }
  saveSettings(userDataPath, next);
  return next;
}

module.exports = { loadSettings, saveSettings, patchSettings };
