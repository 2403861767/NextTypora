const fs = require('fs');
const path = require('path');

function getSettingsPath(userDataPath) {
  return path.join(userDataPath, 'settings.json');
}

function loadSettings(userDataPath) {
  try {
    const raw = fs.readFileSync(getSettingsPath(userDataPath), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveSettings(userDataPath, settings) {
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(getSettingsPath(userDataPath), JSON.stringify(settings, null, 2), 'utf8');
}

function patchSettings(userDataPath, patch) {
  const current = loadSettings(userDataPath);
  const next = { ...current, ...patch };
  saveSettings(userDataPath, next);
  return next;
}

module.exports = { loadSettings, saveSettings, patchSettings };
