import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EditorTab, PreferenceSettings } from '../types';
import { SettingsModal } from './SettingsModal';

vi.mock('../api', () => ({ scanLegacyBackups: vi.fn() }));
const { scanLegacyBackups } = await import('../api');

const CSS_PLACEHOLDER = '.ProseMirror p { line-height: 1.8; }';
const TYPED_CSS = '.ProseMirror p { color: red; }';

function tab(path: string): EditorTab {
  return { id: path, path, title: path, content: '', loadedContent: '', contentHash: '', saveStatus: 'idle' };
}

/** App 每次渲染都会新建一个 initial 对象：每次调用都返回内容相同的新对象 */
function settings(overrides: Partial<PreferenceSettings> = {}): PreferenceSettings {
  return {
    mode: 'local',
    picgoServerUrl: 'http://127.0.0.1:36677',
    picgoSecret: '',
    spellCheckEnabled: false,
    themeId: 'default-light',
    editorThemeId: 'default-light',
    customCss: '',
    shortcuts: {},
    recentFiles: [],
    recentWorkspaces: [],
    openTabs: [tab('a.md')],
    activeTabPath: 'a.md',
    writingModes: { focusMode: false, typewriterMode: false, distractionFreeMode: false },
    ...overrides,
  };
}

function dialog(): HTMLElement {
  return screen.getByRole('dialog', { name: '偏好设置' });
}

function customCssInput(): HTMLElement {
  return within(dialog()).getByPlaceholderText(CSS_PLACEHOLDER);
}

function spellCheckSwitch(): HTMLElement {
  return within(dialog()).getByRole('switch');
}

function editDraft() {
  fireEvent.change(customCssInput(), { target: { value: TYPED_CSS } });
  fireEvent.click(spellCheckSwitch());
  expect(customCssInput()).toHaveValue(TYPED_CSS);
  expect(spellCheckSwitch()).toHaveAttribute('aria-checked', 'true');
}

// BUG_BACKLOG_REAL_WORLD.md RW-P2-003：App 的 8 秒轮询会让 App 重新渲染并传入新的 initial 对象，
// 对话框据此重置草稿，未保存的修改被冲掉
describe('SettingsModal draft', () => {
  beforeAll(() => {
    // 自动调整高度的 TextArea 依赖 ResizeObserver，jsdom 没有
    if (!('ResizeObserver' in window)) {
      vi.stubGlobal('ResizeObserver', class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      });
    }
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('keeps unsaved edits when the parent re-renders with a new but equal initial object', () => {
    const props = { onClose: vi.fn(), onSaved: vi.fn() };
    const { rerender } = render(<SettingsModal open initial={settings()} {...props} />);
    editDraft();

    rerender(<SettingsModal open initial={settings()} {...props} />);

    expect(customCssInput()).toHaveValue(TYPED_CSS);
    expect(spellCheckSwitch()).toHaveAttribute('aria-checked', 'true');
  });

  it('starts again from the latest settings when the dialog is closed and reopened', async () => {
    const props = { onClose: vi.fn(), onSaved: vi.fn() };
    const { rerender } = render(<SettingsModal open initial={settings()} {...props} />);
    editDraft();

    rerender(<SettingsModal open={false} initial={settings()} {...props} />);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '偏好设置' })).toBeNull());
    rerender(<SettingsModal open initial={settings({ customCss: 'h1 { color: blue; }' })} {...props} />);

    expect(customCssInput()).toHaveValue('h1 { color: blue; }');
    expect(spellCheckSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('saves the edits together with the latest tabs and writing modes, not the ones from when it opened', async () => {
    const onSaved = vi.fn();
    const props = { onClose: vi.fn(), onSaved };
    const { rerender } = render(<SettingsModal open initial={settings()} {...props} />);
    editDraft();

    // 对话框打开期间标签页、写作模式在别处变了（如全局快捷键）：保存时不能用打开时的旧值覆盖它们
    const latest = settings({
      openTabs: [tab('a.md'), tab('b.md')],
      activeTabPath: 'b.md',
      writingModes: { focusMode: true, typewriterMode: false, distractionFreeMode: false },
    });
    rerender(<SettingsModal open initial={latest} {...props} />);
    fireEvent.click(within(dialog()).getByRole('button', { name: /^保\s*存$/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const stored = JSON.parse(localStorage.getItem('nexttyproa-app-settings') ?? '{}') as Record<string, unknown>;
    expect(stored.customCss).toBe(TYPED_CSS);
    expect(stored.spellCheckEnabled).toBe(true);
    expect((stored.openTabs as EditorTab[]).map((item) => item.path)).toEqual(['a.md', 'b.md']);
    expect(stored.activeTabPath).toBe('b.md');
    expect(stored.writingModes).toEqual({ focusMode: true, typewriterMode: false, distractionFreeMode: false });
  });
});

// V103-04：1.0.3 移除保存时备份后，老工作区里残留的 .nexttyproa-backups 目录
// 要能被扫出来并移到系统回收站（可撤销），而不是永久删除，也不自动删
describe('SettingsModal 存储区块', () => {
  beforeAll(() => {
    if (!('ResizeObserver' in window)) {
      vi.stubGlobal('ResizeObserver', class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      });
    }
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.mocked(scanLegacyBackups).mockReset();
    delete (window as { nextTyproa?: unknown }).nextTyproa;
  });

  const open = () => render(<SettingsModal open initial={settings()} onClose={vi.fn()} onSaved={vi.fn()} />);
  const scanButton = () => within(dialog()).getByRole('button', { name: '扫描残留备份' });

  it('扫描结果为空时给出明确反馈，而不是一声不响', async () => {
    vi.mocked(scanLegacyBackups).mockResolvedValue({ directories: [], totalBytes: 0 });
    open();

    fireEvent.click(scanButton());

    expect(await within(dialog()).findByText('当前工作区没有残留的备份目录')).toBeTruthy();
    // 没东西可删，就不该出现删除按钮
    expect(within(dialog()).queryByRole('button', { name: '移到回收站' })).toBeNull();
  });

  it('先报出目录数与总体积，并逐个列出来，然后才给删除按钮', async () => {
    vi.mocked(scanLegacyBackups).mockResolvedValue({
      directories: [
        { path: '项目2026/.nexttyproa-backups', fileCount: 10, bytes: 2048 },
        { path: '日记/.nexttyproa-backups', fileCount: 3, bytes: 1024 },
      ],
      totalBytes: 3072,
    });
    open();

    fireEvent.click(scanButton());

    expect(await within(dialog()).findByText('找到 2 个备份目录，共 3.0 KB')).toBeTruthy();
    expect(within(dialog()).getByText(/项目2026\/\.nexttyproa-backups（10 个文件，2\.0 KB）/)).toBeTruthy();
    expect(within(dialog()).getByText(/日记\/\.nexttyproa-backups（3 个文件，1\.0 KB）/)).toBeTruthy();
    expect(within(dialog()).getByRole('button', { name: '移到回收站' })).toBeTruthy();
  });

  it('确认后把每个目录交给系统回收站，并重新扫描', async () => {
    const trashItem = vi.fn().mockResolvedValue(undefined);
    (window as { nextTyproa?: unknown }).nextTyproa = { trashItem };
    vi.mocked(scanLegacyBackups)
      .mockResolvedValueOnce({
        directories: [
          { path: '项目2026/.nexttyproa-backups', fileCount: 10, bytes: 2048 },
          { path: '日记/.nexttyproa-backups', fileCount: 3, bytes: 1024 },
        ],
        totalBytes: 3072,
      })
      .mockResolvedValueOnce({ directories: [], totalBytes: 0 });
    open();

    fireEvent.click(scanButton());
    fireEvent.click(await within(dialog()).findByRole('button', { name: '移到回收站' }));

    await waitFor(() => expect(trashItem.mock.calls).toEqual([
      ['项目2026/.nexttyproa-backups'],
      ['日记/.nexttyproa-backups'],
    ]));
    // 删完重新扫描，面板显示磁盘的真实情况
    expect(await within(dialog()).findByText('当前工作区没有残留的备份目录')).toBeTruthy();
    expect(vi.mocked(scanLegacyBackups)).toHaveBeenCalledTimes(2);
  });

  it('没有回收站通路时不动用户的文件', async () => {
    vi.mocked(scanLegacyBackups).mockResolvedValue({
      directories: [{ path: '日记/.nexttyproa-backups', fileCount: 1, bytes: 10 }],
      totalBytes: 10,
    });
    open();

    fireEvent.click(scanButton());
    fireEvent.click(await within(dialog()).findByRole('button', { name: '移到回收站' }));

    // 必须告诉用户为什么没动，而不是静默失败
    expect(await screen.findByText(/无法访问系统回收站/)).toBeTruthy();
    // 只扫过一次：没有删除通路就不该触发重新扫描，更不该有别的删除退路
    await waitFor(() => expect(vi.mocked(scanLegacyBackups)).toHaveBeenCalledTimes(1));
  });
});

// V103-07：1.0.3 之前应用里完全看不到版本号——没有关于对话框，app.getVersion() 从未被调用
describe('SettingsModal 关于区块', () => {
  beforeAll(() => {
    if (!('ResizeObserver' in window)) {
      vi.stubGlobal('ResizeObserver', class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      });
    }
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    delete (window as { nextTyproa?: unknown }).nextTyproa;
  });

  const open = () => render(<SettingsModal open initial={settings()} onClose={vi.fn()} onSaved={vi.fn()} />);

  it('显示主进程报告的版本号', async () => {
    const getAppVersion = vi.fn().mockResolvedValue('1.0.3');
    (window as { nextTyproa?: unknown }).nextTyproa = { getAppVersion };
    open();

    expect(await within(dialog()).findByText('1.0.3')).toBeTruthy();
    expect(getAppVersion).toHaveBeenCalled();
  });

  it('拿不到版本号时说明原因，而不是显示一个编出来的值', async () => {
    open();

    expect(await within(dialog()).findByText(/版本号不可用/)).toBeTruthy();
  });

  // 版本号只能来自主进程：渲染进程不该从别处猜一个出来
  it('主进程报错时也不编版本号', async () => {
    (window as { nextTyproa?: unknown }).nextTyproa = {
      getAppVersion: vi.fn().mockRejectedValue(new Error('boom')),
    };
    open();

    expect(await within(dialog()).findByText(/版本号不可用/)).toBeTruthy();
  });
});
