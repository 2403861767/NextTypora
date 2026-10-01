import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Note, TreeNode } from './types';

// 用内存中的“磁盘”替代后端：App 通过 ./api 读写笔记，其余逻辑（自动保存、标签页、对话框、编辑器）都是真实的
// disk 是主工作区 D:/vault 中的文件（相对路径）；其他目录中的文件放在 backend.external（绝对路径，/ 分隔）
const disk = vi.hoisted(() => new Map<string, string>());
// titlesFromContent：笔记标题像真实后端那样取自内容（见 titleOf）。默认关闭，沿用“文件名即标题”，现有用例不受影响
const backend = vi.hoisted(() => ({ workspace: 'D:/vault', external: new Map<string, string>(), titlesFromContent: false }));
const MAIN_VAULT = 'D:/vault';

function toSlashes(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** 和真实后端一样，笔记路径相对于当前工作区解析 */
function absolutePathOf(relativePath: string): string {
  return `${toSlashes(backend.workspace)}/${relativePath}`;
}

function readFile(absolutePath: string): string | undefined {
  return absolutePath.startsWith(`${MAIN_VAULT}/`)
    ? disk.get(absolutePath.slice(MAIN_VAULT.length + 1))
    : backend.external.get(absolutePath);
}

function writeFile(absolutePath: string, content: string) {
  if (absolutePath.startsWith(`${MAIN_VAULT}/`)) {
    disk.set(absolutePath.slice(MAIN_VAULT.length + 1), content);
  } else {
    backend.external.set(absolutePath, content);
  }
}

/** 当前工作区中所有文件的相对路径 */
function workspaceFiles(): string[] {
  const root = `${toSlashes(backend.workspace)}/`;
  return [...[...disk.keys()].map((path) => `${MAIN_VAULT}/${path}`), ...backend.external.keys()]
    .filter((path) => path.startsWith(root))
    .map((path) => path.slice(root.length));
}

/** 把当前工作区里的一个文件或整个文件夹从“磁盘”上拿走，返回被拿走的内容（相对路径 → 内容） */
function takeFromWorkspace(relativePath: string): Map<string, string> {
  const taken = new Map<string, string>();
  for (const path of workspaceFiles()) {
    if (path !== relativePath && !path.startsWith(`${relativePath}/`)) continue;
    const absolutePath = absolutePathOf(path);
    taken.set(path, readFile(absolutePath) ?? '');
    if (absolutePath.startsWith(`${MAIN_VAULT}/`)) disk.delete(path);
    else backend.external.delete(absolutePath);
  }
  return taken;
}

function hashOf(content: string): string {
  return `hash:${content.length}:${content}`;
}

/** 与后端 FileService.extractTitle 一致：首行 “# 标题” → 标题，首行是其他文字 → 该文字（最多 80 字），否则用文件名（不含扩展名） */
function titleOf(path: string, content: string): string {
  const fileName = path.split('/').pop() || path;
  if (!backend.titlesFromContent) return fileName;
  const firstLine = (content.split(/\r?\n/)[0] ?? '').trim();
  if (firstLine.startsWith('# ')) return firstLine.slice(2).trim();
  if (firstLine) return firstLine.slice(0, 80);
  return fileName.replace(/\.(md|markdown)$/i, '');
}

function noteOf(path: string, content: string): Note {
  return {
    path,
    title: titleOf(path, content),
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
    getWorkspace: vi.fn(async () => ({ path: backend.workspace })),
    setWorkspace: vi.fn(async (path: string) => {
      backend.workspace = path;
      return { path };
    }),
    getTree: vi.fn(async () => treeOf()),
    refreshWorkspace: vi.fn(async () => treeOf()),
    getSearchIndexStatus: vi.fn(async () => ({ indexedFiles: 0, totalFiles: 0, lastIndexedAt: null })),
    searchNotes: vi.fn(async () => ({ results: [], total: 0, offset: 0, limit: 20 })),
    getNote: vi.fn(async (path: string) => {
      const content = readFile(absolutePathOf(path));
      if (content === undefined) throw new actual.ApiError(`Note not found: ${path}`, 404, { error: 'Note not found' });
      return noteOf(path, content);
    }),
    saveNote: vi.fn(async (path: string, content: string, baseHash?: string, force = false) => {
      const current = readFile(absolutePathOf(path));
      if (current === undefined) throw new actual.ApiError(`Note not found: ${path}`, 404, { error: 'Note not found' });
      if (!force && baseHash !== hashOf(current)) {
        throw new actual.ApiError('Note was modified outside NextTyproa', 409, {
          code: 'NOTE_CONFLICT',
          path,
          currentHash: hashOf(current),
          currentUpdatedAt: '2026-09-25T00:00:00Z',
        }, 'NOTE_CONFLICT');
      }
      writeFile(absolutePathOf(path), content);
      return noteOf(path, content);
    }),
    createNote: vi.fn(async (path: string, content = '') => {
      if (readFile(absolutePathOf(path)) !== undefined) throw new actual.ApiError(`Note already exists: ${path}`, 409, { error: 'exists' });
      writeFile(absolutePathOf(path), content);
      return noteOf(path, content);
    }),
    createFolder: vi.fn(async (path: string) => ({ path, directory: true })),
    // 后端的 DELETE /api/files：永久删除文件，或递归删除整个文件夹
    deletePath: vi.fn(async (path: string) => {
      const removed = takeFromWorkspace(path);
      if (removed.size === 0) throw new actual.ApiError(`Path not found: ${path}`, 404, { error: 'Path not found' });
      return { path, directory: !removed.has(path) };
    }),
  };
});

function treeOf(): TreeNode[] {
  const root: TreeNode[] = [];
  for (const path of workspaceFiles().sort()) {
    const parts = path.split('/');
    // 和真实后端一样，文件树里不出现以 . 开头的条目（如 .nexttyproa-backups）
    if (parts.some((name) => name.startsWith('.'))) continue;
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
  // jsdom 没有 ClipboardEvent / DragEvent；Milkdown 的上传插件用 instanceof 区分粘贴和拖放
  if (!('ClipboardEvent' in window)) {
    vi.stubGlobal('ClipboardEvent', class ClipboardEvent extends Event {
      clipboardData: DataTransfer | null = null;
    });
  }
  if (!('DragEvent' in window)) {
    vi.stubGlobal('DragEvent', class DragEvent extends MouseEvent {
      dataTransfer: DataTransfer | null = null;
    });
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
  // 偏好设置里自动调整高度的 TextArea 依赖 ResizeObserver，jsdom 同样没有
  if (!('ResizeObserver' in window)) {
    vi.stubGlobal('ResizeObserver', class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  }
});

beforeEach(() => {
  disk.clear();
  backend.workspace = MAIN_VAULT;
  backend.external.clear();
  backend.titlesFromContent = false;
  localStorage.clear();
  vi.mocked(api.saveNote).mockClear();
  vi.mocked(api.createNote).mockClear();
  vi.mocked(api.getNote).mockClear();
  vi.mocked(api.setWorkspace).mockClear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete window.nextTyproa;
});

type ElectronBridge = NonNullable<Window['nextTyproa']>;

/** 只模拟测试用到的 Electron 接口（preload 暴露的 window.nextTyproa），其余保持缺省，App 会走浏览器分支 */
function stubElectron(bridge: Partial<ElectronBridge>) {
  window.nextTyproa = bridge as ElectronBridge;
}

function storedSettings(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem('nexttyproa-app-settings') ?? '{}') as Record<string, unknown>;
}

/** 以“重启后恢复标签页”的真实路径打开笔记：settings 里记录打开的标签页，App 启动时从磁盘读取激活的那一个 */
async function openApp(
  notes: Record<string, string>,
  tabs: string[],
  activeTabPath = tabs[0],
  extraSettings: Record<string, unknown> = {},
) {
  Object.entries(notes).forEach(([path, content]) => disk.set(path, content));
  localStorage.setItem('nexttyproa-app-settings', JSON.stringify({
    // 真实应用保存的是上次打开时后端给出的标题
    openTabs: tabs.map((path) => ({ id: path, path, title: titleOf(path, disk.get(path) ?? '') })),
    activeTabPath,
    ...extraSettings,
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

  // BUG_BACKLOG_REAL_WORLD.md RW-P1-001：编辑器每 200ms 才上报一次修改，输入后立刻切换/关闭/刷新会丢掉最后输入的内容
  describe('acting within ~200ms of typing', () => {
    const NOTE_A = 'a.md';
    const NOTE_B = 'b.md';

    async function openAndTypeQuickly(typed: string) {
      await openApp({ [NOTE_A]: '# A\n\n第一段\n', [NOTE_B]: '# B\n\n另一篇\n' }, [NOTE_A, NOTE_B]);
      typeAtEndOfParagraph('第一段', typed);
      // 让 ProseMirror 读到这次 DOM 改动（MutationObserver），但仍在编辑器 200ms 的上报防抖之内
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    function savedContentsOf(path: string): string[] {
      return vi.mocked(api.saveNote).mock.calls.filter(([savePath]) => savePath === path).map(([, content]) => content);
    }

    it('switching tabs saves the last keystrokes of the previous note', async () => {
      await openAndTypeQuickly(' QUICK1');

      fireEvent.click(editorTabs().find((tab) => tab.getAttribute('title') === NOTE_B)!);

      await waitFor(() => expect(disk.get(NOTE_A)).toBe('# A\n\n第一段 QUICK1\n'), { timeout: 3000 });
      await waitFor(() => expect(editorText()).toContain('另一篇'), { timeout: 3000 });
      // 最后的输入只能写进它所属的笔记
      expect(savedContentsOf(NOTE_B)).toEqual([]);
      expect(disk.get(NOTE_B)).toBe('# B\n\n另一篇\n');
    }, 20000);

    it('Ctrl+W saves the last keystrokes before closing the tab', async () => {
      await openAndTypeQuickly(' CTRLW1');

      pressShortcut('w');

      await waitFor(() => expect(disk.get(NOTE_A)).toBe('# A\n\n第一段 CTRLW1\n'), { timeout: 3000 });
      await waitFor(() => expect(tabPaths()).toEqual([NOTE_B]), { timeout: 5000 });
      expect(savedContentsOf(NOTE_B)).toEqual([]);
    }, 20000);

    it('closing or reloading the window (beforeunload) asks to stay and saves the last keystrokes', async () => {
      await openAndTypeQuickly(' RELOAD2');

      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      await waitFor(() => expect(disk.get(NOTE_A)).toBe('# A\n\n第一段 RELOAD2\n'), { timeout: 3000 });
    }, 20000);
  });

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

    // BUG_BACKLOG_REAL_WORLD.md RW-P2-001：“保存副本”后编辑写进副本，但标签栏仍只显示原笔记，
    // 原标签一直带着未保存标记（关闭它时还会拿旧 hash 保存而失败）；点击后也没有任何 loading 提示
    describe('保存副本', () => {
      const COPY_PATTERN = /^日记\/笔记B\.conflict-\d{8}-\d{6}\.md$/;

      function copyPathsOnDisk(): string[] {
        return [...disk.keys()].filter((path) => COPY_PATTERN.test(path));
      }

      function tabOf(path: string): HTMLElement | undefined {
        return editorTabs().find((tab) => tab.getAttribute('title') === path);
      }

      async function saveCopy(): Promise<string> {
        fireEvent.click(screen.getByRole('button', { name: '保存副本' }));
        await waitFor(() => expect(isDialogOpen('检测到外部修改')).toBe(false), { timeout: 5000 });
        expect(copyPathsOnDisk()).toHaveLength(1);
        return copyPathsOnDisk()[0];
      }

      it('opens the copy in its own active tab, keeps typing there and leaves the original untouched', async () => {
        await openConflict();

        const copyPath = await saveCopy();

        expect(disk.get(copyPath)).toBe('# 笔记B\n\n正文 MYEDIT\n');
        await waitFor(() => expect(tabPaths()).toContain(copyPath), { timeout: 3000 });
        expect(tabOf(copyPath)).toHaveAttribute('aria-selected', 'true');
        expect(tabOf(NOTE_B)).toHaveAttribute('aria-selected', 'false');
        // 未保存的修改已经写进副本：原标签不能再显示为未保存
        expect(tabOf(NOTE_B)).not.toHaveClass('dirty');

        // 等编辑器按副本重新载入后继续输入：只能写进副本，原文件保持外部版本
        await new Promise((resolve) => setTimeout(resolve, 500));
        typeAtEndOfParagraph('正文 MYEDIT', ' COPYEDIT');
        await waitFor(() => expect(disk.get(copyPath)).toBe('# 笔记B\n\n正文 MYEDIT COPYEDIT\n'), { timeout: 5000 });
        expect(disk.get(NOTE_B)).toBe(EXTERNAL_VERSION);
        expect(tabOf(copyPath)).toHaveAttribute('aria-selected', 'true');
      }, 20000);

      it('lets the original tab be closed afterwards without a save error or touching the external version', async () => {
        await openConflict();
        const copyPath = await saveCopy();
        vi.mocked(api.saveNote).mockClear();

        fireEvent.click(screen.getByRole('button', { name: '关闭 笔记B.md' }));
        await settle();

        expect(isDialogOpen('提示')).toBe(false);
        expect(tabPaths()).not.toContain(NOTE_B);
        expect(tabPaths()).toContain(copyPath);
        expect(vi.mocked(api.saveNote).mock.calls.filter(([path]) => path === NOTE_B)).toEqual([]);
        expect(disk.get(NOTE_B)).toBe(EXTERNAL_VERSION);
      }, 20000);

      it('shows a loading state while the copy is being written and ignores repeated clicks', async () => {
        await openConflict();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const createNote = vi.mocked(api.createNote).getMockImplementation()!;
        vi.mocked(api.createNote).mockImplementationOnce(async (...args) => {
          await gate;
          return createNote(...args);
        });

        const button = screen.getByRole('button', { name: '保存副本' });
        fireEvent.click(button);
        await waitFor(() => expect(button).toHaveClass('ant-btn-loading'));
        fireEvent.click(button);

        release();
        await waitFor(() => expect(isDialogOpen('检测到外部修改')).toBe(false), { timeout: 5000 });
        expect(api.createNote).toHaveBeenCalledTimes(1);
        expect(copyPathsOnDisk()).toHaveLength(1);
      }, 20000);
    });
  });

  // BUG_BACKLOG_REAL_WORLD.md RW-P2-003：偏好设置里未保存的修改，会在 8 秒一次的工作区轮询（App 重新渲染）后被重置
  it('keeps unsaved edits in 偏好设置 across the 8-second workspace poll', async () => {
    await openApp({ 'a.md': '# A\n\n第一段\n' }, ['a.md']);

    fireEvent.click(screen.getByTitle('偏好设置 (Ctrl+,)'));
    const dialog = await screen.findByRole('dialog', { name: '偏好设置' });
    const customCss = within(dialog).getByPlaceholderText('.ProseMirror p { line-height: 1.8; }');
    fireEvent.change(customCss, { target: { value: '.ProseMirror p { color: red; }' } });
    const spellCheck = within(dialog).getByRole('switch');
    fireEvent.click(spellCheck);
    expect(spellCheck).toHaveAttribute('aria-checked', 'true');

    // 等轮询真正跑过一次（刷新文件树会让 App 重新渲染），再留一点时间给随后的渲染
    vi.mocked(api.refreshWorkspace).mockClear();
    await waitFor(() => expect(api.refreshWorkspace).toHaveBeenCalled(), { timeout: 10000 });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(customCss).toHaveValue('.ProseMirror p { color: red; }');
    expect(spellCheck).toHaveAttribute('aria-checked', 'true');
  }, 25000);

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

  // BUG_BACKLOG_REAL_WORLD.md RW-P1-005：标签页只记录相对路径，切换工作区后旧标签会打开新工作区里同名的另一个文件
  describe('RW-P1-005: switching to another workspace', () => {
    const SECOND_VAULT = 'E:\\vault2';
    const SECOND_NOTE = '第二库笔记.md';
    const SECOND_VAULT_SAME_NAME = '# SECOND VAULT ascii-notes\n\n第二库同名文件\n';

    async function openFirstVault() {
      backend.external.set('E:/vault2/ascii-notes.md', SECOND_VAULT_SAME_NAME);
      backend.external.set(`E:/vault2/${SECOND_NOTE}`, '# 第二库笔记\n\n第二库正文\n');
      await openApp(
        { 'ascii-notes.md': '# ascii-notes\n\n第一库正文\n', 'only-v1.md': '# only\n\n只在第一库\n' },
        ['ascii-notes.md', 'only-v1.md'],
      );
    }

    /** 没有标签时标签栏整个不渲染 */
    function currentTabPaths(): string[] {
      return screen.queryByRole('tablist', { name: '打开的文档' }) ? tabPaths() : [];
    }

    async function settle(ms = 1500) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    }

    it('opening a note of another workspace (double-click / second instance) closes the old tabs instead of pointing them at same-named files', async () => {
      let openFilePath: (filePath: string) => void = () => undefined;
      stubElectron({
        onOpenFilePath: (callback) => {
          openFilePath = callback;
          return () => undefined;
        },
      });
      await openFirstVault();
      typeAtEndOfParagraph('第一库正文', ' 未保存');
      await new Promise((resolve) => setTimeout(resolve, 20));

      await act(async () => openFilePath(`${SECOND_VAULT}\\${SECOND_NOTE}`));
      await waitFor(() => expect(editorText()).toContain('第二库正文'), { timeout: 5000 });
      await settle();

      expect(api.setWorkspace).toHaveBeenCalledWith(SECOND_VAULT);
      // 旧工作区的标签不能留下：留下的 ascii-notes.md 会打开第二个库里的同名文件
      expect(currentTabPaths()).toEqual([SECOND_NOTE]);
      // 重启后也不能再恢复出旧工作区的标签
      expect((storedSettings().openTabs as { path: string }[]).map((tab) => tab.path)).toEqual([SECOND_NOTE]);
      expect(storedSettings().openTabsWorkspace).toBe(SECOND_VAULT);
      // 切换前的输入写回它所属的第一个库，第二个库里的同名文件不受影响
      expect(disk.get('ascii-notes.md')).toBe('# ascii-notes\n\n第一库正文 未保存\n');
      expect(backend.external.get('E:/vault2/ascii-notes.md')).toBe(SECOND_VAULT_SAME_NAME);
    }, 20000);

    it('打开文件夹 into another workspace closes the old workspace\'s tabs', async () => {
      stubElectron({ selectWorkspaceFolder: vi.fn(async () => SECOND_VAULT) });
      await openFirstVault();

      fireEvent.click(screen.getByTitle('打开文件夹 (Ctrl+Shift+O)'));
      await waitFor(() => expect(api.setWorkspace).toHaveBeenCalledWith(SECOND_VAULT), { timeout: 5000 });
      await settle();

      expect(currentTabPaths()).toEqual([]);
      expect(editorText()).not.toContain('SECOND VAULT');
      expect(storedSettings().openTabs).toEqual([]);
      expect(storedSettings().openTabsWorkspace).toBe(SECOND_VAULT);
    }, 20000);

    it('re-opening the current folder keeps its tabs', async () => {
      stubElectron({ selectWorkspaceFolder: vi.fn(async () => MAIN_VAULT) });
      await openFirstVault();

      fireEvent.click(screen.getByTitle('打开文件夹 (Ctrl+Shift+O)'));
      await waitFor(() => expect(api.setWorkspace).toHaveBeenCalledWith(MAIN_VAULT), { timeout: 5000 });
      await settle();

      expect(currentTabPaths()).toEqual(['ascii-notes.md', 'only-v1.md']);
    }, 20000);

    it('does not restore tabs of another workspace after a reload when the backend workspace changed meanwhile', async () => {
      await openFirstVault();
      await settle(300);
      cleanup();

      // 例如后端被切换到了另一个库，或者 localStorage 里残留着别的库的标签
      backend.workspace = 'E:/vault2';
      render(<App />);
      await waitFor(() => expect(screen.getAllByText(SECOND_NOTE).length).toBeGreaterThan(0), { timeout: 10000 });
      await settle(1000);

      expect(currentTabPaths()).toEqual([]);
      expect(editorText()).not.toContain('SECOND VAULT');
    }, 30000);
  });

  // BUG_BACKLOG_REAL_WORLD.md RW-P1-006：打开当前工作区内（子目录里）的文件，会把工作区重置为该文件所在的子目录
  describe('RW-P1-006: opening a file that is already inside the current workspace', () => {
    const DIARY = '日记/2026-09-23.md';

    async function openVault() {
      await openApp(
        { 'ascii-notes.md': '# ascii-notes\n\n根目录笔记\n', [DIARY]: '# 2026-09-23\n\n今天的日记\n' },
        ['ascii-notes.md'],
      );
    }

    async function settle(ms = 1500) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    }

    async function expectOpenedInCurrentWorkspace() {
      await waitFor(() => expect(editorText()).toContain('今天的日记'), { timeout: 5000 });
      await settle();

      // 工作区不变：不能切换到 日记 子目录
      expect(api.setWorkspace).not.toHaveBeenCalled();
      expect(tabPaths()).toEqual(['ascii-notes.md', DIARY]);
      // 文件树仍是整个工作区
      expect(screen.getAllByText('ascii-notes.md').length).toBeGreaterThan(0);

      // 原有标签仍指向工作区根目录下的文件，而不是不存在的 日记/ascii-notes.md
      fireEvent.click(editorTabs().find((tab) => tab.getAttribute('title') === 'ascii-notes.md')!);
      await waitFor(() => expect(editorText()).toContain('根目录笔记'), { timeout: 5000 });
      expect(isDialogOpen('提示')).toBe(false);
    }

    it('double-click / second instance with the absolute path opens it in the current workspace', async () => {
      let openFilePath: (filePath: string) => void = () => undefined;
      stubElectron({
        onOpenFilePath: (callback) => {
          openFilePath = callback;
          return () => undefined;
        },
      });
      await openVault();

      await act(async () => openFilePath('D:\\vault\\日记\\2026-09-23.md'));

      await expectOpenedInCurrentWorkspace();
    }, 20000);

    it('"打开文件" dialog opens it in the current workspace', async () => {
      let menuOpenFile: () => void = () => undefined;
      stubElectron({
        onMenuOpenFile: (callback) => {
          menuOpenFile = callback;
          return () => undefined;
        },
        selectMarkdownFile: vi.fn(async () => ({
          fullPath: 'D:\\vault\\日记\\2026-09-23.md',
          dir: 'D:\\vault\\日记',
          relativePath: '2026-09-23.md',
        })),
      });
      await openVault();

      await act(async () => menuOpenFile());

      await expectOpenedInCurrentWorkspace();
    }, 20000);
  });

  // BUG_BACKLOG_REAL_WORLD.md RW-P1-008：粘贴的图片上传失败时（如超过后端大小上限），
  // 编辑器里的 "Upload in progress..." 占位一直不消失，也没有任何提示
  describe('RW-P1-008: pasting a screenshot into the WYSIWYG editor', () => {
    const NOTE = '会议纪要.md';
    const NOTE_CONTENT = '# 会议纪要\n\n参会人：张三、李四\n';
    const PLACEHOLDER = 'Upload in progress...';
    let fetchSpy: MockInstance<typeof fetch> | undefined;

    afterEach(() => {
      fetchSpy?.mockRestore();
      fetchSpy = undefined;
    });

    /** 上传请求（POST /api/asset）挂起，直到测试给出后端的响应 */
    function holdUploadRequest(): (response: Response) => void {
      let respond: (response: Response) => void = () => undefined;
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>((resolve) => {
        respond = resolve;
      }));
      return (response) => respond(response);
    }

    function jsonResponse(status: number, body: unknown): Response {
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }

    /** 与在编辑器里按 Ctrl+V 粘贴一张截图相同：剪贴板里只有图片文件，没有文本 */
    function pasteImage(file: File) {
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          files: Object.assign([file], { item: (index: number) => (index === 0 ? file : null) }),
          types: ['Files'],
          getData: () => '',
        },
      });
      document.querySelector('.typora-editor .ProseMirror')!.dispatchEvent(event);
    }

    function screenshot(): File {
      // 全屏 PNG 截图通常有 1–3 MB
      return new File([new Uint8Array(1536 * 1024)], 'big-screenshot.png', { type: 'image/png' });
    }

    async function settle(ms = 1500) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    }

    async function pasteAndWaitForUpload() {
      const respond = holdUploadRequest();
      await openApp({ [NOTE]: NOTE_CONTENT }, [NOTE]);
      pasteImage(screenshot());
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1), { timeout: 5000 });
      expect(String(fetchSpy!.mock.calls[0][0])).toContain('/api/asset');
      // 上传进行中显示占位：说明走的是编辑器真正的粘贴上传流程
      await waitFor(() => expect(editorText()).toContain(PLACEHOLDER), { timeout: 5000 });
      return respond;
    }

    it('a failed upload removes the "Upload in progress..." placeholder and tells the user why', async () => {
      const respond = await pasteAndWaitForUpload();

      respond(jsonResponse(413, { error: 'The field file exceeds its maximum permitted size of 104857600 bytes.' }));

      await waitFor(() => expect(editorText()).not.toContain(PLACEHOLDER), { timeout: 3000 });
      await waitFor(() => expect(isDialogOpen('提示')).toBe(true), { timeout: 3000 });
      expect(openDialog('提示')!.textContent).toContain('图片上传失败');
      expect(openDialog('提示')!.textContent).toContain('exceeds its maximum permitted size');

      // 失败的粘贴不改动正文：既没有插入空图片，也不会因此触发保存
      await settle();
      expect(editorText()).not.toContain(PLACEHOLDER);
      expect(api.saveNote).not.toHaveBeenCalled();
      expect(disk.get(NOTE)).toBe(NOTE_CONTENT);
    }, 20000);

    it('a successful upload still replaces the placeholder with the image reference', async () => {
      const respond = await pasteAndWaitForUpload();

      respond(jsonResponse(200, { path: '会议纪要.assets/1-1.png', markdownRef: '会议纪要.assets/1-1.png' }));

      await waitFor(() => expect(editorText()).not.toContain(PLACEHOLDER), { timeout: 3000 });
      await waitFor(() => expect(disk.get(NOTE)).toContain('会议纪要.assets/1-1.png'), { timeout: 5000 });
      expect(isDialogOpen('提示')).toBe(false);
    }, 20000);
  });

  // BUG_BACKLOG_REAL_WORLD.md RW-P2-008：删除是永久删除（确认框写着“此操作不可撤销”），没有回收站；
  // 删除文件夹时，里面的 .nexttyproa-backups 备份也一起被永久删掉
  describe('RW-P2-008: deleting notes and folders', () => {
    const NOTE = '日记/图片笔记.md';
    const FOLDER = '项目2026';
    const BACKUP = `${FOLDER}/.nexttyproa-backups/需求 v1.2.md.2026-09-25T000000-000Z.bak`;
    const VAULT: Record<string, string> = {
      [NOTE]: '# 图片笔记\n\n正文\n',
      [`${FOLDER}/需求 v1.2.md`]: '# 需求\n\n内容\n',
      [`${FOLDER}/子目录/深层笔记.md`]: '# 深层\n\n内容\n',
      [BACKUP]: '# 需求\n\n旧版本\n',
      'a.md': '# A\n\n另一篇\n',
    };
    /** 系统回收站的替身：Electron 的 shell.trashItem 把文件从磁盘移到这里，之后还能找回 */
    const recycleBin = new Map<string, string>();

    beforeEach(() => {
      recycleBin.clear();
      vi.mocked(api.deletePath).mockClear();
    });

    function stubRecycleBin(failure?: Error) {
      const trashItem = vi.fn(async (relativePath: string) => {
        if (failure) throw failure;
        takeFromWorkspace(relativePath).forEach((content, path) => recycleBin.set(path, content));
      });
      stubElectron({ trashItem });
      return trashItem;
    }

    async function settle(ms = 1500) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    }

    /** 工具栏的“删除笔记”：删除当前打开的笔记 */
    async function requestDeleteOfOpenNote(): Promise<HTMLElement> {
      fireEvent.click(screen.getByTitle('删除笔记'));
      await waitFor(() => expect(isDialogOpen('删除文件')).toBe(true), { timeout: 5000 });
      return openDialog('删除文件')!;
    }

    /** 文件树右键菜单的“删除” */
    async function requestDeleteOfFolder(): Promise<HTMLElement> {
      fireEvent.contextMenu(screen.getByText(FOLDER).closest('button')!);
      fireEvent.click(await screen.findByText('删除'));
      await waitFor(() => expect(isDialogOpen('删除文件夹')).toBe(true), { timeout: 5000 });
      return openDialog('删除文件夹')!;
    }

    /** 点击对话框页脚的确认按钮（不依赖按钮上的文字） */
    function confirm(dialog: HTMLElement) {
      const buttons = dialog.querySelectorAll<HTMLButtonElement>('.ant-modal-footer button');
      fireEvent.click(buttons[buttons.length - 1]);
    }

    it('in the desktop app the confirmation offers the recycle bin instead of an irreversible delete', async () => {
      stubRecycleBin();
      await openApp(VAULT, [NOTE, 'a.md']);

      const dialog = await requestDeleteOfOpenNote();

      expect(dialog.textContent).toContain(NOTE);
      expect(dialog.textContent).toContain('回收站');
      expect(dialog.textContent).not.toContain('不可撤销');
    }, 20000);

    it('deleting the open note moves it to the recycle bin instead of deleting it permanently', async () => {
      const trashItem = stubRecycleBin();
      await openApp(VAULT, [NOTE, 'a.md']);
      const refreshesBefore = vi.mocked(api.refreshWorkspace).mock.calls.length;

      confirm(await requestDeleteOfOpenNote());

      await waitFor(() => expect(disk.has(NOTE)).toBe(false), { timeout: 5000 });
      expect(trashItem.mock.calls).toEqual([[NOTE]]);
      expect(recycleBin.get(NOTE)).toBe(VAULT[NOTE]);
      expect(api.deletePath).not.toHaveBeenCalled();
      // 让后端重新同步文件树和搜索索引（被移走的笔记不再出现在搜索结果里）
      await waitFor(() => expect(vi.mocked(api.refreshWorkspace).mock.calls.length).toBeGreaterThan(refreshesBefore), { timeout: 2000 });
      await settle();
      expect(tabPaths()).toEqual(['a.md']);
      expect(within(screen.getByLabelText('文件树根目录')).queryByText('图片笔记.md')).toBeNull();
    }, 20000);

    it('deleting a folder moves the whole folder to the recycle bin, backups included', async () => {
      const trashItem = stubRecycleBin();
      await openApp(VAULT, ['a.md']);

      confirm(await requestDeleteOfFolder());

      await waitFor(() => expect(workspaceFiles().some((path) => path.startsWith(`${FOLDER}/`))).toBe(false), { timeout: 5000 });
      expect(trashItem.mock.calls).toEqual([[FOLDER]]);
      expect(api.deletePath).not.toHaveBeenCalled();
      expect([...recycleBin.keys()].sort()).toEqual([BACKUP, `${FOLDER}/子目录/深层笔记.md`, `${FOLDER}/需求 v1.2.md`].sort());
      expect(recycleBin.get(BACKUP)).toBe(VAULT[BACKUP]);
      await settle(300);
      // 只看文件树：已关闭的确认框（停在离场动画）里还留着文件夹名
      expect(within(screen.getByLabelText('文件树根目录')).queryByText(FOLDER)).toBeNull();
    }, 20000);

    it('when the recycle bin is unavailable, nothing is deleted until the user confirms a permanent delete', async () => {
      const trashItem = stubRecycleBin(new Error('Failed to move item to trash'));
      await openApp(VAULT, [NOTE, 'a.md']);

      confirm(await requestDeleteOfOpenNote());

      await waitFor(() => expect(trashItem).toHaveBeenCalledTimes(1), { timeout: 5000 });
      await waitFor(() => expect(openDialog('删除文件')?.textContent ?? '').toContain('永久删除'), { timeout: 5000 });
      const dialog = openDialog('删除文件')!;
      expect(dialog.textContent).toContain('Failed to move item to trash');
      expect(dialog.textContent).toContain('不可撤销');
      expect(disk.get(NOTE)).toBe(VAULT[NOTE]);
      expect(api.deletePath).not.toHaveBeenCalled();

      confirm(dialog);

      await waitFor(() => expect(api.deletePath).toHaveBeenCalledWith(NOTE), { timeout: 5000 });
      await waitFor(() => expect(disk.has(NOTE)).toBe(false), { timeout: 5000 });
      expect(trashItem).toHaveBeenCalledTimes(1);
      expect(recycleBin.size).toBe(0);
    }, 20000);

    it('cancelling after a recycle bin failure keeps the note, and the next delete tries the recycle bin again', async () => {
      const trashItem = stubRecycleBin(new Error('Failed to move item to trash'));
      await openApp(VAULT, [NOTE, 'a.md']);
      confirm(await requestDeleteOfOpenNote());
      await waitFor(() => expect(openDialog('删除文件')?.textContent ?? '').toContain('永久删除'), { timeout: 5000 });

      fireEvent.click(within(openDialog('删除文件')!).getByRole('button', { name: /取\s*消/ }));
      await settle(500);

      expect(disk.get(NOTE)).toBe(VAULT[NOTE]);
      expect(api.deletePath).not.toHaveBeenCalled();
      const dialog = await requestDeleteOfOpenNote();
      expect(dialog.textContent).toContain('回收站');
      expect(dialog.textContent).not.toContain('永久删除');
      confirm(dialog);
      await waitFor(() => expect(trashItem).toHaveBeenCalledTimes(2), { timeout: 5000 });
    }, 20000);

    it('in the browser (no Electron) delete stays permanent and says so', async () => {
      await openApp(VAULT, [NOTE, 'a.md']);

      const dialog = await requestDeleteOfOpenNote();
      expect(dialog.textContent).toContain('不可撤销');
      expect(dialog.textContent).not.toContain('回收站');
      confirm(dialog);

      await waitFor(() => expect(api.deletePath).toHaveBeenCalledWith(NOTE), { timeout: 5000 });
      await waitFor(() => expect(disk.has(NOTE)).toBe(false), { timeout: 5000 });
      await settle();
      expect(tabPaths()).toEqual(['a.md']);
    }, 20000);
  });

  // BUG_BACKLOG_REAL_WORLD.md RW-P2-009：界面上无法在工作区根目录新建文件夹：
  // 侧栏顶部的“…”（侧边栏选项）按钮点了没反应，文件树空白处右键也没有菜单
  describe('RW-P2-009: creating at the workspace root', () => {
    const NESTED_NOTE = '日记/2026-09-23.md';

    beforeEach(() => {
      vi.mocked(api.createFolder).mockClear();
    });

    /** 打开子目录里的一篇笔记：此时文件树的选中项在“日记”里，工具栏的新建会建在“日记”下面 */
    async function openNestedNote() {
      await openApp({ [NESTED_NOTE]: '# 日记\n\n今天\n', 'a.md': '# A\n\n另一篇\n' }, [NESTED_NOTE]);
    }

    async function submitCreateDialog(title: string, name: string) {
      await waitFor(() => expect(isDialogOpen(title)).toBe(true), { timeout: 5000 });
      const dialog = openDialog(title)!;
      fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: name } });
      fireEvent.click(within(dialog).getByRole('button', { name: /创\s*建/ }));
    }

    it('"…" (侧边栏选项) → 新建文件夹 creates the folder at the workspace root', async () => {
      await openNestedNote();

      fireEvent.click(screen.getByRole('button', { name: '侧边栏选项' }));
      fireEvent.click(await screen.findByText('新建文件夹'));
      await submitCreateDialog('新建文件夹', '新目录');

      await waitFor(() => expect(api.createFolder).toHaveBeenCalledTimes(1), { timeout: 5000 });
      expect(api.createFolder).toHaveBeenCalledWith('新目录');
    }, 20000);

    it('"…" (侧边栏选项) → 新建笔记 creates the note at the workspace root', async () => {
      await openNestedNote();

      fireEvent.click(screen.getByRole('button', { name: '侧边栏选项' }));
      fireEvent.click(await screen.findByText('新建笔记'));
      await submitCreateDialog('新建 Markdown 文件', '根目录笔记');

      await waitFor(() => expect(disk.has('根目录笔记.md')).toBe(true), { timeout: 5000 });
      expect(disk.has('日记/根目录笔记.md')).toBe(false);
    }, 20000);

    it('right-clicking blank space in the file tree panel → 新建文件夹 creates it at the workspace root', async () => {
      await openNestedNote();

      fireEvent.contextMenu(document.querySelector('.sidebar-body')!);
      fireEvent.click(await screen.findByText('新建文件夹'));
      await submitCreateDialog('新建文件夹', '新目录');

      await waitFor(() => expect(api.createFolder).toHaveBeenCalledTimes(1), { timeout: 5000 });
      expect(api.createFolder).toHaveBeenCalledWith('新目录');
    }, 20000);

    it('right-clicking a folder still creates inside that folder', async () => {
      await openNestedNote();

      fireEvent.contextMenu(within(screen.getByLabelText('文件树根目录')).getByText('日记').closest('button')!);
      fireEvent.click(await screen.findByText('新建文件夹'));
      await submitCreateDialog('新建文件夹', '子目录');

      await waitFor(() => expect(api.createFolder).toHaveBeenCalledTimes(1), { timeout: 5000 });
      expect(api.createFolder).toHaveBeenCalledWith('日记/子目录');
    }, 20000);

    it('the toolbar 新建笔记 still creates next to the selected note', async () => {
      await openNestedNote();

      fireEvent.click(screen.getByTitle('新建笔记 (Ctrl+N)'));
      await submitCreateDialog('新建 Markdown 文件', '同目录笔记');

      await waitFor(() => expect(disk.has('日记/同目录笔记.md')).toBe(true), { timeout: 5000 });
    }, 20000);
  });

  // BUG_BACKLOG_REAL_WORLD.md RW-P3-001：新建笔记的内容是固定的 “# 新笔记”，标签标题取自这一行，
  // 所以先后新建的笔记标签都叫“新笔记”，无法区分
  describe('RW-P3-001: titles of newly created notes', () => {
    beforeEach(() => {
      // 标签标题来自后端对笔记内容的解析：这里要让测试里的后端也这样做
      backend.titlesFromContent = true;
    });

    /** 工具栏“新建笔记” → 输入名称 → 创建 */
    async function createNoteNamed(name: string) {
      fireEvent.click(screen.getByTitle('新建笔记 (Ctrl+N)'));
      await waitFor(() => expect(isDialogOpen('新建 Markdown 文件')).toBe(true), { timeout: 5000 });
      const dialog = openDialog('新建 Markdown 文件')!;
      fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: name } });
      fireEvent.click(within(dialog).getByRole('button', { name: /创\s*建/ }));
    }

    it('titles each new note after its file name instead of one shared placeholder', async () => {
      await openApp({ 'a.md': '# A\n\n已有笔记\n' }, ['a.md']);

      await createNoteNamed('会议纪要 2024.01.05');
      await waitFor(() => expect(tabPaths()).toContain('会议纪要 2024.01.05.md'), { timeout: 5000 });
      await createNoteNamed('新目录/笔记A');
      await waitFor(() => expect(tabPaths()).toContain('新目录/笔记A.md'), { timeout: 5000 });

      expect(disk.get('会议纪要 2024.01.05.md')).toBe('# 会议纪要 2024.01.05\n\n');
      expect(disk.get('新目录/笔记A.md')).toBe('# 笔记A\n\n');
      expect(tabTitles()).toEqual(['A', '会议纪要 2024.01.05', '笔记A']);
    }, 20000);

    it('does not put the .md / .markdown extension into the heading, whether typed or appended', async () => {
      await openApp({ 'a.md': '# A\n\n已有笔记\n' }, ['a.md']);

      await createNoteNamed('foo.md');
      await waitFor(() => expect(tabPaths()).toContain('foo.md'), { timeout: 5000 });
      await createNoteNamed('文档/bar.markdown');
      await waitFor(() => expect(tabPaths()).toContain('文档/bar.markdown'), { timeout: 5000 });

      expect(disk.get('foo.md')).toBe('# foo\n\n');
      expect(disk.get('文档/bar.markdown')).toBe('# bar\n\n');
      expect(tabTitles()).toEqual(['A', 'foo', 'bar']);
    }, 20000);
  });

  // BUG_BACKLOG_REAL_WORLD.md RW-P3-002：删除当前打开的笔记后，其余标签都还在，但没有任何标签被激活，
  // 编辑区显示“打开本地 Markdown 文件”的空白占位；关闭标签页时则会自动激活相邻的标签
  describe('RW-P3-002: deleting the open note', () => {
    const NOTES: Record<string, string> = {
      'a.md': '# A\n\n甲的正文\n',
      'b.md': '# B\n\n乙的正文\n',
      'c.md': '# C\n\n丙的正文\n',
    };
    const PLACEHOLDER = '打开本地 Markdown 文件';

    async function settle(ms = 1500) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    }

    function tabOf(path: string): HTMLElement | undefined {
      return editorTabs().find((tab) => tab.getAttribute('title') === path);
    }

    /** 点击对话框页脚的确认按钮（不依赖按钮上的文字） */
    function confirmDialog(dialog: HTMLElement) {
      const buttons = dialog.querySelectorAll<HTMLButtonElement>('.ant-modal-footer button');
      fireEvent.click(buttons[buttons.length - 1]);
    }

    /** 工具栏的“删除笔记”：删除当前打开的笔记并确认（浏览器环境没有回收站，是永久删除） */
    async function deleteOpenNote() {
      fireEvent.click(screen.getByTitle('删除笔记'));
      await waitFor(() => expect(isDialogOpen('删除文件')).toBe(true), { timeout: 5000 });
      confirmDialog(openDialog('删除文件')!);
    }

    it('activates the tab that takes the deleted tab\'s place and shows its note', async () => {
      await openApp(NOTES, ['a.md', 'b.md', 'c.md'], 'b.md');
      expect(editorText()).toContain('乙的正文');

      await deleteOpenNote();

      await waitFor(() => expect(disk.has('b.md')).toBe(false), { timeout: 5000 });
      await settle();
      expect(tabPaths()).toEqual(['a.md', 'c.md']);
      expect(tabOf('c.md')).toHaveAttribute('aria-selected', 'true');
      expect(tabOf('a.md')).toHaveAttribute('aria-selected', 'false');
      await waitFor(() => expect(editorText()).toContain('丙的正文'), { timeout: 5000 });
      expect(screen.queryByText(PLACEHOLDER)).toBeNull();
      // 重启后也恢复到这个标签，而不是没有激活任何标签
      expect(storedSettings().activeTabPath).toBe('c.md');
    }, 20000);

    it('falls back to the previous tab when the last tab is deleted', async () => {
      await openApp(NOTES, ['a.md', 'b.md', 'c.md'], 'c.md');

      await deleteOpenNote();

      await waitFor(() => expect(disk.has('c.md')).toBe(false), { timeout: 5000 });
      await settle();
      expect(tabPaths()).toEqual(['a.md', 'b.md']);
      expect(tabOf('b.md')).toHaveAttribute('aria-selected', 'true');
      await waitFor(() => expect(editorText()).toContain('乙的正文'), { timeout: 5000 });
      expect(storedSettings().activeTabPath).toBe('b.md');
    }, 20000);

    it('deleting a folder that holds the open note activates the nearest tab outside the folder', async () => {
      await openApp(
        { ...NOTES, 'docs/x.md': '# X\n\n文件夹里的甲\n', 'docs/y.md': '# Y\n\n文件夹里的乙\n' },
        ['a.md', 'docs/x.md', 'docs/y.md', 'b.md'],
        'docs/x.md',
      );

      fireEvent.contextMenu(within(screen.getByLabelText('文件树根目录')).getByText('docs').closest('button')!);
      fireEvent.click(await screen.findByText('删除'));
      await waitFor(() => expect(isDialogOpen('删除文件夹')).toBe(true), { timeout: 5000 });
      confirmDialog(openDialog('删除文件夹')!);

      await waitFor(() => expect(workspaceFiles().some((path) => path.startsWith('docs/'))).toBe(false), { timeout: 5000 });
      await settle();
      expect(tabPaths()).toEqual(['a.md', 'b.md']);
      expect(tabOf('b.md')).toHaveAttribute('aria-selected', 'true');
      await waitFor(() => expect(editorText()).toContain('乙的正文'), { timeout: 5000 });
    }, 20000);

    it('deleting the only open note still leaves the empty placeholder', async () => {
      await openApp(NOTES, ['a.md']);

      await deleteOpenNote();

      await waitFor(() => expect(disk.has('a.md')).toBe(false), { timeout: 5000 });
      await settle();
      expect(screen.queryByRole('tablist', { name: '打开的文档' })).toBeNull();
      expect(await screen.findByText(PLACEHOLDER)).toBeInTheDocument();
      expect(storedSettings().openTabs).toEqual([]);
    }, 20000);

    it('deleting a note that is not the open one keeps the current tab and editor', async () => {
      await openApp(NOTES, ['a.md', 'b.md', 'c.md'], 'a.md');

      fireEvent.contextMenu(within(screen.getByLabelText('文件树根目录')).getByText('b.md').closest('button')!);
      fireEvent.click(await screen.findByText('删除'));
      await waitFor(() => expect(isDialogOpen('删除文件')).toBe(true), { timeout: 5000 });
      confirmDialog(openDialog('删除文件')!);

      await waitFor(() => expect(disk.has('b.md')).toBe(false), { timeout: 5000 });
      await settle();
      expect(tabPaths()).toEqual(['a.md', 'c.md']);
      expect(tabOf('a.md')).toHaveAttribute('aria-selected', 'true');
      expect(editorText()).toContain('甲的正文');
    }, 20000);
  });

  // BUG_BACKLOG_REAL_WORLD.md RW-P3-003：真实键盘上 Ctrl+Shift+1 / Ctrl+Shift+3 没有反应，
  // 因为 Shift 把 event.key 变成了 '!' / '#'
  describe('RW-P3-003: Ctrl+Shift+1 / Ctrl+Shift+3 on a real keyboard', () => {
    function isSidebarTabSelected(name: string): boolean {
      return screen.getByRole('tab', { name }).getAttribute('aria-selected') === 'true';
    }

    it('opens the outline and file sidebars with the key events a US keyboard sends', async () => {
      await openApp({ 'a.md': '# A\n\n正文\n' }, ['a.md']);
      expect(isSidebarTabSelected('Files')).toBe(true);

      // 美式键盘上的 Ctrl+Shift+1：key 是 '!'，code 仍是 Digit1
      pressShortcut('!', { code: 'Digit1', shiftKey: true });
      expect(isSidebarTabSelected('Outline')).toBe(true);
      expect(isSidebarTabSelected('Files')).toBe(false);

      pressShortcut('#', { code: 'Digit3', shiftKey: true });
      expect(isSidebarTabSelected('Files')).toBe(true);
      expect(isSidebarTabSelected('Outline')).toBe(false);
    }, 20000);
  });
});
