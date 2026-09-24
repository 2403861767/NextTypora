export interface TreeNode {
  name: string;
  path: string;
  directory: boolean;
  children: TreeNode[];
}

export interface Note {
  path: string;
  title: string;
  content: string;
  tags?: string;
  updatedAt?: string;
  contentHash: string;
  encoding?: string;
  hasBom?: boolean;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  lineNumber?: number;
  score?: number;
  updatedAt?: string;
}

export type SearchSort = 'relevance' | 'updatedAt' | 'path';

export interface SearchRequest {
  q: string;
  scope?: 'all' | 'title' | 'body' | 'path';
  sort?: SearchSort;
  limit?: number;
  offset?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  limit: number;
  offset: number;
  sort: SearchSort;
}

export interface SearchIndexStatus {
  indexing: boolean;
  indexedFiles: number;
  totalFiles: number;
  failedFiles?: number;
  skippedFiles?: number;
  lastIndexedAt?: string;
}

export interface FileOperationResult {
  name: string;
  path: string;
  directory: boolean;
}

export interface ExportHtmlResult {
  path: string;
  title: string;
  html: string;
}

export interface TreeSelection {
  path: string;
  isDirectory: boolean;
}

export interface BackendConfig {
  port: number;
  token: string;
}

export interface OpenedFileRef {
  folder: string;
  relativePath: string;
}

export type ImageUploadMode = 'local' | 'picgo';

export type AppThemeId = 'default-light' | 'default-dark' | 'sepia' | 'github' | 'academic';
export type EditorThemeId = AppThemeId;

export interface ShortcutBinding {
  id: string;
  label: string;
  category: 'file' | 'edit' | 'format' | 'view' | 'export' | 'settings';
  scope?: 'app' | 'editor';
  defaultKeys: string[];
  keys?: string[];
}

export interface RecentFileRef extends OpenedFileRef {
  title?: string;
  openedAt: string;
}

export interface RecentWorkspaceRef {
  path: string;
  openedAt: string;
}

export interface EditorTab {
  id: string;
  path: string;
  title: string;
  content: string;
  loadedContent: string;
  contentHash: string;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  missing?: boolean;
  conflict?: {
    currentHash: string;
    currentUpdatedAt?: string;
    message: string;
  };
  updatedAt?: string;
}

// 持久化到 settings 的标签页只保留引用，正文每次都从磁盘重新读取
export type PersistedEditorTab = Pick<EditorTab, 'id' | 'path' | 'title' | 'missing'>;

export interface ImageUploadSettings {
  mode: ImageUploadMode;
  picgoServerUrl: string;
  picgoSecret: string;
}

export interface WritingModeSettings {
  focusMode: boolean;
  typewriterMode: boolean;
  distractionFreeMode: boolean;
}

export interface PreferenceSettings extends ImageUploadSettings {
  spellCheckEnabled: boolean;
  themeId: AppThemeId;
  editorThemeId: EditorThemeId;
  customCss: string;
  shortcuts: Record<string, string[]>;
  recentFiles: RecentFileRef[];
  recentWorkspaces: RecentWorkspaceRef[];
  openTabs: EditorTab[];
  activeTabPath?: string;
  writingModes: WritingModeSettings;
}

export interface AppSettings {
  lastWorkspace?: string;
  lastOpenedFile?: OpenedFileRef;
  imageUploadMode?: ImageUploadMode;
  picgoServerUrl?: string;
  picgoSecret?: string;
  spellCheckEnabled?: boolean;
  fileTreeExpandedFolders?: Record<string, string[]>;
  themeId?: AppThemeId;
  editorThemeId?: EditorThemeId;
  customCss?: string;
  shortcuts?: Record<string, string[]>;
  recentFiles?: RecentFileRef[];
  recentWorkspaces?: RecentWorkspaceRef[];
  openTabs?: PersistedEditorTab[];
  activeTabPath?: string;
  writingModes?: Partial<WritingModeSettings>;
}

export interface ExternalTheme {
  id: string;
  name: string;
  author?: string;
  version?: string;
  mode?: 'light' | 'dark' | 'both';
  previewColor?: string;
  filename?: string;
  css: string;
}

export interface LocalMarkdownFile {
  fullPath: string;
  dir: string;
  relativePath: string;
}

declare global {
  interface Window {
    nextTyproa?: {
      isElectron: boolean;
      getBackendConfig: () => Promise<BackendConfig>;
      restartBackend?: () => Promise<{ ok: boolean; reason?: 'dev' | 'quitting' }>;
      getAppSettings: () => Promise<AppSettings>;
      patchAppSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
      setLastWorkspace: (folderPath: string) => Promise<AppSettings>;
      rememberOpenedFile: (payload: OpenedFileRef) => Promise<AppSettings>;
      selectWorkspaceFolder: () => Promise<string | null>;
      selectMarkdownFile: () => Promise<LocalMarkdownFile | null>;
      showSaveDialog?: (options: {
        title?: string;
        defaultPath?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }) => Promise<string | null>;
      saveTextFile?: (payload: { path: string; content: string }) => Promise<{ path: string }>;
      exportPdf?: (payload: { html: string; defaultPath?: string }) => Promise<{ path: string } | null>;
      onMenuOpenFile: (callback: () => void) => () => void;
      onMenuOpenFolder: (callback: () => void) => () => void;
      onMenuCreateNote: (callback: () => void) => () => void;
      onMenuExportHtml?: (callback: () => void) => () => void;
      onMenuExportPdf?: (callback: () => void) => () => void;
      onMenuSave?: (callback: () => void) => () => void;
      onMenuToggleSource?: (callback: () => void) => () => void;
      onMenuToggleSidebar?: (callback: () => void) => () => void;
      onOpenFilePath: (callback: (filePath: string) => void) => () => void;
      onRequestFlushSave: (callback: () => void) => () => void;
      notifyFlushSaveDone: (ok?: boolean) => Promise<void>;
      testPicGoConnection: (config: { serverUrl: string; secret?: string }) => Promise<unknown>;
      uploadToPicGo: (payload: {
        serverUrl: string;
        secret?: string;
        buffer: ArrayBuffer;
        filename: string;
        mimeType: string;
      }) => Promise<unknown>;
      onMenuOpenSettings?: (callback: () => void) => () => void;
      revealInExplorer?: (path: string) => Promise<void>;
      listThemes?: () => Promise<ExternalTheme[]>;
      openThemeDirectory?: () => Promise<string>;
      importThemeCss?: () => Promise<ExternalTheme | null>;
      windowMinimize?: () => Promise<void>;
      windowToggleMaximize?: () => Promise<boolean>;
      windowClose?: () => Promise<void>;
    };
  }
}

export {};
