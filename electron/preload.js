const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nextTyproa', {
  isElectron: true,
  getBackendConfig: () => ipcRenderer.invoke('backend:getConfig'),
  getAppSettings: () => ipcRenderer.invoke('settings:get'),
  patchAppSettings: (patch) => ipcRenderer.invoke('settings:patch', patch),
  setLastWorkspace: (folderPath) => ipcRenderer.invoke('settings:setLastWorkspace', folderPath),
  rememberOpenedFile: (payload) => ipcRenderer.invoke('settings:rememberOpenedFile', payload),
  selectWorkspaceFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  selectMarkdownFile: () => ipcRenderer.invoke('dialog:selectFile'),
  showSaveDialog: (options) => ipcRenderer.invoke('dialog:showSaveDialog', options),
  saveTextFile: (payload) => ipcRenderer.invoke('file:saveText', payload),
  exportPdf: (payload) => ipcRenderer.invoke('export:pdf', payload),
  onMenuOpenFile: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:open-file', listener);
    return () => ipcRenderer.removeListener('menu:open-file', listener);
  },
  onMenuOpenFolder: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:open-folder', listener);
    return () => ipcRenderer.removeListener('menu:open-folder', listener);
  },
  onMenuCreateNote: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:create-note', listener);
    return () => ipcRenderer.removeListener('menu:create-note', listener);
  },
  onMenuExportHtml: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:export-html', listener);
    return () => ipcRenderer.removeListener('menu:export-html', listener);
  },
  onMenuExportPdf: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:export-pdf', listener);
    return () => ipcRenderer.removeListener('menu:export-pdf', listener);
  },
  onMenuSave: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:save', listener);
    return () => ipcRenderer.removeListener('menu:save', listener);
  },
  onMenuToggleSource: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:toggle-source', listener);
    return () => ipcRenderer.removeListener('menu:toggle-source', listener);
  },
  onMenuToggleSidebar: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:toggle-sidebar', listener);
    return () => ipcRenderer.removeListener('menu:toggle-sidebar', listener);
  },
  onOpenFilePath: (callback) => {
    const listener = (_event, filePath) => callback(filePath);
    ipcRenderer.on('app:open-file', listener);
    return () => ipcRenderer.removeListener('app:open-file', listener);
  },
  onRequestFlushSave: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:request-flush-save', listener);
    return () => ipcRenderer.removeListener('app:request-flush-save', listener);
  },
  notifyFlushSaveDone: () => ipcRenderer.invoke('app:flush-save-done'),
  revealInExplorer: (targetPath) => ipcRenderer.invoke('file:revealInExplorer', targetPath),
  testPicGoConnection: (config) => ipcRenderer.invoke('picgo:heartbeat', config),
  uploadToPicGo: (payload) => ipcRenderer.invoke('picgo:upload', payload),
  listThemes: () => ipcRenderer.invoke('themes:list'),
  openThemeDirectory: () => ipcRenderer.invoke('themes:openDirectory'),
  importThemeCss: () => ipcRenderer.invoke('themes:importCss'),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  onMenuOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:open-settings', listener);
    return () => ipcRenderer.removeListener('menu:open-settings', listener);
  },
});
