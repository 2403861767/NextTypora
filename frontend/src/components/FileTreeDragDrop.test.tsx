import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FileTree } from './FileTree';
import type { TreeNode, TreeSelection } from '../types';

type MoveHandler = (source: TreeSelection, targetFolderPath: string) => void;
type MoveRequestHandler = (source: TreeSelection) => void;

const originalResizeObserver = globalThis.ResizeObserver;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderTree(
  nodes: TreeNode[],
  {
    onMove = vi.fn<MoveHandler>(),
    onMoveRequest,
    expandedFolders = new Set(['parent']),
  }: {
    onMove?: MoveHandler;
    onMoveRequest?: MoveRequestHandler;
    expandedFolders?: Set<string>;
  } = {},
) {
  render(
    <FileTree
      nodes={nodes}
      selectedTreeItem={null}
      expandedFolders={expandedFolders}
      onExpandedFoldersChange={vi.fn()}
      onSelectFile={vi.fn()}
      onSelectFolder={vi.fn()}
      onHighlightSelection={vi.fn()}
      onCreateFolder={vi.fn()}
      onCreateMarkdown={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onMove={onMove}
      onMoveRequest={onMoveRequest}
    />,
  );
  return onMove;
}

function dataTransfer() {
  const store = new Map<string, string>();
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn((type: string, value: string) => store.set(type, value)),
    getData: vi.fn((type: string) => store.get(type) ?? ''),
  };
}

describe('FileTree drag and drop', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverStub;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  afterEach(() => {
    cleanup();
  });

  it('moves a markdown file onto a folder', () => {
    const onMove = renderTree([
      { name: 'note.md', path: 'note.md', directory: false, children: [] },
      { name: 'Archive', path: 'archive', directory: true, children: [] },
    ]);

    const source = screen.getByText('note.md').closest('button')!;
    const target = screen.getByText('Archive').closest('button')!;
    const transfer = dataTransfer();

    fireEvent.dragStart(source, { dataTransfer: transfer });
    fireEvent.dragOver(target, { dataTransfer: transfer });
    fireEvent.drop(target, { dataTransfer: transfer });

    expect(onMove).toHaveBeenCalledWith({ path: 'note.md', isDirectory: false }, 'archive');
  });

  it('does not move a folder into its own child folder', () => {
    const onMove = renderTree([
      {
        name: 'Parent',
        path: 'parent',
        directory: true,
        children: [
          { name: 'Child', path: 'parent/child', directory: true, children: [] },
        ],
      },
    ]);

    const source = screen.getByText('Parent').closest('button')!;
    const target = screen.getByText('Child').closest('button')!;
    const transfer = dataTransfer();

    fireEvent.dragStart(source, { dataTransfer: transfer });
    fireEvent.dragOver(target, { dataTransfer: transfer });
    fireEvent.drop(target, { dataTransfer: transfer });

    expect(onMove).not.toHaveBeenCalled();
  });

  it('moves a nested markdown file onto the root file tree area', () => {
    const onMove = renderTree([
      {
        name: 'Parent',
        path: 'parent',
        directory: true,
        children: [
          { name: 'note.md', path: 'parent/note.md', directory: false, children: [] },
        ],
      },
    ]);

    const source = screen.getByText('note.md').closest('button')!;
    const root = screen.getByLabelText('文件树根目录');
    const transfer = dataTransfer();

    fireEvent.dragStart(source, { dataTransfer: transfer });
    fireEvent.dragOver(root, { dataTransfer: transfer });
    fireEvent.drop(root, { dataTransfer: transfer });

    expect(onMove).toHaveBeenCalledWith({ path: 'parent/note.md', isDirectory: false }, '');
  });

  it('does not also move to root when dropping on a folder', () => {
    const onMove = renderTree([
      {
        name: 'Parent',
        path: 'parent',
        directory: true,
        children: [
          { name: 'note.md', path: 'parent/note.md', directory: false, children: [] },
        ],
      },
      { name: 'Archive', path: 'archive', directory: true, children: [] },
    ]);

    const source = screen.getByText('note.md').closest('button')!;
    const target = screen.getByText('Archive').closest('button')!;
    const transfer = dataTransfer();

    fireEvent.dragStart(source, { dataTransfer: transfer });
    fireEvent.dragOver(target, { dataTransfer: transfer });
    fireEvent.drop(target, { dataTransfer: transfer });

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ path: 'parent/note.md', isDirectory: false }, 'archive');
    expect(onMove).not.toHaveBeenCalledWith({ path: 'parent/note.md', isDirectory: false }, '');
  });

  it('invokes onMoveRequest from the right-click move-to menu item', async () => {
    const onMoveRequest = vi.fn<MoveRequestHandler>();
    renderTree(
      [{ name: 'note.md', path: 'note.md', directory: false, children: [] }],
      { onMoveRequest },
    );

    fireEvent.contextMenu(screen.getByText('note.md').closest('button')!);
    const moveTo = await screen.findByText('移动到');
    fireEvent.click(moveTo);

    await waitFor(() => {
      expect(onMoveRequest).toHaveBeenCalledWith({ path: 'note.md', isDirectory: false });
    });
  });
});
