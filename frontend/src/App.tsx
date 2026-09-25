import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BorderOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FileAddOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  HighlightOutlined,
  MinusOutlined,
  MoonOutlined,
  QuestionCircleOutlined,
  PushpinOutlined,
  SearchOutlined,
  SettingOutlined,
  SunOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  ConfigProvider,
  Input,
  Modal,
  Segmented,
  Spin,
  Typography,
  message,
  theme as antTheme,
} from 'antd';
import type { InputRef } from 'antd/es/input';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  createFolder,
  createNote,
  deletePath,
  exportHtml,
  getNote,
  getTree,
  getWorkspace,
  healthCheck,
  initApiConfig,
  movePath,
  reconnectBackend,
  renamePath,
  refreshWorkspace,
  saveNote,
  setWorkspace,
  ApiError,
  describeError,
} from './api';
import { FileTree } from './components/FileTree';
import type { FileTreeSortMode } from './components/FileTree';
import { EditorTabs } from './components/EditorTabs';
import { FileList } from './components/FileList';
import { MarkdownEditor } from './components/MarkdownEditor';
import { MarkdownHelpModal } from './components/MarkdownHelpModal';
import { Outline } from './components/Outline';
import { QuickOpenModal } from './components/QuickOpenModal';
import { SettingsModal } from './components/SettingsModal';
import { SearchResultsPanel } from './components/SearchResultsPanel';
import { SidebarPanel, type SidebarTab } from './components/SidebarPanel';
import { SourceEditor } from './components/SourceEditor';
import { StatusBar } from './components/StatusBar';
import { useFindReplace } from './hooks/useFindReplace';
import { useSearchPanel } from './hooks/useSearchPanel';
import type { AppThemeId, EditorTab, ImageUploadSettings, Note, PreferenceSettings, RecentFileRef, RecentWorkspaceRef, TreeNode, TreeSelection, WritingModeSettings } from './types';
import { loadAndApplyPreferenceSettings, patchStoredAppSettings } from './utils/appSettings';
import { windowsFileNameError, windowsPathError } from './utils/fileName';
import { joinLocalPath, parseLocalMarkdownPath, foldersEqual } from './utils/localPath';
import { scrollToHeadingLine } from './utils/headings';
import { countDocumentWords } from './utils/wordCount';
import { applyThemeToRoot, getThemeDefinition, scopeCustomEditorCss } from './utils/themes';
import { closeEditorTab, makeEditorTab, upsertEditorTab, upsertRecentFile, upsertRecentWorkspace } from './utils/recentFiles';
import { detectShortcutConflicts, findShortcutAction, resolveShortcutBindings } from './utils/shortcuts';
import {
  editorCrossfadeMotion,
  fadeSoftMotion,
  motionTransitions,
  panelRevealMotion,
  rightRailRevealMotion,
  sheetRevealMotion,
} from './utils/motionPresets';

const { Text } = Typography;

type CreateKind = 'markdown' | 'folder';
type EditorMode = 'wysiwyg' | 'source';

interface CreateDialogState {
  kind: CreateKind;
  parentPath: string;
}

interface MoveDialogState {
  source: TreeSelection;
  targetFolderPath: string;
}

function useDebouncedSave(
  path: string,
  content: string,
  enabled: boolean,
  baseHash?: string,
  onSaved?: (note: Note) => void,
  onConflict?: (conflict: SaveConflict) => void,
  onFileMissing?: (path: string) => void,
) {
  const timerRef = useRef<number>();
  const stateRef = useRef({ path, content, enabled, baseHash });
  const inFlightRef = useRef<Promise<unknown> | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');

  stateRef.current = { path, content, enabled, baseHash };

  const flush = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timerRef.current);
    // 同一时间只发一个保存请求：并发请求带着同一个 baseHash，后到的会被误判为外部修改（如后端恢复时积压的重试）
    while (inFlightRef.current) {
      await inFlightRef.current;
    }
    const { path: savePath, content: saveContent, enabled: dirty, baseHash: saveBaseHash } = stateRef.current;
    if (!savePath || !dirty) return true;

    setSaveStatus('saving');
    const request = saveNote(savePath, saveContent, saveBaseHash);
    inFlightRef.current = request.catch(() => undefined);
    try {
      const note = await request;
      // 重新渲染前 stateRef 仍是旧值：先同步新的 baseHash，排队中的 flush 才不会带着旧 hash 重复保存
      if (stateRef.current.path === savePath) {
        stateRef.current = {
          ...stateRef.current,
          baseHash: note.contentHash,
          enabled: stateRef.current.enabled && stateRef.current.content !== saveContent,
        };
      }
      setSaveStatus('saved');
      setSaveError('');
      onSaved?.(note);
      return true;
    } catch (error) {
      if (isSaveConflict(error)) {
        onConflict?.(toSaveConflict(error));
      } else if (error instanceof ApiError && error.status === 404) {
        // 文件已被移动或删除
        onFileMissing?.(savePath);
      }
      setSaveError(describeError(error, '保存失败'));
      setSaveStatus('error');
      return false;
    } finally {
      inFlightRef.current = null;
    }
  }, [onConflict, onSaved, onFileMissing]);

  useEffect(() => {
    if (!enabled || !path) return;

    window.clearTimeout(timerRef.current);
    setSaveStatus('idle');

    timerRef.current = window.setTimeout(() => {
      void flush();
    }, 800);

    return () => window.clearTimeout(timerRef.current);
  }, [path, content, enabled, flush]);

  return { saveStatus, saveError, flush };
}

interface SaveConflict {
  path: string;
  currentHash: string;
  currentUpdatedAt: string;
  message: string;
}

function isSaveConflict(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 409 && error.code === 'NOTE_CONFLICT';
}

function toSaveConflict(error: ApiError): SaveConflict {
  const body = error.body as Partial<SaveConflict> | undefined;
  return {
    path: body?.path || '',
    currentHash: body?.currentHash || '',
    currentUpdatedAt: body?.currentUpdatedAt || '',
    message: error.message,
  };
}

function SaveIndicator({ status, error }: { status: 'idle' | 'saving' | 'saved' | 'error'; error?: string }) {
  if (status === 'idle') return null;
  const label =
    status === 'saving' ? '保存中…' :
    status === 'saved' ? '已保存' :
    '保存失败';
  return <span className={`save-indicator save-${status}`} title={status === 'error' ? error : undefined}>{label}</span>;
}

function noteDisplayName(path: string): string {
  if (!path) return '未打开文档';
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

function normalizeTreePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function parentPathOf(path: string): string {
  const normalized = normalizeTreePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash > 0 ? normalized.slice(0, lastSlash) : '';
}

function parentFolderPathsOf(path: string): string[] {
  const normalized = normalizeTreePath(path);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return [];

  const parents: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    parents.push(parts.slice(0, index).join('/'));
  }
  return parents;
}

function collectDirectoryPaths(nodes: TreeNode[], result = new Set<string>()): Set<string> {
  nodes.forEach((node) => {
    if (!node.directory) return;

    result.add(node.path || node.name);
    collectDirectoryPaths(node.children, result);
  });
  return result;
}

function collectMoveDestinationOptions(
  nodes: TreeNode[],
  source: TreeSelection | null,
): Array<{ path: string; label: string }> {
  if (!source) return [];

  const normalizedSource = normalizeTreePath(source.path);
  if (!normalizedSource) return [];

  const currentParent = parentPathOf(normalizedSource);
  const options: Array<{ path: string; label: string }> = [{ path: '', label: '根目录' }];

  const walk = (items: TreeNode[]) => {
    items.forEach((node) => {
      if (!node.directory) return;

      const path = normalizeTreePath(node.path || node.name);
      if (path) {
        options.push({ path, label: path });
      }
      walk(node.children);
    });
  };

  walk(nodes);

  return options.filter((option) => {
    const target = normalizeTreePath(option.path);
    if (target === currentParent) return false;
    if (!source.isDirectory) return true;
    if (target === normalizedSource) return false;
    return !target.startsWith(`${normalizedSource}/`);
  });
}

function sortedUniquePaths(paths: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(paths).map(normalizeTreePath).filter(Boolean))).sort();
}

function resolveCreatePath(name: string, parentPath: string): string {
  const normalizedName = normalizeTreePath(name);
  if (!normalizedName) return '';
  if (normalizedName.includes('/')) return normalizedName;
  const normalizedParent = normalizeTreePath(parentPath);
  return normalizedParent ? `${normalizedParent}/${normalizedName}` : normalizedName;
}

function markdownName(name: string): string {
  return isMarkdownPath(name) ? name : `${name}.md`;
}

function timestampForFileName(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function conflictCopyPath(path: string): string {
  const normalized = normalizeTreePath(path);
  const lower = normalized.toLowerCase();
  const extension = lower.endsWith('.markdown') ? '.markdown' : '.md';
  const extensionLength = lower.endsWith('.markdown') ? '.markdown'.length : lower.endsWith('.md') ? '.md'.length : 0;
  const stem = extensionLength > 0 ? normalized.slice(0, -extensionLength) : normalized;
  return `${stem}.conflict-${timestampForFileName()}${extension}`;
}

function exportBaseName(path: string, extension: 'html' | 'pdf'): string {
  const name = noteDisplayName(path).replace(/\.(md|markdown)$/i, '') || 'note';
  const safeName = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'note';
  return `${safeName}.${extension}`;
}

function downloadTextFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isPathAffected(path: string, target: TreeSelection): boolean {
  const normalizedPath = normalizeTreePath(path);
  const targetPath = normalizeTreePath(target.path);
  if (!normalizedPath) return false;
  if (normalizedPath === targetPath) return true;
  if (!target.isDirectory) return false;
  return targetPath ? normalizedPath.startsWith(`${targetPath}/`) : true;
}

function replaceAffectedPath(path: string, target: TreeSelection, newTargetPath: string): string {
  const normalizedPath = normalizeTreePath(path);
  const oldTargetPath = normalizeTreePath(target.path);
  const normalizedNewTargetPath = normalizeTreePath(newTargetPath);
  if (normalizedPath === oldTargetPath) return normalizedNewTargetPath;
  if (!target.isDirectory || !oldTargetPath) return normalizedPath;
  return `${normalizedNewTargetPath}${normalizedPath.slice(oldTargetPath.length)}`;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [unsupportedPreviewPath, setUnsupportedPreviewPath] = useState('');
  const [selectedTreeItem, setSelectedTreeItem] = useState<TreeSelection | null>(null);
  const [content, setContent] = useState('');
  const [loadedContent, setLoadedContent] = useState('');
  const [contentHash, setContentHash] = useState('');
  const [saveConflict, setSaveConflict] = useState<SaveConflict | null>(null);
  const [themeId, setThemeId] = useState<AppThemeId>('default-light');
  const [editorThemeId, setEditorThemeId] = useState<AppThemeId>('default-light');
  const [customCss, setCustomCss] = useState('');
  const [editorMode, setEditorMode] = useState<EditorMode>('wysiwyg');
  const [editorRevision, setEditorRevision] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return typeof window === 'undefined' ? true : !window.matchMedia('(max-width: 720px)').matches;
  });
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files');
  const [createDialog, setCreateDialog] = useState<CreateDialogState | null>(null);
  const [createName, setCreateName] = useState('untitled.md');
  const [renameTarget, setRenameTarget] = useState<TreeSelection | null>(null);
  const [renameName, setRenameName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TreeSelection | null>(null);
  const [moveDialog, setMoveDialog] = useState<MoveDialogState | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [fileTreeSortMode, setFileTreeSortMode] = useState<FileTreeSortMode>('name');
  const [fileTreeDirectoriesFirst, setFileTreeDirectoriesFirst] = useState(true);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [imageSettings, setImageSettings] = useState<ImageUploadSettings>({
    mode: 'local',
    picgoServerUrl: 'http://127.0.0.1:36677',
    picgoSecret: '',
  });
  const [spellCheckEnabled, setSpellCheckEnabled] = useState(false);
  const [fileTreeExpandedFolders, setFileTreeExpandedFolders] = useState<Record<string, string[]>>({});
  const [shortcutOverrides, setShortcutOverrides] = useState<Record<string, string[]>>({});
  const [recentFiles, setRecentFiles] = useState<RecentFileRef[]>([]);
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspaceRef[]>([]);
  const [openTabs, setOpenTabs] = useState<EditorTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | undefined>();
  const [activeOutlineHeadingKey, setActiveOutlineHeadingKey] = useState<string | undefined>();
  const [toolbarSearchExpanded, setToolbarSearchExpanded] = useState(false);
  const [writingModes, setWritingModes] = useState<WritingModeSettings>({
    focusMode: false,
    typewriterMode: false,
    distractionFreeMode: false,
  });
  const [exportLoading, setExportLoading] = useState<'html' | 'pdf' | null>(null);
  const [messageApi, messageContextHolder] = message.useMessage();
  const [fileMissingDialog, setFileMissingDialog] = useState<{ path: string; content: string } | null>(null);

  const openSeqRef = useRef(0);
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const pendingOpenPathRef = useRef<string | null>(null);
  const toolbarSearchInputRef = useRef<InputRef | null>(null);

  const handleFileMissing = useCallback((missingPath: string) => {
    // 标记该 tab 为 missing
    setOpenTabs((prev) => prev.map((tab) => (
      tab.path === missingPath
        ? { ...tab, missing: true, saveStatus: 'error' as const }
        : tab
    )));

    // 弹出对话框
    setFileMissingDialog({ path: missingPath, content });

    // 显示错误消息
    setAlertMessage(`文件 ${missingPath} 已被移动或删除`);
    setAlertOpen(true);
  }, [content]);

  const { saveStatus, saveError, flush: flushSave } = useDebouncedSave(
    selectedPath,
    content,
    ready && !saveConflict && content !== loadedContent,
    contentHash,
    (note) => {
      setLoadedContent(note.content);
      setContentHash(note.contentHash);
    },
    setSaveConflict,
    handleFileMissing,
  );

  const canDeleteSelectedNote = Boolean(selectedPath);
  const isDirty = selectedPath ? content !== loadedContent : false;
  const displayPath = selectedPath || unsupportedPreviewPath;
  const documentTitle = useMemo(() => noteDisplayName(displayPath), [displayPath]);
  const wordCount = useMemo(() => countDocumentWords(content), [content]);
  const shortcutBindings = useMemo(() => {
    const bindings = resolveShortcutBindings(shortcutOverrides);
    return detectShortcutConflicts(bindings).length > 0 ? resolveShortcutBindings({}) : bindings;
  }, [shortcutOverrides]);

  useEffect(() => {
    setActiveOutlineHeadingKey(undefined);
  }, [selectedPath]);

  const absoluteFilePath = useMemo(() => {
    if (!workspacePath || !displayPath) return '';
    return joinLocalPath(workspacePath, displayPath);
  }, [workspacePath, displayPath]);

  const selectedFolderPath = useMemo(() => {
    if (selectedTreeItem?.isDirectory) return selectedTreeItem.path;
    if (selectedPath) return parentPathOf(selectedPath);
    if (unsupportedPreviewPath) return parentPathOf(unsupportedPreviewPath);
    return '';
  }, [selectedPath, selectedTreeItem, unsupportedPreviewPath]);

  const currentExpandedFolders = useMemo(() => {
    return new Set(fileTreeExpandedFolders[workspacePath] ?? []);
  }, [fileTreeExpandedFolders, workspacePath]);
  const moveDestinationOptions = useMemo(() => {
    return collectMoveDestinationOptions(tree, moveDialog?.source ?? null);
  }, [moveDialog?.source, tree]);

  const showError = useCallback((errorMessage: string) => {
    setAlertMessage(errorMessage);
    setAlertOpen(true);
  }, []);

  const persistFileTreeExpandedFolders = useCallback((next: Record<string, string[]>) => {
    void patchStoredAppSettings({ fileTreeExpandedFolders: next }).catch(() => undefined);
  }, []);

  const setWorkspaceExpandedFolders = useCallback((workspace: string, paths: string[]) => {
    if (!workspace) return;
    setFileTreeExpandedFolders((prev) => {
      const next = {
        ...prev,
        [workspace]: sortedUniquePaths(paths),
      };
      persistFileTreeExpandedFolders(next);
      return next;
    });
  }, [persistFileTreeExpandedFolders]);

  const addWorkspaceExpandedFolders = useCallback((workspace: string, paths: string[]) => {
    const normalizedPaths = sortedUniquePaths(paths);
    if (!workspace || normalizedPaths.length === 0) return;

    setFileTreeExpandedFolders((prev) => {
      const current = prev[workspace] ?? [];
      const merged = sortedUniquePaths([...current, ...normalizedPaths]);
      if (merged.length === current.length && merged.every((path, index) => path === current[index])) {
        return prev;
      }

      const next = {
        ...prev,
        [workspace]: merged,
      };
      persistFileTreeExpandedFolders(next);
      return next;
    });
  }, [persistFileTreeExpandedFolders]);

  const handleExpandedFoldersChange = useCallback((paths: string[]) => {
    setWorkspaceExpandedFolders(workspacePath, paths);
  }, [setWorkspaceExpandedFolders, workspacePath]);

  const rememberWorkspace = useCallback((path: string) => {
    setRecentWorkspaces((prev) => {
      const next = upsertRecentWorkspace(prev, path);
      void patchStoredAppSettings({ recentWorkspaces: next, lastWorkspace: path }).catch(() => undefined);
      return next;
    });
  }, []);

  // 用函数式更新基于最新状态合并：调用方在 await flushSave/getNote 之后才调用，闭包里的列表可能已过期
  const rememberOpenedNote = useCallback((folder: string, note: Note) => {
    setRecentFiles((prev) => {
      const next = upsertRecentFile(prev, {
        folder,
        relativePath: note.path,
        title: note.title || noteDisplayName(note.path),
      });
      void patchStoredAppSettings({ recentFiles: next }).catch(() => undefined);
      return next;
    });
    setOpenTabs((prev) => {
      const next = upsertEditorTab(prev, makeEditorTab(note));
      void patchStoredAppSettings({ openTabs: next }).catch(() => undefined);
      return next;
    });
    setActiveTabPath(note.path);
    void patchStoredAppSettings({
      activeTabPath: note.path,
      lastOpenedFile: {
        folder,
        relativePath: note.path,
      },
    }).catch(() => undefined);
  }, []);

  const persistWritingModes = useCallback((next: WritingModeSettings) => {
    setWritingModes(next);
    void patchStoredAppSettings({ writingModes: next }).catch(() => undefined);
  }, []);

  const patchWritingModes = useCallback((patch: Partial<WritingModeSettings>) => {
    setWritingModes((prev) => {
      const next = { ...prev, ...patch };
      void patchStoredAppSettings({ writingModes: next }).catch(() => undefined);
      return next;
    });
  }, []);

  const copyText = useCallback(async (text: string, successMessage = '已复制') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      messageApi.success(successMessage);
    } catch {
      showError('复制失败，请检查剪贴板权限');
    }
  }, [messageApi, showError]);

  const markEditorTabMissing = useCallback((path: string, makeActive = false) => {
    setOpenTabs((prev) => {
      const next = prev.map((tab) => (
        tab.path === path
          ? { ...tab, missing: true, saveStatus: 'error' as const }
          : tab
      ));
      void patchStoredAppSettings({
        openTabs: next,
        activeTabPath: makeActive ? path : activeTabPath,
      }).catch(() => undefined);
      return next;
    });
    if (makeActive) {
      setActiveTabPath(path);
    }
  }, [activeTabPath]);

  const saveTabsBeforeRemoving = useCallback(async (tabsToRemove: EditorTab[]): Promise<boolean> => {
    let activeFlushed = false;

    for (const tab of tabsToRemove) {
      const dirty = tab.path === selectedPath ? content !== loadedContent : tab.content !== tab.loadedContent;
      if (!dirty) continue;

      if (tab.path === selectedPath) {
        if (!activeFlushed) {
          activeFlushed = true;
          const saved = await flushSave();
          if (!saved) {
            showError('保存失败，无法关闭标签页');
            return false;
          }
        }
        continue;
      }

      try {
        await saveNote(tab.path, tab.content, tab.contentHash);
      } catch {
        showError(`保存 ${noteDisplayName(tab.path)} 失败，无法关闭标签页`);
        return false;
      }
    }

    return true;
  }, [content, flushSave, loadedContent, selectedPath, showError]);

  const syncTabsAfterPathChange = useCallback((target: TreeSelection, newTargetPath: string) => {
    setOpenTabs((prev) => {
      const next = prev.map((tab) => {
        if (!isPathAffected(tab.path, target)) return tab;
        const nextPath = replaceAffectedPath(tab.path, target, newTargetPath);
        return {
          ...tab,
          id: tab.id === tab.path ? nextPath : tab.id,
          path: nextPath,
          title: noteDisplayName(nextPath),
        };
      });
      const nextActivePath = activeTabPath && isPathAffected(activeTabPath, target)
        ? replaceAffectedPath(activeTabPath, target, newTargetPath)
        : activeTabPath;
      void patchStoredAppSettings({ openTabs: next, activeTabPath: nextActivePath }).catch(() => undefined);
      return next;
    });
    if (activeTabPath && isPathAffected(activeTabPath, target)) {
      setActiveTabPath(replaceAffectedPath(activeTabPath, target, newTargetPath));
    }
  }, [activeTabPath]);

  const handleCopyPath = useCallback((path: string, kind: 'relative' | 'absolute') => {
    const target = kind === 'absolute'
      ? path
      : normalizeTreePath(path);
    void copyText(target, kind === 'absolute' ? '已复制绝对路径' : '已复制相对路径');
  }, [copyText]);

  const handleRevealInExplorer = useCallback(async (absolutePath: string) => {
    if (!absolutePath) return;
    try {
      await window.nextTyproa?.revealInExplorer?.(absolutePath);
    } catch (e) {
      showError(describeError(e, '无法在资源管理器中显示'));
    }
  }, [showError]);

  const {
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    clearSearchResults,
    searchOpen,
    setSearchOpen,
    handleSearch,
    searchSort,
    setSearchSort,
    searchOffset,
    searchTotal,
    searchPageSize,
    searchLoading,
    indexStatus,
    setSearchOffset,
  } = useSearchPanel(showError);
  const toolbarSearchVisible = toolbarSearchExpanded || searchQuery.trim().length > 0;

  useEffect(() => {
    if (!toolbarSearchVisible) return;
    const timer = window.setTimeout(() => toolbarSearchInputRef.current?.focus({ cursor: 'end' }), 40);
    return () => window.clearTimeout(timer);
  }, [toolbarSearchVisible]);

  const openToolbarSearch = useCallback(() => {
    setToolbarSearchExpanded(true);
    setSearchOpen(true);
  }, [setSearchOpen]);

  const submitToolbarSearch = useCallback(() => {
    setToolbarSearchExpanded(true);
    setSearchOpen(true);
    setSidebarOpen(true);
    setSidebarTab('search');
    if (searchQuery.trim()) void handleSearch();
  }, [handleSearch, searchQuery, setSearchOpen]);

  const {
    findOpen,
    setFindOpen,
    findQuery,
    setFindQuery,
    replaceValue,
    setReplaceValue,
    findMatchCount,
    replaceFirst,
    replaceAll,
  } = useFindReplace(content, setContent, () => {
    if (editorMode === 'wysiwyg') {
      setEditorRevision((revision) => revision + 1);
    }
  });

  const refreshTree = useCallback(async () => {
    const nodes = await getTree();
    setTree(nodes);
  }, []);

  // 文件操作失败时按错误类型提示；404 说明文件树已过期，顺便刷新以移除失效节点
  const showFileOperationError = useCallback((error: unknown, fallback: string) => {
    showError(describeError(error, fallback));
    if (error instanceof ApiError && error.kind === 'notFound') {
      void refreshTree().catch(() => undefined);
    }
  }, [refreshTree, showError]);

  const refreshWorkspaceTree = useCallback(async () => {
    const nodes = await refreshWorkspace();
    setTree(nodes);
  }, []);

  // 后端心跳：在线时每 5 秒探测，断线后每 3 秒重连；恢复后同步工作区并补存编辑器中未保存的修改
  const [backendOnline, setBackendOnline] = useState(true);
  const [backendRestarting, setBackendRestarting] = useState(false);
  const backendOnlineRef = useRef(true);
  const backendCheckRef = useRef<Promise<void> | null>(null);

  const handleBackendReconnected = useCallback(async () => {
    try {
      if (workspacePath) {
        const ws = await getWorkspace();
        if (ws.path !== workspacePath) {
          // 重启后的后端不一定加载了当前工作区
          await setWorkspace(workspacePath);
        }
        await refreshTree();
      }
    } catch {
      // 再次断线交给下一次心跳处理
    }
    await flushSave();
  }, [workspacePath, refreshTree, flushSave]);
  const handleBackendReconnectedRef = useRef(handleBackendReconnected);
  handleBackendReconnectedRef.current = handleBackendReconnected;

  // 保持引用稳定，避免每次渲染都重置心跳定时器
  const checkBackend = useCallback((): Promise<void> => {
    if (!backendCheckRef.current) {
      backendCheckRef.current = (async () => {
        const online = backendOnlineRef.current ? await healthCheck() : await reconnectBackend();
        if (online === backendOnlineRef.current) return;
        backendOnlineRef.current = online;
        setBackendOnline(online);
        if (online) await handleBackendReconnectedRef.current();
      })().finally(() => {
        backendCheckRef.current = null;
      });
    }
    return backendCheckRef.current;
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    const timer = window.setInterval(() => void checkBackend(), backendOnline ? 5000 : 3000);
    return () => window.clearInterval(timer);
  }, [ready, backendOnline, checkBackend]);

  // 保存失败时立即探测，断线提示无需等到下一次心跳
  useEffect(() => {
    if (saveStatus === 'error') void checkBackend();
  }, [saveStatus, checkBackend]);

  const handleRestartBackend = useCallback(async () => {
    const restart = window.nextTyproa?.restartBackend;
    if (!restart) return;
    setBackendRestarting(true);
    try {
      const result = await restart();
      if (!result.ok) {
        if (result.reason === 'dev') {
          showError('开发模式下后端由 npm run dev 管理，请在终端中重启后端。');
        }
        return;
      }
      await checkBackend();
    } catch (e) {
      showError(describeError(e, '重启后端服务失败'));
    } finally {
      setBackendRestarting(false);
    }
  }, [checkBackend, showError]);

  useEffect(() => {
    if (!workspacePath) return;
    if (tree.length === 0) return;

    const directoryPaths = collectDirectoryPaths(tree);
    const current = fileTreeExpandedFolders[workspacePath];
    if (!current) return;

    const filtered = current.filter((path) => directoryPaths.has(path));
    if (filtered.length !== current.length) {
      setWorkspaceExpandedFolders(workspacePath, filtered);
    }
  }, [fileTreeExpandedFolders, setWorkspaceExpandedFolders, tree, workspacePath]);

  useEffect(() => {
    if (!workspacePath || !selectedPath) return;

    const parents = parentFolderPathsOf(selectedPath);
    if (parents.length === 0) return;

    addWorkspaceExpandedFolders(workspacePath, parents);
  }, [addWorkspaceExpandedFolders, selectedPath, workspacePath]);

  useEffect(() => {
    if (!ready || !workspacePath) return undefined;

    const refresh = async () => {
      try {
        await refreshWorkspaceTree();

        if (!selectedPath || saveConflict) return;
        const diskNote = await getNote(selectedPath);
        if (diskNote.contentHash === contentHash) return;

        if (isDirty) {
          setSaveConflict({
            path: diskNote.path,
            currentHash: diskNote.contentHash,
            currentUpdatedAt: diskNote.updatedAt || '',
            message: 'Note was modified outside NextTyproa',
          });
          return;
        }

        setContent(diskNote.content);
        setLoadedContent(diskNote.content);
        setContentHash(diskNote.contentHash);
        setEditorRevision((revision) => revision + 1);
        messageApi.info('已载入磁盘上的最新版本');
      } catch {
        // 外部刷新不能打断写作流程，错误保留给显式操作提示
      }
    };

    const interval = window.setInterval(() => {
      void refresh();
    }, 8000);
    return () => window.clearInterval(interval);
  }, [contentHash, isDirty, messageApi, ready, refreshWorkspaceTree, saveConflict, selectedPath, workspacePath]);

  const clearMarkdownState = useCallback(() => {
    setSelectedPath('');
    setContent('');
    setLoadedContent('');
    setContentHash('');
    setSaveConflict(null);
  }, []);

  const clearCurrentDocumentState = useCallback(() => {
    openSeqRef.current += 1;
    clearMarkdownState();
    setUnsupportedPreviewPath('');
    setSelectedTreeItem(null);
    setSearchResults([]);
    setSearchOpen(false);
  }, [clearMarkdownState]);

  const clearLastOpenedFile = useCallback(async () => {
    await window.nextTyproa?.patchAppSettings?.({ lastOpenedFile: undefined }).catch(() => undefined);
  }, []);

  const applyWorkspace = useCallback(async (folderPath: string) => {
    const result = await setWorkspace(folderPath);
    setWorkspacePath(result.path);
    setSelectedTreeItem(null);
    setUnsupportedPreviewPath('');
    await refreshTree();
    await window.nextTyproa?.setLastWorkspace?.(result.path);
    rememberWorkspace(result.path);
    return result.path;
  }, [refreshTree, rememberWorkspace]);

  const openNoteAt = useCallback(async (folderPath: string, relativePath: string) => {
    if (!isMarkdownPath(relativePath)) {
      throw new Error('暂不支持该文件浏览');
    }

    const seq = ++openSeqRef.current;
    const saved = await flushSave();
    if (!saved) {
      throw new Error('保存失败，无法切换笔记');
    }
    if (seq !== openSeqRef.current) return;

    const targetFolder = folderPath || workspacePath;
    if (!targetFolder) {
      throw new Error('请先打开本地文件夹');
    }
    const folder = !foldersEqual(targetFolder, workspacePath)
      ? await applyWorkspace(targetFolder)
      : targetFolder;
    if (seq !== openSeqRef.current) return;

    const note = await getNote(relativePath);
    if (seq !== openSeqRef.current) return;

    setSelectedPath(note.path);
    setUnsupportedPreviewPath('');
    setSelectedTreeItem({ path: note.path, isDirectory: false });
    setContent(note.content);
    setLoadedContent(note.content);
    setContentHash(note.contentHash);
    setEditorRevision((revision) => revision + 1);
    setSaveConflict(null);
    setSearchResults([]);
    setSearchOpen(false);
    setSidebarTab('files');
    rememberOpenedNote(folder, note);
    await window.nextTyproa?.rememberOpenedFile?.({
      folder,
      relativePath: note.path,
    });
  }, [workspacePath, applyWorkspace, flushSave, rememberOpenedNote]);

  const bootstrap = useCallback(async () => {
    setError('');
    await initApiConfig();

    let healthy = false;
    for (let i = 0; i < 30; i++) {
      healthy = await healthCheck();
      if (healthy) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!healthy) {
      setError('无法连接后端服务，请确认 Spring Boot 已启动。');
      return;
    }

    const settings = await loadAndApplyPreferenceSettings();
    setImageSettings(settings);
    setSpellCheckEnabled(settings.spellCheckEnabled);
    setFileTreeExpandedFolders(settings.fileTreeExpandedFolders ?? {});
    setThemeId(settings.themeId);
    setEditorThemeId(settings.editorThemeId);
    setCustomCss(settings.customCss);
    setShortcutOverrides(settings.shortcuts);
    setRecentFiles(settings.recentFiles);
    setRecentWorkspaces(settings.recentWorkspaces);
    setOpenTabs(settings.openTabs);
    setActiveTabPath(settings.activeTabPath);
    setWritingModes(settings.writingModes);

    const ws = await getWorkspace();
    let wsPath = ws.path;

    if (!wsPath && settings.lastWorkspace) {
      wsPath = await applyWorkspace(settings.lastWorkspace);
    } else {
      setWorkspacePath(wsPath);
      setSelectedTreeItem(null);
      setUnsupportedPreviewPath('');
      if (wsPath) {
        await refreshTree();
      }
    }

    const restoredTabPath = settings.activeTabPath && settings.openTabs.some((tab) => tab.path === settings.activeTabPath)
      ? settings.activeTabPath
      : settings.openTabs[0]?.path;
    const last = settings.lastOpenedFile;
    const pathToRestore = restoredTabPath || (last?.folder && foldersEqual(last.folder, wsPath) ? last.relativePath : undefined);

    if (wsPath && pathToRestore && isMarkdownPath(pathToRestore)) {
      try {
        const note = await getNote(pathToRestore);
        setSelectedPath(note.path);
        setUnsupportedPreviewPath('');
        setContent(note.content);
        setLoadedContent(note.content);
        setContentHash(note.contentHash);
        setEditorRevision((revision) => revision + 1);
        setSaveConflict(null);
        setSelectedTreeItem({ path: note.path, isDirectory: false });
        setActiveTabPath(note.path);
        setOpenTabs((prev) => upsertEditorTab(prev, makeEditorTab(note)));
      } catch {
        const nextTabs = settings.openTabs.map((tab) => (
          tab.path === pathToRestore
            ? { ...tab, missing: true, saveStatus: 'error' as const }
            : tab
        ));
        setOpenTabs(nextTabs);
        if (settings.openTabs.some((tab) => tab.path === pathToRestore)) {
          setActiveTabPath(pathToRestore);
          void patchStoredAppSettings({ openTabs: nextTabs, activeTabPath: pathToRestore }).catch(() => undefined);
        }
      }
    }

    setReady(true);
  }, [refreshTree, applyWorkspace]);

  useEffect(() => {
    if (!ready || !pendingOpenPathRef.current) return;
    const pendingPath = pendingOpenPathRef.current;
    pendingOpenPathRef.current = null;
    void (async () => {
      try {
        const { dir, relativePath } = parseLocalMarkdownPath(pendingPath);
        if (!dir || !relativePath) return;
        await openNoteAt(dir, relativePath);
      } catch (e) {
        showError(describeError(e, '打开文件失败'));
      }
    })();
  }, [ready, openNoteAt, showError]);

  useEffect(() => {
    bootstrap().catch((e: Error) => setError(e.message));
  }, [bootstrap]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        void flushSave();
      }
    };
    window.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [flushSave]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (selectedPath && content !== loadedContent) {
        void flushSave();
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [selectedPath, content, loadedContent, flushSave]);

  useEffect(() => {
    if (!selectedPath) return;
    setOpenTabs((prev) => {
      const next = prev.map((tab) => (
        tab.path === selectedPath
          ? { ...tab, content, loadedContent, contentHash, saveStatus }
          : tab
      ));
      void patchStoredAppSettings({ openTabs: next, activeTabPath: selectedPath }).catch(() => undefined);
      return next;
    });
  }, [content, contentHash, loadedContent, saveStatus, selectedPath]);

  useEffect(() => {
    applyThemeToRoot(document.documentElement, themeId, editorThemeId);
  }, [editorThemeId, themeId]);

  const ensureWorkspace = useCallback(async (): Promise<boolean> => {
    if (workspacePath) return true;
    if (!window.nextTyproa?.selectWorkspaceFolder) {
      showError('请先打开本地文件夹（工具栏文件夹图标或 文件 → 打开文件夹）');
      return false;
    }
    const selected = await window.nextTyproa.selectWorkspaceFolder();
    if (!selected) return false;
    await applyWorkspace(selected);
    return true;
  }, [workspacePath, applyWorkspace, showError]);

  const getCreateParentPath = useCallback(() => {
    if (!selectedTreeItem) return '';
    return selectedTreeItem.isDirectory ? selectedTreeItem.path : parentPathOf(selectedTreeItem.path);
  }, [selectedTreeItem]);

  const openCreateDialog = useCallback(async (kind: CreateKind, parentPath?: string) => {
    try {
      const hasWorkspace = await ensureWorkspace();
      if (!hasWorkspace) return;
      setCreateName(kind === 'markdown' ? 'untitled.md' : '新建文件夹');
      setCreateDialog({ kind, parentPath: parentPath ?? getCreateParentPath() });
    } catch (e) {
      showError(describeError(e, '无法新建文件'));
    }
  }, [ensureWorkspace, getCreateParentPath, showError]);

  const handleCreateMarkdown = useCallback((parentPath?: string) => {
    return openCreateDialog('markdown', parentPath);
  }, [openCreateDialog]);

  const handleCreateFolder = useCallback((parentPath?: string) => {
    return openCreateDialog('folder', parentPath);
  }, [openCreateDialog]);

  const handleOpenFolder = useCallback(async () => {
    try {
      if (!window.nextTyproa?.selectWorkspaceFolder) {
        setAlertMessage('开发模式下请使用 Electron 桌面版以打开本地文件夹');
        setAlertOpen(true);
        return;
      }
      const selected = await window.nextTyproa.selectWorkspaceFolder();
      if (!selected) return;
      const saved = await flushSave();
      if (!saved) {
        showError('保存失败，无法切换文件夹');
        return;
      }
      clearCurrentDocumentState();
      await clearLastOpenedFile();
      await applyWorkspace(selected);
    } catch (e) {
      showError(describeError(e, '打开文件夹失败'));
    }
  }, [applyWorkspace, clearCurrentDocumentState, clearLastOpenedFile, flushSave, showError]);

  const handleOpenFile = useCallback(async () => {
    try {
      if (!window.nextTyproa?.selectMarkdownFile) {
        setAlertMessage('开发模式下请使用 Electron 桌面版以打开本地 Markdown 文件');
        setAlertOpen(true);
        return;
      }
      const picked = await window.nextTyproa.selectMarkdownFile();
      if (!picked) return;
      await openNoteAt(picked.dir, picked.relativePath);
    } catch (e) {
      showError(describeError(e, '打开文件失败'));
    }
  }, [openNoteAt, showError]);

  const handleOpenAbsoluteFile = useCallback(async (fullPath: string) => {
    if (!ready) {
      pendingOpenPathRef.current = fullPath;
      return;
    }
    try {
      const { dir, relativePath } = parseLocalMarkdownPath(fullPath);
      if (!dir || !relativePath) return;
      await openNoteAt(dir, relativePath);
    } catch (e) {
      showError(describeError(e, '打开文件失败'));
    }
  }, [openNoteAt, ready, showError]);

  const prepareExportHtml = useCallback(async () => {
    if (!selectedPath) {
      showError('请先打开一个 Markdown 文件');
      return null;
    }
    if (saveConflict) {
      showError('检测到外部修改，请先处理冲突后再导出');
      return null;
    }

    const saved = await flushSave();
    if (!saved) {
      showError('保存失败，已中止导出');
      return null;
    }

    return exportHtml(selectedPath);
  }, [flushSave, saveConflict, selectedPath, showError]);

  const handleExportHtml = useCallback(async () => {
    setExportLoading('html');
    try {
      const exported = await prepareExportHtml();
      if (!exported) return;

      const defaultPath = exportBaseName(exported.path || selectedPath, 'html');
      if (window.nextTyproa?.showSaveDialog && window.nextTyproa?.saveTextFile) {
        const filePath = await window.nextTyproa.showSaveDialog({
          title: '导出为 HTML',
          defaultPath,
          filters: [{ name: 'HTML', extensions: ['html'] }],
        });
        if (!filePath) return;
        await window.nextTyproa.saveTextFile({ path: filePath, content: exported.html });
        messageApi.success('HTML 已导出');
        return;
      }

      downloadTextFile(exported.html, defaultPath, 'text/html;charset=utf-8');
      messageApi.success('HTML 已导出');
    } catch (e) {
      showError(describeError(e, '导出 HTML 失败'));
    } finally {
      setExportLoading(null);
    }
  }, [messageApi, prepareExportHtml, selectedPath, showError]);

  const handleExportPdf = useCallback(async () => {
    setExportLoading('pdf');
    try {
      if (!window.nextTyproa?.exportPdf) {
        showError('PDF 导出需要在 Electron 桌面版中使用');
        return;
      }

      const exported = await prepareExportHtml();
      if (!exported) return;

      const result = await window.nextTyproa.exportPdf({
        html: exported.html,
        defaultPath: exportBaseName(exported.path || selectedPath, 'pdf'),
      });
      if (result) {
        messageApi.success('PDF 已导出');
      }
    } catch (e) {
      showError(describeError(e, '导出 PDF 失败'));
    } finally {
      setExportLoading(null);
    }
  }, [messageApi, prepareExportHtml, selectedPath, showError]);

  useEffect(() => {
    const unsubFolder = window.nextTyproa?.onMenuOpenFolder?.(() => {
      void handleOpenFolder();
    });
    const unsubFile = window.nextTyproa?.onMenuOpenFile?.(() => {
      void handleOpenFile();
    });
    const unsubPath = window.nextTyproa?.onOpenFilePath?.((filePath) => {
      void handleOpenAbsoluteFile(filePath);
    });
    const unsubFlush = window.nextTyproa?.onRequestFlushSave?.(() => {
      // 存在未解决的冲突时 flushSave 会跳过保存，需告知主进程仍有未保存修改
      const blockedByConflict = Boolean(saveConflict) && isDirty;
      void flushSave()
        .catch(() => false)
        .then((saved) => window.nextTyproa?.notifyFlushSaveDone?.(saved && !blockedByConflict));
    });
    const unsubSettings = window.nextTyproa?.onMenuOpenSettings?.(() => {
      setSettingsOpen(true);
    });
    const unsubCreate = window.nextTyproa?.onMenuCreateNote?.(() => {
      void handleCreateMarkdown();
    });
    const unsubExportHtml = window.nextTyproa?.onMenuExportHtml?.(() => {
      void handleExportHtml();
    });
    const unsubExportPdf = window.nextTyproa?.onMenuExportPdf?.(() => {
      void handleExportPdf();
    });
    const unsubSave = window.nextTyproa?.onMenuSave?.(() => {
      void flushSave();
    });
    const unsubToggleSource = window.nextTyproa?.onMenuToggleSource?.(() => {
      if (selectedPath) {
        setEditorMode((mode) => (mode === 'source' ? 'wysiwyg' : 'source'));
      }
    });
    const unsubToggleSidebar = window.nextTyproa?.onMenuToggleSidebar?.(() => {
      setSidebarOpen((open) => !open);
    });
    return () => {
      unsubFolder?.();
      unsubFile?.();
      unsubPath?.();
      unsubFlush?.();
      unsubSettings?.();
      unsubCreate?.();
      unsubExportHtml?.();
      unsubExportPdf?.();
      unsubSave?.();
      unsubToggleSource?.();
      unsubToggleSidebar?.();
    };
  }, [handleCreateMarkdown, handleExportHtml, handleExportPdf, handleOpenAbsoluteFile, handleOpenFile, handleOpenFolder, flushSave, isDirty, saveConflict, selectedPath]);

  const handleSelectUnsupportedFile = useCallback(async (path: string) => {
    try {
      if (!workspacePath) {
        showError('请先打开本地文件夹');
        return;
      }
      const seq = ++openSeqRef.current;
      const saved = await flushSave();
      if (!saved) {
        showError('保存失败，无法切换文件');
        return;
      }
      if (seq !== openSeqRef.current) return;
      clearMarkdownState();
      setSelectedTreeItem({ path, isDirectory: false });
      setUnsupportedPreviewPath(path);
      setSearchResults([]);
      setSearchOpen(false);
    } catch (e) {
      showError(describeError(e, '打开文件失败'));
    }
  }, [workspacePath, clearMarkdownState, flushSave, showError]);

  const handleSelectNote = useCallback(async (path: string) => {
    if (!isMarkdownPath(path)) {
      await handleSelectUnsupportedFile(path);
      return;
    }

    try {
      if (!workspacePath) {
        showError('请先打开本地文件夹');
        return;
      }
      await openNoteAt(workspacePath, path);
    } catch (e) {
      showError(describeError(e, '打开笔记失败'));
    }
  }, [workspacePath, openNoteAt, handleSelectUnsupportedFile, showError]);

  const handleSelectFile = useCallback((path: string) => {
    void handleSelectNote(path);
  }, [handleSelectNote]);

  const handleSelectTab = useCallback(async (path: string): Promise<boolean> => {
    try {
      await openNoteAt(workspacePath, path);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        markEditorTabMissing(path, true);
        clearMarkdownState();
        setUnsupportedPreviewPath('');
        setSelectedTreeItem(null);
        setSearchResults([]);
        setSearchOpen(false);
        showError('文件缺失或已被移动，已保留标签用于确认');
        return false;
      }
      showError(describeError(e, '打开标签页失败'));
      return false;
    }
  }, [clearMarkdownState, markEditorTabMissing, openNoteAt, showError, workspacePath]);

  const handleCloseTab = useCallback(async (path: string) => {
    const currentTabs = openTabs;
    const tabIndex = currentTabs.findIndex((tab) => tab.path === path);
    if (tabIndex < 0) return;

    const saved = await saveTabsBeforeRemoving([currentTabs[tabIndex]]);
    if (!saved) return;

    const nextTabs = closeEditorTab(currentTabs, path);
    const closingActive = path === selectedPath || path === activeTabPath;

    setOpenTabs(nextTabs);

    if (!closingActive) {
      void patchStoredAppSettings({ openTabs: nextTabs, activeTabPath }).catch(() => undefined);
      return;
    }

    const nextActive = nextTabs[Math.min(tabIndex, nextTabs.length - 1)] ?? nextTabs[tabIndex - 1];
    if (nextActive) {
      setActiveTabPath(nextActive.path);
      void patchStoredAppSettings({ openTabs: nextTabs, activeTabPath: nextActive.path }).catch(() => undefined);
      const selected = await handleSelectTab(nextActive.path);
      if (!selected) return;
      setOpenTabs(nextTabs);
      void patchStoredAppSettings({ openTabs: nextTabs, activeTabPath: nextActive.path }).catch(() => undefined);
      return;
    }

    setActiveTabPath(undefined);
    clearCurrentDocumentState();
    await clearLastOpenedFile();
    void patchStoredAppSettings({ openTabs: [], activeTabPath: undefined }).catch(() => undefined);
  }, [activeTabPath, clearCurrentDocumentState, clearLastOpenedFile, handleSelectTab, openTabs, saveTabsBeforeRemoving, selectedPath]);

  const handleCloseOtherTabs = useCallback(async (path: string) => {
    const kept = openTabs.filter((tab) => tab.path === path);
    const removed = openTabs.filter((tab) => tab.path !== path);
    const saved = await saveTabsBeforeRemoving(removed);
    if (!saved) return;

    setOpenTabs(kept);
    void patchStoredAppSettings({ openTabs: kept, activeTabPath: path }).catch(() => undefined);
    if (path !== selectedPath) {
      await handleSelectTab(path);
      setOpenTabs(kept);
      void patchStoredAppSettings({ openTabs: kept, activeTabPath: path }).catch(() => undefined);
    }
  }, [handleSelectTab, openTabs, saveTabsBeforeRemoving, selectedPath]);

  const handleCloseRightTabs = useCallback(async (path: string) => {
    const index = openTabs.findIndex((tab) => tab.path === path);
    if (index < 0) return;
    const kept = openTabs.slice(0, index + 1);
    const removed = openTabs.slice(index + 1);
    const saved = await saveTabsBeforeRemoving(removed);
    if (!saved) return;

    setOpenTabs(kept);
    const nextActive = kept.some((tab) => tab.path === activeTabPath) ? activeTabPath : path;
    setActiveTabPath(nextActive);
    void patchStoredAppSettings({ openTabs: kept, activeTabPath: nextActive }).catch(() => undefined);
    if (nextActive && nextActive !== selectedPath) {
      await handleSelectTab(nextActive);
      setOpenTabs(kept);
      void patchStoredAppSettings({ openTabs: kept, activeTabPath: nextActive }).catch(() => undefined);
    }
  }, [activeTabPath, handleSelectTab, openTabs, saveTabsBeforeRemoving, selectedPath]);

  const handleNextTab = useCallback(() => {
    if (openTabs.length <= 1) return;
    const currentIndex = openTabs.findIndex((tab) => tab.path === (activeTabPath || selectedPath));
    const next = openTabs[(currentIndex + 1 + openTabs.length) % openTabs.length];
    if (next) {
      void handleSelectTab(next.path);
    }
  }, [activeTabPath, handleSelectTab, openTabs, selectedPath]);

  const handleSelectFolder = useCallback((folderPath: string) => {
    setSelectedTreeItem({ path: folderPath, isDirectory: true });
    setUnsupportedPreviewPath('');
  }, []);

  const handleHighlightTreeSelection = useCallback((selection: TreeSelection) => {
    setSelectedTreeItem(selection);
    if (selection.isDirectory) {
      setUnsupportedPreviewPath('');
    }
  }, []);

  const handleRenameRequest = useCallback((target: TreeSelection) => {
    setSelectedTreeItem(target);
    setRenameTarget(target);
    setRenameName(noteDisplayName(target.path));
    if (target.isDirectory) {
      setUnsupportedPreviewPath('');
    }
  }, []);

  const handleDeleteRequest = useCallback((target: TreeSelection) => {
    setSelectedTreeItem(target);
    setDeleteTarget(target);
    if (target.isDirectory) {
      setUnsupportedPreviewPath('');
    }
  }, []);

  const handleMoveToRequest = useCallback((source: TreeSelection) => {
    const destinationOptions = collectMoveDestinationOptions(tree, source);
    if (destinationOptions.length === 0) {
      messageApi.warning('没有可移动到的位置');
      return;
    }

    setSelectedTreeItem(source);
    setMoveDialog({
      source,
      targetFolderPath: destinationOptions[0].path,
    });
    if (source.isDirectory) {
      setUnsupportedPreviewPath('');
    }
  }, [messageApi, tree]);

  const handleMoveRequest = useCallback(async (source: TreeSelection, targetFolderPath: string) => {
    const normalizedTargetFolder = normalizeTreePath(targetFolderPath);
    const normalizedSource = normalizeTreePath(source.path);

    if (!normalizedSource || normalizedSource === normalizedTargetFolder) {
      messageApi.warning('不能移动到自身');
      return;
    }
    if (source.isDirectory && normalizedTargetFolder.startsWith(`${normalizedSource}/`)) {
      messageApi.warning('不能移动到自身的子目录');
      return;
    }

    const currentMarkdownPath = selectedPath;
    const currentUnsupportedPath = unsupportedPreviewPath;

    try {
      const saved = await flushSave();
      if (!saved) {
        showError('保存失败，无法移动文件');
        return;
      }

      const result = await movePath(normalizedSource, normalizedTargetFolder);
      await refreshTree();
      syncTabsAfterPathChange(source, result.path);
      addWorkspaceExpandedFolders(workspacePath, [normalizedTargetFolder]);
      messageApi.success('移动成功');

      const movedSelection: TreeSelection = { path: result.path, isDirectory: result.directory };
      setSelectedTreeItem(movedSelection);
      setSearchResults([]);
      setSearchOpen(false);

      if (currentMarkdownPath && isPathAffected(currentMarkdownPath, source)) {
        const nextMarkdownPath = replaceAffectedPath(currentMarkdownPath, source, result.path);
        setSelectedPath(nextMarkdownPath);
        setUnsupportedPreviewPath('');
        setSelectedTreeItem({ path: nextMarkdownPath, isDirectory: false });
        await window.nextTyproa?.rememberOpenedFile?.({
          folder: workspacePath,
          relativePath: nextMarkdownPath,
        }).catch(() => undefined);
        return;
      }

      if (currentUnsupportedPath && isPathAffected(currentUnsupportedPath, source)) {
        const nextUnsupportedPath = replaceAffectedPath(currentUnsupportedPath, source, result.path);
        if (isMarkdownPath(nextUnsupportedPath)) {
          setUnsupportedPreviewPath('');
          await openNoteAt(workspacePath, nextUnsupportedPath);
        } else {
          clearMarkdownState();
          setUnsupportedPreviewPath(nextUnsupportedPath);
          setSelectedTreeItem({ path: nextUnsupportedPath, isDirectory: false });
        }
      }
    } catch (e) {
      showFileOperationError(e, '移动失败');
    }
  }, [
    clearMarkdownState,
    addWorkspaceExpandedFolders,
    flushSave,
    messageApi,
    openNoteAt,
    refreshTree,
    selectedPath,
    setSearchOpen,
    setSearchResults,
    showError,
    showFileOperationError,
    syncTabsAfterPathChange,
    unsupportedPreviewPath,
    workspacePath,
  ]);

  const submitCreate = async () => {
    if (!createDialog) return;
    const rawName = createName.trim();
    if (!rawName) return;
    const nameError = windowsPathError(createDialog.kind === 'folder' ? rawName : markdownName(rawName));
    if (nameError) {
      // 保持对话框打开，方便用户直接修改名称
      messageApi.warning(nameError);
      return;
    }
    setCreateDialog(null);
    try {
      const saved = await flushSave();
      if (!saved) {
        showError('保存失败，无法新建文件');
        return;
      }

      if (createDialog.kind === 'folder') {
        const targetPath = resolveCreatePath(rawName, createDialog.parentPath);
        const result = await createFolder(targetPath);
        await refreshTree();
        setSelectedTreeItem({ path: result.path, isDirectory: result.directory });
        setUnsupportedPreviewPath('');
        messageApi.success('创建成功');
        return;
      }

      const targetPath = resolveCreatePath(markdownName(rawName), createDialog.parentPath);
      // 如果是从文件缺失对话框触发的另存为，使用保存的内容
      const contentToSave = fileMissingDialog?.content || '# 新笔记\n\n';
      const note = await createNote(targetPath, contentToSave);
      await refreshTree();
      messageApi.success('创建成功');

      // 如果是从文件缺失对话框触发的，关闭旧标签页
      if (fileMissingDialog) {
        await handleCloseTab(fileMissingDialog.path);
        setFileMissingDialog(null);
      }

      await handleSelectNote(note.path);
    } catch (e) {
      showFileOperationError(e, '新建文件失败');
    }
  };

  const submitMoveTo = async () => {
    if (!moveDialog) return;

    const destinationStillValid = moveDestinationOptions.some((option) => option.path === moveDialog.targetFolderPath);
    if (!destinationStillValid) {
      messageApi.warning('请选择有效的目标位置');
      return;
    }

    const { source, targetFolderPath } = moveDialog;
    setMoveDialog(null);
    await handleMoveRequest(source, targetFolderPath);
  };

  const submitRename = async () => {
    if (!renameTarget) return;
    const nextName = renameName.trim();
    if (!nextName) return;
    const nameError = windowsFileNameError(nextName);
    if (nameError) {
      // 保持对话框打开，方便用户直接修改名称
      messageApi.warning(nameError);
      return;
    }
    const target = renameTarget;
    const currentMarkdownPath = selectedPath;
    const currentUnsupportedPath = unsupportedPreviewPath;
    setRenameTarget(null);
    try {
      const saved = await flushSave();
      if (!saved) {
        showError('保存失败，无法重命名');
        return;
      }

      const result = await renamePath(target.path, nextName);
      await refreshTree();
      syncTabsAfterPathChange(target, result.path);
      messageApi.success('重命名成功');

      const renamedSelection: TreeSelection = { path: result.path, isDirectory: result.directory };
      setSelectedTreeItem(renamedSelection);

      if (currentMarkdownPath && isPathAffected(currentMarkdownPath, target)) {
        const nextMarkdownPath = replaceAffectedPath(currentMarkdownPath, target, result.path);
        if (isMarkdownPath(nextMarkdownPath)) {
          setSelectedPath(nextMarkdownPath);
          setUnsupportedPreviewPath('');
          setSelectedTreeItem({ path: nextMarkdownPath, isDirectory: false });
          await window.nextTyproa?.rememberOpenedFile?.({
            folder: workspacePath,
            relativePath: nextMarkdownPath,
          }).catch(() => undefined);
        } else {
          clearMarkdownState();
          setUnsupportedPreviewPath(nextMarkdownPath);
          setSelectedTreeItem({ path: nextMarkdownPath, isDirectory: false });
          setSearchResults([]);
          setSearchOpen(false);
          await clearLastOpenedFile();
        }
        return;
      }

      if (currentUnsupportedPath && isPathAffected(currentUnsupportedPath, target)) {
        const nextUnsupportedPath = replaceAffectedPath(currentUnsupportedPath, target, result.path);
        if (isMarkdownPath(nextUnsupportedPath)) {
          setUnsupportedPreviewPath('');
          await openNoteAt(workspacePath, nextUnsupportedPath);
        } else {
          clearMarkdownState();
          setUnsupportedPreviewPath(nextUnsupportedPath);
          setSelectedTreeItem({ path: nextUnsupportedPath, isDirectory: false });
        }
      }
    } catch (e) {
      showFileOperationError(e, '重命名失败');
    }
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const deletesMarkdown = Boolean(selectedPath && isPathAffected(selectedPath, target));
    const deletesUnsupported = Boolean(unsupportedPreviewPath && isPathAffected(unsupportedPreviewPath, target));
    setDeleteTarget(null);
    try {
      const saved = await flushSave();
      if (!saved) {
        showError('保存失败，无法删除');
        return;
      }
      await deletePath(target.path);
      await refreshTree();
      const nextTabs = openTabs.filter((tab) => !isPathAffected(tab.path, target));
      setOpenTabs(nextTabs);
      void patchStoredAppSettings({
        openTabs: nextTabs,
        activeTabPath: activeTabPath && isPathAffected(activeTabPath, target) ? undefined : activeTabPath,
      }).catch(() => undefined);
      messageApi.success('删除成功');

      if (deletesMarkdown) {
        clearMarkdownState();
        setActiveTabPath(undefined);
        setSelectedTreeItem(null);
        setSearchResults([]);
        setSearchOpen(false);
        await clearLastOpenedFile();
      }

      if (deletesUnsupported) {
        setUnsupportedPreviewPath('');
      }

      if (!deletesMarkdown && (deletesUnsupported || (selectedTreeItem && isPathAffected(selectedTreeItem.path, target)))) {
        setSelectedTreeItem(null);
      }
    } catch (e) {
      showFileOperationError(e, '删除失败');
    }
  };

  const handleReloadConflict = async () => {
    if (!selectedPath) return;
    const note = await getNote(selectedPath);
    setContent(note.content);
    setLoadedContent(note.content);
    setContentHash(note.contentHash);
    setEditorRevision((revision) => revision + 1);
    setSaveConflict(null);
    messageApi.success('已重新载入磁盘版本');
  };

  const handleSaveConflictCopy = async () => {
    if (!selectedPath) return;
    const copy = await createNote(conflictCopyPath(selectedPath), content);
    await refreshTree();
    setSelectedPath(copy.path);
    setUnsupportedPreviewPath('');
    setSelectedTreeItem({ path: copy.path, isDirectory: false });
    setContent(copy.content);
    setLoadedContent(copy.content);
    setContentHash(copy.contentHash);
    setEditorRevision((revision) => revision + 1);
    setSaveConflict(null);
    await window.nextTyproa?.rememberOpenedFile?.({
      folder: workspacePath,
      relativePath: copy.path,
    }).catch(() => undefined);
    messageApi.success('已保存为冲突副本');
  };

  const handleForceOverwrite = async () => {
    if (!selectedPath) return;
    const note = await saveNote(selectedPath, content, contentHash, true);
    setContent(note.content);
    setLoadedContent(note.content);
    setContentHash(note.contentHash);
    setEditorRevision((revision) => revision + 1);
    setSaveConflict(null);
    messageApi.success('已强制覆盖磁盘版本');
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && writingModes.distractionFreeMode) {
        event.preventDefault();
        patchWritingModes({ distractionFreeMode: false });
        return;
      }

      const action = findShortcutAction(shortcutBindings, event);
      if (!action) return;

      event.preventDefault();

      if (action === 'open-file') void handleOpenFile();
      if (action === 'open-folder') void handleOpenFolder();
      if (action === 'new-note') void handleCreateMarkdown();
      if (action === 'save') void flushSave();
      if (action === 'close-tab') {
        const targetPath = activeTabPath || selectedPath;
        if (targetPath) void handleCloseTab(targetPath);
      }
      if (action === 'next-tab') handleNextTab();
      if (action === 'open-quickly') {
        setQuickOpen(true);
      }
      if (action === 'search-notes') {
        setSidebarOpen(true);
        setSearchOpen(true);
        setToolbarSearchExpanded(true);
        setSidebarTab('search');
      }
      if (action === 'find-current-document') setFindOpen(true);
      if (action === 'replace-current-document') setFindOpen(true);
      if (action === 'toggle-source' && selectedPath) {
        setEditorMode((mode) => (mode === 'source' ? 'wysiwyg' : 'source'));
      }
      if (action === 'toggle-sidebar') setSidebarOpen((open) => !open);
      if (action === 'open-outline-sidebar') {
        setSidebarOpen(true);
        setSidebarTab('outline');
      }
      if (action === 'open-file-sidebar') {
        setSidebarOpen(true);
        setSidebarTab('files');
      }
      if (action === 'toggle-focus-mode') patchWritingModes({ focusMode: !writingModes.focusMode });
      if (action === 'toggle-typewriter-mode') patchWritingModes({ typewriterMode: !writingModes.typewriterMode });
      if (action === 'toggle-distraction-free') patchWritingModes({ distractionFreeMode: !writingModes.distractionFreeMode });
      if (action === 'export-html') void handleExportHtml();
      if (action === 'export-pdf') void handleExportPdf();
      if (action === 'open-settings') setSettingsOpen(true);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    flushSave,
    handleCreateMarkdown,
    handleExportHtml,
    handleExportPdf,
    handleOpenFile,
    handleOpenFolder,
    handleCloseTab,
    handleNextTab,
    patchWritingModes,
    activeTabPath,
    selectedPath,
    setFindOpen,
    shortcutBindings,
    writingModes,
  ]);

  const shellTheme = getThemeDefinition(themeId);
  const editorTheme = getThemeDefinition(editorThemeId);
  const shellIsDark = shellTheme.shellMode === 'dark';
  const editorIsDark = editorTheme.shellMode === 'dark';

  const antdThemeConfig = {
    algorithm: shellIsDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: {
      colorPrimary: shellIsDark ? '#67b7ff' : '#0a84ff',
      colorBgBase: shellIsDark ? '#17191d' : '#eef2f7',
      colorBgContainer: shellIsDark ? '#23262c' : '#fbfcfe',
      colorBgElevated: shellIsDark ? '#282c33' : '#ffffff',
      colorBorder: shellIsDark ? 'rgba(212, 220, 232, 0.16)' : 'rgba(83, 96, 117, 0.22)',
      colorText: shellIsDark ? '#eceff4' : '#1f2329',
      colorTextSecondary: shellIsDark ? '#bac3d0' : '#4c5564',
      colorTextTertiary: shellIsDark ? '#858f9e' : '#7c8797',
      borderRadius: 8,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
    },
    components: {
      Button: {
        borderRadius: 8,
        controlHeightSM: 28,
      },
      Input: {
        borderRadius: 8,
        activeShadow: shellIsDark ? '0 0 0 3px rgba(103, 183, 255, 0.25)' : '0 0 0 3px rgba(10, 132, 255, 0.24)',
      },
      Modal: {
        headerBg: 'transparent',
        contentBg: shellIsDark ? '#282c33' : '#ffffff',
      },
      Segmented: {
        itemSelectedBg: shellIsDark ? 'rgba(103, 183, 255, 0.16)' : 'rgba(10, 132, 255, 0.13)',
        itemSelectedColor: shellIsDark ? '#eceff4' : '#1f2329',
      },
      Select: {
        borderRadius: 8,
      },
    },
  };

  const shellClassName = [
    'typora-shell',
    writingModes.focusMode ? 'focus-mode' : '',
    writingModes.typewriterMode ? 'typewriter-mode' : '',
    writingModes.distractionFreeMode ? 'distraction-free-mode' : '',
  ].filter(Boolean).join(' ');

  if (error) {
    return (
      <ConfigProvider theme={antdThemeConfig}>
        <MotionConfig reducedMotion="user" transition={motionTransitions.standard}>
          <motion.div className="app-center-state app-entry-state" {...fadeSoftMotion}>
          <motion.div className="app-entry-card app-entry-card-error" {...sheetRevealMotion}>
            <span className="app-entry-mark" aria-hidden="true">N</span>
            <h1 className="app-brand">NextTyproa</h1>
            <Text className="app-entry-message" type="danger">{error}</Text>
            <Button type="primary" className="app-entry-action" onClick={() => bootstrap()}>重试</Button>
          </motion.div>
          </motion.div>
        </MotionConfig>
      </ConfigProvider>
    );
  }

  if (!ready) {
    return (
      <ConfigProvider theme={antdThemeConfig}>
        <MotionConfig reducedMotion="user" transition={motionTransitions.standard}>
          <motion.div className="app-center-state app-entry-state" {...fadeSoftMotion}>
          <motion.div className="app-entry-card" {...sheetRevealMotion}>
            <span className="app-entry-mark" aria-hidden="true">N</span>
            <Spin size="large" className="app-entry-spinner" />
            <Text className="app-entry-message">正在连接后端...</Text>
          </motion.div>
          </motion.div>
        </MotionConfig>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider theme={antdThemeConfig}>
      <MotionConfig reducedMotion="user" transition={motionTransitions.standard}>
      <div className={shellClassName}>
        {messageContextHolder}
        {customCss.trim() && (
          <style data-nexttyproa-editor-css>{scopeCustomEditorCss(customCss)}</style>
        )}
        {writingModes.distractionFreeMode && (
          <button
            type="button"
            className="distraction-free-exit"
            title="退出沉浸写作 (Esc)"
            aria-label="退出沉浸写作"
            onClick={() => patchWritingModes({ distractionFreeMode: false })}
          >
            <FullscreenExitOutlined />
          </button>
        )}
        <header className="typora-toolbar">
          <div className="window-chrome">
            <span className="window-brand-mark" aria-hidden>N</span>
            <span className="window-brand">NextTypora</span>
          </div>

          <div className="toolbar-section toolbar-left">
            <button type="button" className="toolbar-icon-btn" title="打开 Markdown 文件 (Ctrl+O)" onClick={handleOpenFile}>
              <FileTextOutlined />
            </button>
            <button type="button" className="toolbar-icon-btn" title="打开文件夹 (Ctrl+Shift+O)" onClick={handleOpenFolder}>
              <FolderOpenOutlined />
            </button>
            <button
              type="button"
              className="toolbar-icon-btn"
              title="新建笔记 (Ctrl+N)"
              onClick={() => { void handleCreateMarkdown(); }}
            >
              <FileAddOutlined />
            </button>
            <button
              type="button"
              className="toolbar-icon-btn toolbar-danger"
              title="删除笔记"
              disabled={!canDeleteSelectedNote}
              onClick={() => selectedPath && setDeleteTarget({ path: selectedPath, isDirectory: false })}
            >
              <DeleteOutlined />
            </button>
            <span className="toolbar-divider" />
            <button
              type="button"
              className="toolbar-icon-btn"
              title="导出为 HTML"
              disabled={!selectedPath || exportLoading !== null}
              onClick={() => { void handleExportHtml(); }}
            >
              <DownloadOutlined spin={exportLoading === 'html'} />
            </button>
            <button
              type="button"
              className="toolbar-icon-btn"
              title="导出为 PDF"
              disabled={!selectedPath || exportLoading !== null}
              onClick={() => { void handleExportPdf(); }}
            >
              <FilePdfOutlined spin={exportLoading === 'pdf'} />
            </button>
          </div>

          <div className="toolbar-section toolbar-center">
            <span className="document-title" title={absoluteFilePath || documentTitle}>
              {documentTitle}
            </span>
            {absoluteFilePath && (
              <span className="document-path" title={absoluteFilePath}>{absoluteFilePath}</span>
            )}
          </div>

          <div className="toolbar-section toolbar-right">
            <SaveIndicator status={selectedPath ? saveStatus : 'idle'} error={saveError} />
            <Segmented
              className="editor-mode-toggle"
              size="small"
              value={editorMode}
              onChange={(value) => setEditorMode(value as EditorMode)}
              options={[
                { label: '编辑', value: 'wysiwyg' },
                { label: '源码', value: 'source' },
              ]}
              disabled={!selectedPath}
            />
            <button
              type="button"
              className={`toolbar-icon-btn ${writingModes.focusMode ? 'active' : ''}`}
              title="专注模式 (Ctrl+Alt+F)"
              aria-label="专注模式"
              aria-pressed={writingModes.focusMode}
              onClick={() => patchWritingModes({ focusMode: !writingModes.focusMode })}
            >
              <HighlightOutlined />
            </button>
            <button
              type="button"
              className={`toolbar-icon-btn ${writingModes.typewriterMode ? 'active' : ''}`}
              title="打字机模式 (Ctrl+Shift+T)"
              aria-label="打字机模式"
              aria-pressed={writingModes.typewriterMode}
              onClick={() => patchWritingModes({ typewriterMode: !writingModes.typewriterMode })}
            >
              <PushpinOutlined />
            </button>
            <button
              type="button"
              className={`toolbar-icon-btn ${writingModes.distractionFreeMode ? 'active' : ''}`}
              title={writingModes.distractionFreeMode ? '退出沉浸写作 (Esc)' : '沉浸写作 (F11)'}
              aria-label={writingModes.distractionFreeMode ? '退出沉浸写作' : '沉浸写作'}
              aria-pressed={writingModes.distractionFreeMode}
              onClick={() => patchWritingModes({ distractionFreeMode: !writingModes.distractionFreeMode })}
            >
              {writingModes.distractionFreeMode ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            </button>
            <div className={`toolbar-search ${toolbarSearchVisible ? 'expanded' : ''}`}>
              {toolbarSearchVisible ? (
                <Input
                  ref={toolbarSearchInputRef}
                  className="toolbar-search-input"
                  placeholder="搜索"
                  allowClear
                  size="small"
                  prefix={<SearchOutlined />}
                  value={searchQuery}
                  onFocus={() => setSearchOpen(true)}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onPressEnter={submitToolbarSearch}
                  onBlur={() => {
                    if (!searchQuery.trim()) setToolbarSearchExpanded(false);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="toolbar-icon-btn"
                  title="搜索文档"
                  aria-label="搜索文档"
                  onClick={openToolbarSearch}
                >
                  <SearchOutlined />
                </button>
              )}
            </div>
            <button
              type="button"
              className="toolbar-help-btn"
              title="Markdown 帮助"
              aria-label="Markdown 帮助"
              onClick={() => setHelpOpen(true)}
            >
              <QuestionCircleOutlined />
              <span>帮助</span>
            </button>
            <button
              type="button"
              className="toolbar-icon-btn"
              title="偏好设置 (Ctrl+,)"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingOutlined />
            </button>
            <button
              type="button"
              className="toolbar-icon-btn"
              title={shellIsDark ? '切换到浅色主题' : '切换到深色主题'}
              onClick={() => {
                const nextTheme = shellIsDark ? 'default-light' : 'default-dark';
                setThemeId(nextTheme);
                setEditorThemeId(nextTheme);
                void patchStoredAppSettings({ themeId: nextTheme, editorThemeId: nextTheme }).catch(() => undefined);
              }}
            >
              {shellIsDark ? <SunOutlined /> : <MoonOutlined />}
            </button>
            <div className="window-controls" aria-label="窗口控制">
              <button
                type="button"
                className="window-control-btn"
                title="最小化"
                aria-label="最小化窗口"
                onClick={() => { void window.nextTyproa?.windowMinimize?.(); }}
              >
                <MinusOutlined />
              </button>
              <button
                type="button"
                className="window-control-btn"
                title="最大化/还原"
                aria-label="最大化或还原窗口"
                onClick={() => { void window.nextTyproa?.windowToggleMaximize?.(); }}
              >
                <BorderOutlined />
              </button>
              <button
                type="button"
                className="window-control-btn window-close-btn"
                title="关闭"
                aria-label="关闭窗口"
                onClick={() => { void window.nextTyproa?.windowClose?.(); }}
              >
                <CloseOutlined />
              </button>
            </div>
          </div>
        </header>

        {!backendOnline && (
          <Alert
            banner
            type="warning"
            className="backend-offline-banner"
            title="与后端服务的连接已断开，正在自动重连…未保存的修改仍保留在编辑器中，恢复连接后会自动保存。"
            action={(
              <div className="backend-offline-actions">
                <Button size="small" onClick={() => void checkBackend()}>立即重试</Button>
                {window.nextTyproa?.restartBackend && (
                  <Button size="small" type="primary" loading={backendRestarting} onClick={() => void handleRestartBackend()}>
                    重启后端服务
                  </Button>
                )}
              </div>
            )}
          />
        )}

        <AnimatePresence initial={false}>
          {findOpen && selectedPath && (
          <motion.div className="find-replace-panel" {...panelRevealMotion}>
            <Input
              size="small"
              value={findQuery}
              onChange={(event) => setFindQuery(event.target.value)}
              placeholder="查找"
              autoFocus
            />
            <Input
              size="small"
              value={replaceValue}
              onChange={(event) => setReplaceValue(event.target.value)}
              placeholder="替换为"
            />
            <span className="find-count">{findMatchCount} 处</span>
            <Button size="small" onClick={replaceFirst} disabled={!findQuery || findMatchCount === 0}>替换</Button>
            <Button size="small" onClick={replaceAll} disabled={!findQuery || findMatchCount === 0}>全部替换</Button>
            <Button size="small" type="text" onClick={() => setFindOpen(false)}>关闭</Button>
          </motion.div>
          )}
        </AnimatePresence>

        <div className="typora-workspace">
          <SidebarPanel
            open={sidebarOpen}
            tab={sidebarTab}
            onTabChange={setSidebarTab}
            workspacePath={workspacePath}
            filesContent={
              <FileTree
                nodes={tree}
                selectedTreeItem={selectedTreeItem}
                expandedFolders={currentExpandedFolders}
                onExpandedFoldersChange={handleExpandedFoldersChange}
                workspacePath={workspacePath}
                sortMode={fileTreeSortMode}
                directoriesFirst={fileTreeDirectoriesFirst}
                onSortModeChange={setFileTreeSortMode}
                onDirectoriesFirstChange={setFileTreeDirectoriesFirst}
                onRefresh={() => { void refreshWorkspaceTree(); }}
                onRevealInExplorer={(path) => { void handleRevealInExplorer(path); }}
                onCopyPath={handleCopyPath}
                onSelectFile={handleSelectFile}
                onSelectFolder={handleSelectFolder}
                onHighlightSelection={handleHighlightTreeSelection}
                onCreateFolder={(parentPath) => { void handleCreateFolder(parentPath); }}
                onCreateMarkdown={(parentPath) => { void handleCreateMarkdown(parentPath); }}
                onRename={handleRenameRequest}
                onDelete={handleDeleteRequest}
                onMove={(source, targetFolderPath) => { void handleMoveRequest(source, targetFolderPath); }}
                onMoveRequest={handleMoveToRequest}
              />
            }
            fileListContent={
              <FileList
                nodes={tree}
                selectedPath={selectedPath}
                selectedTreeItem={selectedTreeItem}
                currentFolderPath={selectedFolderPath}
                workspacePath={workspacePath}
                onSelectFile={handleSelectFile}
                onCreateMarkdown={(parentPath) => { void handleCreateMarkdown(parentPath); }}
                onRefresh={() => { void refreshWorkspaceTree(); }}
                onRevealInExplorer={(path) => { void handleRevealInExplorer(path); }}
                onCopyPath={handleCopyPath}
              />
            }
            searchContent={
              <SearchResultsPanel
                query={searchQuery}
                results={searchResults}
                total={searchTotal}
                offset={searchOffset}
                pageSize={searchPageSize}
                sort={searchSort}
                loading={searchLoading}
                indexStatus={indexStatus}
                onSortChange={(sort) => { void setSearchSort(sort); }}
                onPageChange={(offset) => { void setSearchOffset(offset); }}
                onSelect={(path) => { void handleSelectNote(path); }}
                onClear={clearSearchResults}
              />
            }
            outlineContent={
              <Outline
                content={content}
                activeHeadingKey={activeOutlineHeadingKey}
                onJump={(line, heading) => {
                  setActiveOutlineHeadingKey(heading.key);
                  scrollToHeadingLine(line, content, editorRootRef.current, heading);
                }}
              />
            }
          />

          <main className="typora-main">
            <EditorTabs
              tabs={openTabs}
              activePath={activeTabPath || selectedPath}
              currentContent={content}
              currentLoadedContent={loadedContent}
              onSelect={handleSelectTab}
              onClose={(path) => { void handleCloseTab(path); }}
              onCloseOthers={(path) => { void handleCloseOtherTabs(path); }}
              onCloseRight={(path) => { void handleCloseRightTabs(path); }}
              onCopyPath={(path) => { void copyText(path, '已复制标签路径'); }}
            />
            <AnimatePresence mode="wait" initial={false}>
            {selectedPath ? (
              <motion.div key="editor-open" className="typora-editor-state" {...fadeSoftMotion}>
              <div className="typora-editor-host" ref={editorRootRef}>
                <AnimatePresence mode="wait" initial={false}>
                {editorMode === 'source' ? (
                  <motion.div key="source" className="editor-mode-motion" {...editorCrossfadeMotion}>
                  <SourceEditor
                    noteKey={`${selectedPath}:${editorRevision}`}
                    value={content}
                    onChange={setContent}
                    notePath={selectedPath}
                    isDark={editorIsDark}
                    spellCheckEnabled={spellCheckEnabled}
                    typewriterMode={writingModes.typewriterMode}
                  />
                  </motion.div>
                ) : (
                  <motion.div key="wysiwyg" className="editor-mode-motion" {...editorCrossfadeMotion}>
                  <MarkdownEditor
                    noteKey={`${selectedPath}:${editorRevision}`}
                    notePath={selectedPath}
                    value={content}
                    onChange={setContent}
                    isDark={editorIsDark}
                    spellCheckEnabled={spellCheckEnabled}
                    typewriterMode={writingModes.typewriterMode}
                    onReady={(markdown) => {
                      setContent(markdown);
                      if (content === loadedContent) {
                        setLoadedContent(markdown);
                      }
                    }}
                  />
                  </motion.div>
                )}
                </AnimatePresence>
                <AnimatePresence initial={false}>
                {editorMode === 'wysiwyg' && (
                  <motion.aside className="editor-outline-rail" aria-label="文档大纲" {...rightRailRevealMotion}>
                    <div className="editor-outline-rail-header">
                      <span>大纲</span>
                      <button
                        type="button"
                        className="editor-outline-rail-close"
                        title="在侧栏打开大纲"
                        aria-label="在侧栏打开大纲"
                        onClick={() => {
                          setSidebarOpen(true);
                          setSidebarTab('outline');
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <Outline
                      content={content}
                      activeHeadingKey={activeOutlineHeadingKey}
                      onJump={(line, heading) => {
                        setActiveOutlineHeadingKey(heading.key);
                        scrollToHeadingLine(line, content, editorRootRef.current, heading);
                      }}
                    />
                  </motion.aside>
                )}
                </AnimatePresence>
              </div>
              </motion.div>
            ) : unsupportedPreviewPath ? (
              <motion.div key="unsupported" className="unsupported-preview" {...fadeSoftMotion}>
                <p className="unsupported-preview-title">暂不支持该文件浏览</p>
                <p className="unsupported-preview-path">{unsupportedPreviewPath}</p>
              </motion.div>
            ) : (
              <motion.div key="placeholder" className="writing-placeholder" {...fadeSoftMotion}>
                <p className="placeholder-title">打开本地 Markdown 文件</p>
                <p className="placeholder-hint">点击工具栏「打开文件」或「打开文件夹」，笔记会直接读写磁盘上的 .md 文件</p>
                <div className="placeholder-actions">
                  <Button type="primary" onClick={handleOpenFile}>打开文件</Button>
                  <Button onClick={handleOpenFolder}>打开文件夹</Button>
                </div>
              </motion.div>
            )}
            </AnimatePresence>
          </main>
        </div>

        <StatusBar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          documentTitle={displayPath ? documentTitle : ''}
          wordCount={wordCount}
        />

        <QuickOpenModal
          open={quickOpen}
          nodes={tree}
          selectedPath={selectedPath}
          workspacePath={workspacePath}
          onOpen={(path) => handleSelectNote(path)}
          onClose={() => setQuickOpen(false)}
        />

        <MarkdownHelpModal
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
        />

        <Modal
          title="检测到外部修改"
          open={Boolean(saveConflict)}
          closable={false}
          mask={{ closable: false }}
          footer={[
            <Button key="reload" onClick={() => { void handleReloadConflict(); }}>
              重新载入
            </Button>,
            <Button key="copy" onClick={() => { void handleSaveConflictCopy(); }}>
              保存副本
            </Button>,
            <Button key="force" type="primary" danger onClick={() => { void handleForceOverwrite(); }}>
              强制覆盖
            </Button>,
          ]}
          centered
        >
          <p>磁盘上的文件已被其他程序修改，自动保存已暂停。</p>
          <Text type="secondary">{saveConflict?.path || selectedPath}</Text>
        </Modal>

        <Modal
          title={createDialog?.kind === 'folder' ? '新建文件夹' : '新建 Markdown 文件'}
          open={Boolean(createDialog)}
          onOk={() => { void submitCreate(); }}
          onCancel={() => setCreateDialog(null)}
          okText="创建"
          cancelText="取消"
          destroyOnHidden
          centered
        >
          <Text type="secondary">
            {createDialog?.parentPath ? `创建位置：${createDialog.parentPath}` : '文件名示例：notes/hello.md'}
          </Text>
          <Input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onPressEnter={() => { void submitCreate(); }}
            style={{ marginTop: 12 }}
            autoFocus
          />
        </Modal>

        <Modal
          title="重命名"
          open={Boolean(renameTarget)}
          onOk={() => { void submitRename(); }}
          onCancel={() => setRenameTarget(null)}
          okText="重命名"
          cancelText="取消"
          destroyOnHidden
          centered
        >
          <Text type="secondary">请输入新的名称</Text>
          <Input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onPressEnter={() => { void submitRename(); }}
            style={{ marginTop: 12 }}
            autoFocus
          />
        </Modal>

        <Modal
          title="移动到"
          open={Boolean(moveDialog)}
          onOk={() => { void submitMoveTo(); }}
          onCancel={() => setMoveDialog(null)}
          okText="移动"
          okButtonProps={{ disabled: moveDestinationOptions.length === 0 }}
          cancelText="取消"
          destroyOnHidden
          centered
        >
          <Text type="secondary">
            将 <Text code>{moveDialog?.source.path}</Text> 移动到
          </Text>
          <select
            value={moveDialog?.targetFolderPath ?? ''}
            onChange={(event) => {
              setMoveDialog((prev) => prev ? { ...prev, targetFolderPath: event.target.value } : prev);
            }}
            disabled={moveDestinationOptions.length === 0}
            style={{
              width: '100%',
              height: 34,
              marginTop: 12,
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: 13,
              padding: '0 10px',
            }}
          >
            {moveDestinationOptions.map((option) => (
              <option key={option.path || '__root__'} value={option.path}>
                {option.label}
              </option>
            ))}
          </select>
        </Modal>

        <Modal
          title="文件已被移动或删除"
          open={Boolean(fileMissingDialog)}
          onOk={() => {
            if (fileMissingDialog) {
              // 打开另存为对话框
              const suggestedName = fileMissingDialog.path.split('/').pop() || 'untitled.md';
              setCreateName(suggestedName);
              setCreateDialog({ kind: 'markdown', parentPath: '' });
              setFileMissingDialog(null);
            }
          }}
          onCancel={() => {
            if (fileMissingDialog) {
              // 关闭该标签页
              void handleCloseTab(fileMissingDialog.path);
              setFileMissingDialog(null);
            }
          }}
          okText="另存为"
          cancelText="关闭标签页"
          centered
        >
          <Text>
            文件 <Text code>{fileMissingDialog?.path}</Text> 已被移动或删除，无法保存您的编辑内容。
          </Text>
          <br />
          <br />
          <Text type="secondary">
            您可以选择：
            <ul style={{ marginTop: 8, paddingLeft: 20 }}>
              <li>点击"另存为"将内容保存到新文件</li>
              <li>点击"关闭标签页"放弃未保存的内容</li>
            </ul>
          </Text>
        </Modal>

        <Modal
          title={deleteTarget?.isDirectory ? '删除文件夹' : '删除文件'}
          open={Boolean(deleteTarget)}
          onOk={() => { void submitDelete(); }}
          onCancel={() => setDeleteTarget(null)}
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          centered
        >
          确定删除 <Text code>{deleteTarget?.path}</Text> 吗？{deleteTarget?.isDirectory ? '文件夹中的所有内容都会被删除，' : ''}此操作不可撤销。
        </Modal>

        <SettingsModal
          open={settingsOpen}
          initial={{
            ...imageSettings,
            spellCheckEnabled,
            themeId,
            editorThemeId,
            customCss,
            shortcuts: shortcutOverrides,
            recentFiles,
            recentWorkspaces,
            openTabs,
            activeTabPath,
            writingModes,
          }}
          onClose={() => setSettingsOpen(false)}
          onSaved={(saved: PreferenceSettings) => {
            setImageSettings(saved);
            setSpellCheckEnabled(saved.spellCheckEnabled);
            setThemeId(saved.themeId);
            setEditorThemeId(saved.editorThemeId);
            setCustomCss(saved.customCss);
            setShortcutOverrides(saved.shortcuts);
            setRecentWorkspaces(saved.recentWorkspaces);
            persistWritingModes(saved.writingModes);
          }}
        />

        <Modal
          title="提示"
          open={alertOpen}
          onOk={() => setAlertOpen(false)}
          onCancel={() => setAlertOpen(false)}
          footer={[<Button key="ok" type="primary" onClick={() => setAlertOpen(false)}>确定</Button>]}
          centered
        >
          {alertMessage}
        </Modal>
      </div>
      </MotionConfig>
    </ConfigProvider>
  );
}
