import type {
  AppSettings,
  EditorTab,
  ImageUploadSettings,
  OpenedFileRef,
  PersistedEditorTab,
  PreferenceSettings,
  RecentFileRef,
  RecentWorkspaceRef,
  WritingModeSettings,
} from '../types';
import { applyImageUploadSettings, getImageUploadSettings } from './imageUpload';
import { DEFAULT_SHORTCUTS, isKeyboardShortcutCandidate, isReservedShortcut, normalizeShortcut } from './shortcuts';
import { DEFAULT_THEME_ID, isThemeId } from './themes';

const LOCAL_STORAGE_KEY = 'nexttyproa-app-settings';
const LEGACY_IMAGE_STORAGE_KEY = 'nexttyproa-image-settings';

export function imageSettingsFromAppSettings(raw: AppSettings | Record<string, unknown>): ImageUploadSettings {
  const legacyMode = 'mode' in raw ? raw.mode : undefined;
  const mode = raw.imageUploadMode === 'picgo' || legacyMode === 'picgo' ? 'picgo' : 'local';
  return {
    mode,
    picgoServerUrl: typeof raw.picgoServerUrl === 'string' && raw.picgoServerUrl.trim()
      ? raw.picgoServerUrl.trim()
      : 'http://127.0.0.1:36677',
    picgoSecret: typeof raw.picgoSecret === 'string' ? raw.picgoSecret : '',
  };
}

export function preferenceSettingsFromAppSettings(raw: AppSettings | Record<string, unknown>): PreferenceSettings {
  return {
    ...imageSettingsFromAppSettings(raw),
    spellCheckEnabled: raw.spellCheckEnabled === true,
    themeId: isThemeId(raw.themeId) ? raw.themeId : DEFAULT_THEME_ID,
    editorThemeId: isThemeId(raw.editorThemeId) ? raw.editorThemeId : isThemeId(raw.themeId) ? raw.themeId : DEFAULT_THEME_ID,
    customCss: typeof raw.customCss === 'string' ? raw.customCss : '',
    shortcuts: shortcutOverridesFromAppSettings(raw),
    recentFiles: recentFilesFromAppSettings(raw),
    recentWorkspaces: recentWorkspacesFromAppSettings(raw),
    openTabs: openTabsFromAppSettings(raw),
    activeTabPath: typeof raw.activeTabPath === 'string' ? raw.activeTabPath : undefined,
    writingModes: writingModesFromAppSettings(raw),
  };
}

export function fileTreeExpandedFoldersFromAppSettings(raw: AppSettings | Record<string, unknown>): Record<string, string[]> {
  const source = raw.fileTreeExpandedFolders;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(source as Record<string, unknown>)
      .filter(([, value]) => Array.isArray(value))
      .map(([workspace, folders]) => [
        workspace,
        (folders as unknown[]).filter((folder): folder is string => typeof folder === 'string'),
      ]),
  );
}

function openedFileRefFromAppSettings(raw: AppSettings | Record<string, unknown>): OpenedFileRef | undefined {
  const value = raw.lastOpenedFile;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.folder !== 'string' || typeof candidate.relativePath !== 'string') {
    return undefined;
  }

  return {
    folder: candidate.folder,
    relativePath: candidate.relativePath,
  };
}

function shortcutOverridesFromAppSettings(raw: AppSettings | Record<string, unknown>): Record<string, string[]> {
  const source = raw.shortcuts;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const knownShortcutIds = new Set(DEFAULT_SHORTCUTS.map((shortcut) => shortcut.id));

  return Object.fromEntries(
    Object.entries(source as Record<string, unknown>)
      .filter(([key]) => knownShortcutIds.has(key))
      .filter(([, value]) => Array.isArray(value))
      .map(([key, value]) => {
        const shortcuts = Array.from(new Set(
          (value as unknown[])
            .filter((shortcut): shortcut is string => typeof shortcut === 'string')
            .map(normalizeShortcut)
            .filter((shortcut) => isKeyboardShortcutCandidate(shortcut) && !isReservedShortcut(shortcut)),
        ));
        return [key, shortcuts] as const;
      })
      .filter(([, value]) => value.length > 0),
  );
}

function recentFilesFromAppSettings(raw: AppSettings | Record<string, unknown>): RecentFileRef[] {
  if (!Array.isArray(raw.recentFiles)) return [];
  return raw.recentFiles
    .filter((item): item is RecentFileRef => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const candidate = item as Record<string, unknown>;
      return typeof candidate.folder === 'string'
        && typeof candidate.relativePath === 'string'
        && typeof candidate.openedAt === 'string';
    })
    .slice(0, 10);
}

function recentWorkspacesFromAppSettings(raw: AppSettings | Record<string, unknown>): RecentWorkspaceRef[] {
  if (!Array.isArray(raw.recentWorkspaces)) return [];
  return raw.recentWorkspaces
    .filter((item): item is RecentWorkspaceRef => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const candidate = item as Record<string, unknown>;
      return typeof candidate.path === 'string' && typeof candidate.openedAt === 'string';
    })
    .slice(0, 10);
}

function openTabsFromAppSettings(raw: AppSettings | Record<string, unknown>): EditorTab[] {
  if (!Array.isArray(raw.openTabs)) return [];
  return raw.openTabs
    .filter((item): item is PersistedEditorTab => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const candidate = item as Record<string, unknown>;
      return typeof candidate.id === 'string'
        && typeof candidate.path === 'string'
        && typeof candidate.title === 'string';
    })
    .slice(0, 12)
    // 正文不从 settings 恢复（旧版本存过的也丢弃），切换到标签页时会从磁盘重新读取
    .map((tab) => ({
      id: tab.id,
      path: tab.path,
      title: tab.title,
      content: '',
      loadedContent: '',
      contentHash: '',
      saveStatus: 'idle' as const,
      ...(tab.missing === true ? { missing: true } : {}),
    }));
}

function toPersistedEditorTab(tab: PersistedEditorTab): PersistedEditorTab {
  return {
    id: tab.id,
    path: tab.path,
    title: tab.title,
    ...(tab.missing === true ? { missing: true } : {}),
  };
}

function writingModesFromAppSettings(raw: AppSettings | Record<string, unknown>): WritingModeSettings {
  const source = raw.writingModes;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return {
      focusMode: false,
      typewriterMode: false,
      distractionFreeMode: false,
    };
  }

  const candidate = source as Record<string, unknown>;
  return {
    focusMode: candidate.focusMode === true,
    typewriterMode: candidate.typewriterMode === true,
    distractionFreeMode: candidate.distractionFreeMode === true,
  };
}

function readLocalAppSettings(): AppSettings | Record<string, unknown> {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) return JSON.parse(stored) as Record<string, unknown>;

    const legacy = localStorage.getItem(LEGACY_IMAGE_STORAGE_KEY);
    if (legacy) return JSON.parse(legacy) as Record<string, unknown>;
  } catch {
    // ignore
  }
  return {};
}

export async function loadAppSettings(): Promise<AppSettings | Record<string, unknown>> {
  if (window.nextTyproa?.getAppSettings) {
    return window.nextTyproa.getAppSettings();
  }
  return readLocalAppSettings();
}

export async function patchStoredAppSettings(input: Partial<AppSettings>): Promise<AppSettings> {
  // 调用方传入的是完整 EditorTab（含正文），这里统一裁剪为引用，避免每次按键都把所有标签页正文写进 settings.json
  const patch = input.openTabs ? { ...input, openTabs: input.openTabs.map(toPersistedEditorTab) } : input;
  if (window.nextTyproa?.patchAppSettings) {
    return window.nextTyproa.patchAppSettings(patch);
  }

  const current = readLocalAppSettings();
  const next = { ...current, ...patch } as AppSettings;
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export async function loadAndApplyImageSettings(): Promise<ImageUploadSettings> {
  const raw = await loadAppSettings();
  const settings = imageSettingsFromAppSettings(raw);
  applyImageUploadSettings(settings);
  return settings;
}

export async function loadAndApplyPreferenceSettings(): Promise<PreferenceSettings & Pick<AppSettings, 'lastWorkspace' | 'lastOpenedFile' | 'fileTreeExpandedFolders'>> {
  const raw = await loadAppSettings();
  const settings = preferenceSettingsFromAppSettings(raw);
  applyImageUploadSettings(settings);
  return {
    ...settings,
    lastWorkspace: typeof raw.lastWorkspace === 'string' ? raw.lastWorkspace : undefined,
    lastOpenedFile: openedFileRefFromAppSettings(raw),
    fileTreeExpandedFolders: fileTreeExpandedFoldersFromAppSettings(raw),
  };
}

export async function persistImageUploadSettings(settings: ImageUploadSettings): Promise<ImageUploadSettings> {
  applyImageUploadSettings(settings);
  const payload = {
    imageUploadMode: settings.mode,
    picgoServerUrl: settings.picgoServerUrl,
    picgoSecret: settings.picgoSecret,
  };
  await patchStoredAppSettings(payload);
  return getImageUploadSettings();
}

export async function persistPreferenceSettings(settings: PreferenceSettings): Promise<PreferenceSettings> {
  applyImageUploadSettings(settings);
  const saved = await patchStoredAppSettings({
    imageUploadMode: settings.mode,
    picgoServerUrl: settings.picgoServerUrl,
    picgoSecret: settings.picgoSecret,
    spellCheckEnabled: settings.spellCheckEnabled,
    themeId: settings.themeId,
    editorThemeId: settings.editorThemeId,
    customCss: settings.customCss,
    shortcuts: settings.shortcuts,
    recentFiles: settings.recentFiles,
    recentWorkspaces: settings.recentWorkspaces,
    openTabs: settings.openTabs,
    activeTabPath: settings.activeTabPath,
    writingModes: settings.writingModes,
  });
  return preferenceSettingsFromAppSettings(saved);
}
