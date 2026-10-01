import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SidebarPanel, type SidebarTab } from './SidebarPanel';

const originalResizeObserver = globalThis.ResizeObserver;
const originalMatchMedia = window.matchMedia;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderPanel(tab: SidebarTab = 'files') {
  const handlers = {
    onCreateMarkdown: vi.fn(),
    onCreateFolder: vi.fn(),
    onRefresh: vi.fn(),
  };
  render(
    <SidebarPanel
      open
      tab={tab}
      onTabChange={vi.fn()}
      filesContent={<div>文件树内容</div>}
      outlineContent={<div>大纲内容</div>}
      workspacePath="D:/vault"
      {...handlers}
    />,
  );
  return handlers;
}

async function menuIsAbsent(label: string) {
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(screen.queryByText(label)).toBeNull();
}

// BUG_BACKLOG_REAL_WORLD.md RW-P2-009：界面上无法在工作区根目录新建文件夹，
// 侧栏顶部的“…”（侧边栏选项）按钮没有功能，文件树空白处右键也没有菜单
describe('SidebarPanel root actions', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverStub;
    if (!window.matchMedia) {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
    }
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    window.matchMedia = originalMatchMedia;
  });

  afterEach(() => {
    cleanup();
  });

  it('the "…" button opens a menu that creates a folder at the workspace root', async () => {
    const handlers = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '侧边栏选项' }));
    fireEvent.click(await screen.findByText('新建文件夹'));

    expect(handlers.onCreateFolder).toHaveBeenCalledTimes(1);
    expect(handlers.onCreateMarkdown).not.toHaveBeenCalled();
  });

  it('the "…" menu also creates a note at the root and refreshes the tree', async () => {
    const handlers = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '侧边栏选项' }));
    fireEvent.click(await screen.findByText('新建笔记'));
    expect(handlers.onCreateMarkdown).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '侧边栏选项' }));
    fireEvent.click(await screen.findByText('刷新文件树'));
    expect(handlers.onRefresh).toHaveBeenCalledTimes(1);
    expect(handlers.onCreateFolder).not.toHaveBeenCalled();
  });

  it('right-clicking blank space of the Files tab offers the same root actions', async () => {
    const handlers = renderPanel('files');

    fireEvent.contextMenu(screen.getByRole('tabpanel'));
    fireEvent.click(await screen.findByText('新建文件夹'));

    expect(handlers.onCreateFolder).toHaveBeenCalledTimes(1);
  });

  it('other tabs have no create menu on right-click', async () => {
    renderPanel('outline');

    fireEvent.contextMenu(screen.getByRole('tabpanel'));

    await menuIsAbsent('新建文件夹');
  });
});
