import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FileTree } from './FileTree';
import type { TreeNode } from '../types';

const originalResizeObserver = globalThis.ResizeObserver;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const NODES: TreeNode[] = [
  {
    name: 'Archive',
    path: 'archive',
    directory: true,
    children: [{ name: 'old.md', path: 'archive/old.md', directory: false, children: [] }],
  },
  { name: 'note.md', path: 'note.md', directory: false, children: [] },
];

function renderTree(expandedFolders = new Set<string>()) {
  const handlers = {
    onSelectFile: vi.fn(),
    onSelectFolder: vi.fn(),
    onExpandedFoldersChange: vi.fn(),
  };
  render(
    <FileTree
      nodes={NODES}
      selectedTreeItem={null}
      expandedFolders={expandedFolders}
      onExpandedFoldersChange={handlers.onExpandedFoldersChange}
      onSelectFile={handlers.onSelectFile}
      onSelectFolder={handlers.onSelectFolder}
      onHighlightSelection={vi.fn()}
      onCreateFolder={vi.fn()}
      onCreateMarkdown={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onMove={vi.fn()}
    />,
  );
  return handlers;
}

// BUG_BACKLOG_REAL_WORLD.md RW-P3-005 (1)：点击文件夹名称只会选中，必须点小三角才能展开
// （Typora、VS Code 点名称就能展开）；Enter 同样只选中，所以键盘根本无法展开文件夹
describe('FileTree folder rows', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverStub;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  afterEach(() => {
    cleanup();
  });

  it('selects and expands a collapsed folder when its name is clicked', () => {
    const { onSelectFolder, onExpandedFoldersChange } = renderTree();

    fireEvent.click(screen.getByText('Archive'));

    expect(onSelectFolder).toHaveBeenCalledWith('archive');
    expect(onExpandedFoldersChange).toHaveBeenCalledTimes(1);
    expect(onExpandedFoldersChange).toHaveBeenCalledWith(['archive']);
  });

  it('collapses an expanded folder when its name is clicked', () => {
    const { onSelectFolder, onExpandedFoldersChange } = renderTree(new Set(['archive']));

    fireEvent.click(screen.getByText('Archive'));

    expect(onSelectFolder).toHaveBeenCalledWith('archive');
    expect(onExpandedFoldersChange).toHaveBeenCalledTimes(1);
    expect(onExpandedFoldersChange).toHaveBeenCalledWith([]);
  });

  it('expands a folder with Enter, like a click on its name', () => {
    const { onSelectFolder, onExpandedFoldersChange } = renderTree();

    fireEvent.keyDown(screen.getByText('Archive').closest('button')!, { key: 'Enter' });

    expect(onSelectFolder).toHaveBeenCalledWith('archive');
    expect(onExpandedFoldersChange).toHaveBeenCalledTimes(1);
    expect(onExpandedFoldersChange).toHaveBeenCalledWith(['archive']);
  });

  it('still toggles exactly once when the caret is clicked', () => {
    const { onExpandedFoldersChange } = renderTree();

    fireEvent.click(document.querySelector('.tree-caret-hitbox')!);

    expect(onExpandedFoldersChange).toHaveBeenCalledTimes(1);
    expect(onExpandedFoldersChange).toHaveBeenCalledWith(['archive']);
  });

  it('opens a note when its name is clicked and leaves the expanded folders alone', () => {
    const { onSelectFile, onExpandedFoldersChange } = renderTree(new Set(['archive']));

    fireEvent.click(screen.getByText('old.md'));

    expect(onSelectFile).toHaveBeenCalledWith('archive/old.md');
    expect(onExpandedFoldersChange).not.toHaveBeenCalled();
  });
});
