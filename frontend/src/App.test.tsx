import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, TreeNode } from './types';

// 用内存中的“磁盘”替代后端：App 通过 ./api 读写笔记，其余逻辑（自动保存、标签页、对话框、编辑器）都是真实的
const disk = vi.hoisted(() => new Map<string, string>());

function hashOf(content: string): string {
  return `hash:${content.length}:${content}`;
}

function noteOf(path: string, content: string): Note {
  return {
    path,
    title: path.split('/').pop() || path,
    content,
    contentHash: hashOf(content),
    updatedAt: '2026-09-25T00:00:00Z',
  };
}

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    initApiConfig: vi.fn(async () => ({ port: 0, token: '' })),
    healthCheck: vi.fn(async () => true),
    reconnectBackend: vi.fn(async () => true),
    getWorkspace: vi.fn(async () => ({ path: 'D:/vault' })),
    setWorkspace: vi.fn(async (path: string) => ({ path })),
    getTree: vi.fn(async () => treeOf()),
    refreshWorkspace: vi.fn(async () => treeOf()),
    getSearchIndexStatus: vi.fn(async () => ({ indexedFiles: 0, totalFiles: 0, lastIndexedAt: null })),
    searchNotes: vi.fn(async () => ({ results: [], total: 0, offset: 0, limit: 20 })),
    getNote: vi.fn(async (path: string) => {
      const content = disk.get(path);
      if (content === undefined) throw new actual.ApiError(`Note not found: ${path}`, 404, { error: 'Note not found' });
      return noteOf(path, content);
    }),
    saveNote: vi.fn(async (path: string, content: string, baseHash?: string, force = false) => {
      const current = disk.get(path);
      if (current === undefined) throw new actual.ApiError(`Note not found: ${path}`, 404, { error: 'Note not found' });
      if (!force && baseHash !== hashOf(current)) {
        throw new actual.ApiError('Note was modified outside NextTyproa', 409, {
          code: 'NOTE_CONFLICT',
          path,
          currentHash: hashOf(current),
          currentUpdatedAt: '2026-09-25T00:00:00Z',
        }, 'NOTE_CONFLICT');
      }
      disk.set(path, content);
      return noteOf(path, content);
    }),
    createNote: vi.fn(async (path: string, content = '') => {
      if (disk.has(path)) throw new actual.ApiError(`Note already exists: ${path}`, 409, { error: 'exists' });
      disk.set(path, content);
      return noteOf(path, content);
    }),
  };
});

function treeOf(): TreeNode[] {
  const root: TreeNode[] = [];
  for (const path of [...disk.keys()].sort()) {
    const parts = path.split('/');
    let level = root;
    parts.forEach((name, index) => {
      const nodePath = parts.slice(0, index + 1).join('/');
      const directory = index < parts.length - 1;
      let node = level.find((item) => item.path === nodePath);
      if (!node) {
        node = { name, path: nodePath, directory, children: [] };
        level.push(node);
      }
      level = node.children;
    });
  }
  return root;
}

const api = await import('./api');
const { default: App } = await import('./App');

beforeAll(() => {
  // jsdom 缺少以下浏览器 API：App 的侧栏/动效与 Crepe 的编辑器组件会用到
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
  // jsdom 的 Range 没有布局信息；Crepe 的虚拟光标在 selectionchange 时会读取它（如对话框输入框获得焦点）
  if (!Range.prototype.getClientRects) {
    const emptyRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
    Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => emptyRect as DOMRect;
  }
  if (!('IntersectionObserver' in window)) {
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
      },
    });
  }
});

beforeEach(() => {
  disk.clear();
  localStorage.clear();
  vi.mocked(api.saveNote).mockClear();
  vi.mocked(api.createNote).mockClear();
  vi.mocked(api.getNote).mockClear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** 以“重启后恢复标签页”的真实路径打开笔记：settings 里记录打开的标签页，App 启动时从磁盘读取激活的那一个 */
async function openApp(notes: Record<string, string>, tabs: string[], activeTabPath = tabs[0]) {
  Object.entries(notes).forEach(([path, content]) => disk.set(path, content));
  localStorage.setItem('nexttyproa-app-settings', JSON.stringify({
    openTabs: tabs.map((path) => ({ id: path, path, title: path.split('/').pop() })),
    activeTabPath,
  }));
  const view = render(<App />);
  await waitFor(() => expect(editorParagraphs().length).toBeGreaterThan(0), { timeout: 10000 });
  return view;
}

function editorParagraphs(): HTMLParagraphElement[] {
  return Array.from(document.querySelectorAll<HTMLParagraphElement>('.typora-editor .ProseMirror p'));
}

function editorText(): string {
  return document.querySelector('.typora-editor .ProseMirror')?.textContent ?? '';
}

/** 模拟用户在段落末尾输入：ProseMirror 通过 MutationObserver 读取 DOM 改动并派发事务 */
function typeAtEndOfParagraph(paragraphText: string, typed: string) {
  const paragraph = editorParagraphs().find((element) => element.textContent === paragraphText);
  const text = paragraph?.lastChild;
  expect(text?.nodeType).toBe(Node.TEXT_NODE);
  (text as Text).data += typed;
}

function editorTabs(): HTMLElement[] {
  return within(screen.getByRole('tablist', { name: '打开的文档' })).queryAllByRole('tab');
}

function tabTitles(): string[] {
  return editorTabs().map((tab) => tab.querySelector('.editor-tab-title')?.textContent ?? '');
}

function tabPaths(): string[] {
  return editorTabs().map((tab) => (tab.getAttribute('title') ?? '').replace(/（文件缺失或无法打开）$/, ''));
}

/** jsdom 不会结束 antd 的离场动画，关闭后的对话框会停在 *-leave 状态留在 DOM 里，所以按这个状态判断是否仍打开 */
function openDialog(title: string): HTMLElement | undefined {
  return screen.queryAllByRole('dialog').find((dialog) => (
    dialog.querySelector('.ant-modal-title')?.textContent === title && !/-leave\b/.test(dialog.className)
  ));
}

function isDialogOpen(title: string): boolean {
  return Boolean(openDialog(title));
}

function pressShortcut(key: string, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(window, { key, ctrlKey: true, ...init });
}

describe('App (integration with mocked backend)', () => {
  it('restores the active tab from settings and renders the note in the WYSIWYG editor', async () => {
    await openApp({ 'a.md': '# A\n\n第一段\n' }, ['a.md']);
    expect(editorText()).toContain('第一段');
    expect(tabTitles()).toEqual(['a.md']);
  }, 20000);

  // BUG_BACKLOG_REAL_WORLD.md RW-P1-004：“检测到外部修改”对话框打开时，关闭/切换标签会丢掉未保存的修改
  describe('while the "检测到外部修改" dialog is open', () => {
    const NOTE_B = '日记/笔记B.md';
    const EXTERNAL_VERSION = '# 笔记B\n\n正文\n外部追加2\n';

    async function openConflict() {
      await openApp({ [NOTE_B]: '# 笔记B\n\n正文\n', 'a.md': '# A\n\n另一篇\n' }, [NOTE_B, 'a.md']);
      // 外部程序在文件末尾追加一行，随后用户继续输入，自动保存时后端报 409 冲突
      disk.set(NOTE_B, EXTERNAL_VERSION);
      typeAtEndOfParagraph('正文', ' MYEDIT');
      await waitFor(() => expect(isDialogOpen('检测到外部修改')).toBe(true), { timeout: 5000 });
      expect(editorText()).toContain('正文 MYEDIT');
    }

    // 等待关闭/切换流程和标签页离场动画（spring）结束，DOM 才反映最终状态
    async function settle(ms = 1500) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    }

    function expectEditsKept() {
      expect(tabTitles()).toContain('笔记B.md');
      expect(isDialogOpen('检测到外部修改')).toBe(true);
      expect(editorText()).toContain('正文 MYEDIT');
      // 磁盘上仍是外部版本：没有被覆盖，也没有静默丢弃编辑器里的修改
      expect(disk.get(NOTE_B)).toBe(EXTERNAL_VERSION);
    }

    it('Ctrl+W does not close the tab or discard the unsaved edit', async () => {
      await openConflict();

      pressShortcut('w');
      await settle();

      expectEditsKept();
    }, 20000);

    it('Ctrl+Tab does not switch away from the conflicted note', async () => {
      await openConflict();

      pressShortcut('Tab');
      await settle();

      expectEditsKept();
      expect(editorText()).not.toContain('另一篇');
    }, 20000);

    it('a close request that bypasses shortcuts (tab close button) keeps the tab and its edits', async () => {
      await openConflict();

      fireEvent.click(screen.getByRole('button', { name: '关闭 笔记B.md' }));
      await settle();

      expectEditsKept();
    }, 20000);

    it('closes normally again once the conflict has been resolved with 强制覆盖', async () => {
      await openConflict();

      fireEvent.click(screen.getByRole('button', { name: '强制覆盖' }));
      await waitFor(() => expect(isDialogOpen('检测到外部修改')).toBe(false), { timeout: 5000 });
      expect(disk.get(NOTE_B)).toContain('正文 MYEDIT');

      pressShortcut('w');
      await waitFor(() => expect(tabTitles()).toEqual(['a.md']), { timeout: 5000 });
    }, 20000);
  });

  // BUG_BACKLOG_REAL_WORLD.md RW-P1-003：笔记在外部被删除/重命名后，后端返回 404，
  // 应提示“文件已被移动或删除”，并且“另存为”“关闭标签页”两个选项都要真正可用
  describe('when the open note was deleted or renamed outside the app', () => {
    const NOTE_A = '日记/笔记A.md';
    const EDITED = '原文 AFTER-EXTERNAL-DELETE';

    async function openMissing() {
      await openApp({ [NOTE_A]: '# 笔记A\n\n原文\n', 'a.md': '# A\n\n另一篇\n' }, [NOTE_A, 'a.md']);
      // 在资源管理器中删除文件，然后回到应用继续输入；自动保存时后端报 404
      disk.delete(NOTE_A);
      typeAtEndOfParagraph('原文', ' AFTER-EXTERNAL-DELETE');
      await waitFor(() => expect(isDialogOpen('文件已被移动或删除')).toBe(true), { timeout: 5000 });
      expect(editorText()).toContain(EDITED);
    }

    function savesOf(path: string): number {
      return vi.mocked(api.saveNote).mock.calls.filter(([savePath]) => savePath === path).length;
    }

    function alertText(): string {
      return openDialog('提示')?.textContent ?? '';
    }

    async function settle(ms = 1500) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    }

    it('"关闭标签页" discards the unsavable edit and closes the tab without retrying the save', async () => {
      await openMissing();
      const savesBefore = savesOf(NOTE_A);

      fireEvent.click(within(openDialog('文件已被移动或删除')!).getByRole('button', { name: '关闭标签页' }));
      await settle();

      expect(tabPaths()).toEqual(['a.md']);
      expect(editorText()).toContain('另一篇');
      expect(alertText()).not.toContain('保存失败');
      expect(savesOf(NOTE_A)).toBe(savesBefore);
      expect(disk.has(NOTE_A)).toBe(false);
    }, 20000);

    it('"另存为" writes the edited content to the new file and replaces the missing tab', async () => {
      await openMissing();

      fireEvent.click(within(openDialog('文件已被移动或删除')!).getByRole('button', { name: '另存为' }));
      await waitFor(() => expect(isDialogOpen('新建 Markdown 文件')).toBe(true), { timeout: 5000 });
      const createDialog = openDialog('新建 Markdown 文件')!;
      expect(within(createDialog).getByRole('textbox')).toHaveValue('笔记A.md');
      fireEvent.click(within(createDialog).getByRole('button', { name: /创\s*建/ }));

      await waitFor(() => expect(api.createNote).toHaveBeenCalledTimes(1), { timeout: 5000 });
      const [createdPath, createdContent] = vi.mocked(api.createNote).mock.calls[0];
      expect(createdPath).toBe('笔记A.md');
      expect(createdContent).toContain(EDITED);
      expect(disk.get('笔记A.md')).toContain(EDITED);

      await settle();
      expect(tabPaths()).toEqual(['a.md', '笔记A.md']);
      expect(editorText()).toContain(EDITED);
      expect(alertText()).not.toContain('保存失败');
      // 旧路径没有被自动保存悄悄重建
      expect(disk.has(NOTE_A)).toBe(false);
    }, 20000);

    it('Esc does not dismiss the dialog and silently throw the edit away', async () => {
      await openMissing();
      const savesBefore = savesOf(NOTE_A);

      fireEvent.keyDown(openDialog('文件已被移动或删除')!, { key: 'Escape', keyCode: 27 });
      await settle();

      expect(isDialogOpen('文件已被移动或删除')).toBe(true);
      expect(tabPaths()).toEqual([NOTE_A, 'a.md']);
      expect(editorText()).toContain(EDITED);
      expect(savesOf(NOTE_A)).toBe(savesBefore);
    }, 20000);
  });
});
