import { describe, expect, it } from 'vitest';
import { preferenceSettingsFromAppSettings } from './appSettings';
import { upsertEditorTab, upsertRecentFile, upsertRecentWorkspace } from './recentFiles';
import { detectShortcutConflicts, findShortcutAction, normalizeShortcut, resolveShortcutBindings, shortcutFromKeyboardEvent } from './shortcuts';
import { scopeCustomEditorCss } from './themes';
import type { Note } from '../types';
import { snippetToPieces } from '../components/SearchResultsPanel';

describe('product optimization utilities', () => {
  it('fills new preference fields for legacy settings', () => {
    const settings = preferenceSettingsFromAppSettings({ imageUploadMode: 'picgo', picgoServerUrl: 'http://localhost:36677' });

    expect(settings.themeId).toBe('default-light');
    expect(settings.editorThemeId).toBe('default-light');
    expect(settings.shortcuts).toEqual({});
    expect(settings.recentFiles).toEqual([]);
    expect(settings.openTabs).toEqual([]);
    expect(settings.writingModes).toEqual({
      focusMode: false,
      typewriterMode: false,
      distractionFreeMode: false,
    });
  });

  it('scopes custom css to the editor host', () => {
    expect(scopeCustomEditorCss('.ProseMirror p { line-height: 1.8; }')).toBe(
      '.typora-editor-host .ProseMirror p { line-height: 1.8; }',
    );
  });

  it('detects shortcut conflicts after overrides are resolved', () => {
    const bindings = resolveShortcutBindings({
      'open-file': ['Ctrl+K'],
      'open-folder': ['Ctrl+K'],
    });

    expect(detectShortcutConflicts(bindings)).toEqual([
      { key: 'Ctrl+K', actionIds: ['open-file', 'open-folder', 'insert-link'] },
    ]);
  });

  it('normalizes shortcut strings and keyboard events consistently', () => {
    expect(normalizeShortcut('cmd + shift + l')).toBe('Meta+Shift+L');
    expect(normalizeShortcut('Option+Ctrl+p')).toBe('Ctrl+Alt+P');
    expect(shortcutFromKeyboardEvent(new KeyboardEvent('keydown', {
      key: '/',
      ctrlKey: true,
    }))).toBe('Ctrl+/');
  });

  it('reports app overrides that collide with editor-scoped formatting shortcuts', () => {
    const bindings = resolveShortcutBindings({
      'open-file': ['Ctrl+B'],
    });

    expect(detectShortcutConflicts(bindings)).toEqual([
      { key: 'Ctrl+B', actionIds: ['open-file', 'bold'] },
    ]);
  });

  it('uses the Typora-style sidebar shortcut instead of the bold shortcut', () => {
    const bindings = resolveShortcutBindings();
    const ctrlB = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true });
    const ctrlShiftL = new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, shiftKey: true });

    expect(findShortcutAction(bindings, ctrlB)).toBeUndefined();
    expect(findShortcutAction(bindings, ctrlShiftL)).toBe('toggle-sidebar');
  });

  it('matches the shortcut optimization plan defaults', () => {
    const bindings = resolveShortcutBindings();

    expect(findShortcutAction(bindings, new KeyboardEvent('keydown', { key: '/', ctrlKey: true }))).toBe('toggle-source');
    expect(findShortcutAction(bindings, new KeyboardEvent('keydown', { key: '`', ctrlKey: true }))).toBe('toggle-source');
    expect(findShortcutAction(bindings, new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }))).toBe('find-current-document');
    expect(findShortcutAction(bindings, new KeyboardEvent('keydown', { key: 'h', ctrlKey: true }))).toBe('replace-current-document');
    expect(findShortcutAction(bindings, new KeyboardEvent('keydown', { key: '1', ctrlKey: true, shiftKey: true }))).toBe('open-outline-sidebar');
    expect(findShortcutAction(bindings, new KeyboardEvent('keydown', { key: '3', ctrlKey: true, shiftKey: true }))).toBe('open-file-sidebar');
    expect(findShortcutAction(bindings, new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, altKey: true }))).toBe('export-pdf');
    expect(findShortcutAction(bindings, new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, shiftKey: true }))).toBeUndefined();
  });

  it('filters app shortcuts in source editor and form scopes', () => {
    const bindings = resolveShortcutBindings();
    const sourceShell = document.createElement('div');
    const sourceChild = document.createElement('div');
    const input = document.createElement('input');
    sourceShell.className = 'source-editor-shell';
    sourceShell.appendChild(sourceChild);
    document.body.append(sourceShell, input);

    expect(shortcutActionFromTarget(bindings, sourceChild, { key: 'f', ctrlKey: true })).toBeUndefined();
    expect(shortcutActionFromTarget(bindings, sourceChild, { key: '/', ctrlKey: true })).toBe('toggle-source');
    expect(shortcutActionFromTarget(bindings, input, { key: 'n', ctrlKey: true })).toBeUndefined();
    expect(shortcutActionFromTarget(bindings, input, { key: 's', ctrlKey: true })).toBe('save');

    sourceShell.remove();
    input.remove();
  });

  it('deduplicates recent files and workspaces', () => {
    const files = upsertRecentFile(
      [{ folder: 'D:/notes', relativePath: 'a.md', openedAt: 'old' }],
      { folder: 'D:/notes', relativePath: 'a.md', title: 'A', openedAt: 'new' },
    );
    const workspaces = upsertRecentWorkspace([{ path: 'D:/notes', openedAt: 'old' }], 'D:/notes');

    expect(files).toHaveLength(1);
    expect(files[0].openedAt).toBe('new');
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].path).toBe('D:/notes');
  });

  it('upserts editor tabs by path', () => {
    const note: Note = {
      path: 'docs/a.md',
      title: 'A',
      content: '# A',
      contentHash: 'hash-2',
    };
    const tabs = upsertEditorTab([
      {
        id: 'docs/a.md',
        path: 'docs/a.md',
        title: 'Old',
        content: 'old',
        loadedContent: 'old',
        contentHash: 'hash-1',
        saveStatus: 'idle',
      },
    ], {
      id: note.path,
      path: note.path,
      title: note.title,
      content: note.content,
      loadedContent: note.content,
      contentHash: note.contentHash,
      saveStatus: 'idle',
    });

    expect(tabs).toHaveLength(1);
    expect(tabs[0].contentHash).toBe('hash-2');
  });

  it('renders backend marked snippets without showing markup text', () => {
    expect(snippetToPieces('before &lt;tag&gt; <mark>rocket</mark> after', 'rocket')).toEqual([
      { value: 'before <tag> ', hit: false },
      { value: 'rocket', hit: true },
      { value: ' after', hit: false },
    ]);
  });
});

function shortcutActionFromTarget(
  bindings: ReturnType<typeof resolveShortcutBindings>,
  target: HTMLElement,
  init: KeyboardEventInit,
) {
  let action: string | undefined;
  const listener = (event: KeyboardEvent) => {
    action = findShortcutAction(bindings, event);
  };
  target.addEventListener('keydown', listener);
  target.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  }));
  target.removeEventListener('keydown', listener);
  return action;
}
