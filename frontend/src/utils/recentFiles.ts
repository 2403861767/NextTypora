import type { EditorTab, Note, RecentFileRef, RecentWorkspaceRef } from '../types';

const DEFAULT_LIMIT = 10;

export function upsertRecentFile(
  files: RecentFileRef[] = [],
  next: Omit<RecentFileRef, 'openedAt'> & { openedAt?: string },
  limit = DEFAULT_LIMIT,
): RecentFileRef[] {
  const openedAt = next.openedAt ?? new Date().toISOString();
  const filtered = files.filter((file) => file.folder !== next.folder || file.relativePath !== next.relativePath);
  return [{ ...next, openedAt }, ...filtered].slice(0, limit);
}

export function upsertRecentWorkspace(
  workspaces: RecentWorkspaceRef[] = [],
  path: string,
  limit = DEFAULT_LIMIT,
): RecentWorkspaceRef[] {
  if (!path.trim()) return workspaces.slice(0, limit);
  const filtered = workspaces.filter((workspace) => workspace.path !== path);
  return [{ path, openedAt: new Date().toISOString() }, ...filtered].slice(0, limit);
}

export function makeEditorTab(note: Note, previous?: Partial<EditorTab>): EditorTab {
  return {
    id: previous?.id || note.path,
    path: note.path,
    title: note.title || note.path.split(/[\\/]/).pop() || note.path,
    content: note.content,
    loadedContent: note.content,
    contentHash: note.contentHash,
    saveStatus: 'idle',
    updatedAt: note.updatedAt,
    ...previous,
    missing: false,
    conflict: previous?.conflict,
  };
}

export function upsertEditorTab(tabs: EditorTab[] = [], tab: EditorTab): EditorTab[] {
  const index = tabs.findIndex((item) => item.path === tab.path);
  if (index < 0) return [...tabs, tab];
  return tabs.map((item, itemIndex) => (itemIndex === index ? { ...item, ...tab } : item));
}

export function updateEditorTab(tabs: EditorTab[] = [], path: string, patch: Partial<EditorTab>): EditorTab[] {
  return tabs.map((tab) => (tab.path === path ? { ...tab, ...patch } : tab));
}

export function closeEditorTab(tabs: EditorTab[] = [], path: string): EditorTab[] {
  return tabs.filter((tab) => tab.path !== path);
}

export function isEditorTabDirty(tab: EditorTab): boolean {
  return tab.content !== tab.loadedContent;
}
