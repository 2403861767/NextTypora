import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EditorTab, PreferenceSettings } from '../types';
import { SettingsModal } from './SettingsModal';

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
