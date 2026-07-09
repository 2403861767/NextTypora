import {
  CaretRightOutlined,
  CopyOutlined,
  FileOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  SwapOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Dropdown, type MenuProps } from 'antd';
import { useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { TreeNode, TreeSelection } from '../types';

export type FileTreeSortMode = 'name' | 'updatedAt' | 'type';

interface FileTreeProps {
  nodes: TreeNode[];
  selectedTreeItem: TreeSelection | null;
  onSelectFile: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onHighlightSelection: (selection: TreeSelection) => void;
  onCreateFolder: (parentPath: string) => void;
  onCreateMarkdown: (parentPath: string) => void;
  onRename: (target: TreeSelection) => void;
  onDelete: (target: TreeSelection) => void;
  onMove: (source: TreeSelection, targetFolderPath: string) => void;
  onMoveRequest?: (source: TreeSelection) => void;
  expandedFolders: Set<string>;
  onExpandedFoldersChange: (paths: string[]) => void;
  workspacePath?: string;
  sortMode?: FileTreeSortMode;
  directoriesFirst?: boolean;
  showToolbar?: boolean;
  getUpdatedAt?: (node: TreeNode) => string | number | Date | undefined;
  onSortModeChange?: (sortMode: FileTreeSortMode) => void;
  onDirectoriesFirstChange?: (directoriesFirst: boolean) => void;
  onRevealInExplorer?: (absolutePath: string) => void | Promise<void>;
  onCopyPath?: (path: string, kind: 'relative' | 'absolute') => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function joinWorkspacePath(workspacePath: string, relativePath: string): string {
  const sep = workspacePath.includes('\\') ? '\\' : '/';
  const base = workspacePath.replace(/[/\\]+$/, '');
  const rel = relativePath.replace(/^[/\\]+/, '').replace(/\//g, sep);
  return `${base}${sep}${rel}`;
}

function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? path;
  const index = name.lastIndexOf('.');
  return index > -1 ? name.slice(index + 1).toLowerCase() : '';
}

function updatedAtValue(node: TreeNode, getUpdatedAt?: FileTreeProps['getUpdatedAt']): number {
  const raw = getUpdatedAt?.(node) ?? (node as TreeNode & { updatedAt?: string | number | Date }).updatedAt;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function sortTreeNodes(
  nodes: TreeNode[],
  sortMode: FileTreeSortMode,
  directoriesFirst: boolean,
  getUpdatedAt?: FileTreeProps['getUpdatedAt'],
): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (directoriesFirst && a.directory !== b.directory) {
      return a.directory ? -1 : 1;
    }

    if (sortMode === 'updatedAt') {
      const byTime = updatedAtValue(b, getUpdatedAt) - updatedAtValue(a, getUpdatedAt);
      if (byTime !== 0) return byTime;
    }

    if (sortMode === 'type') {
      const byType = extensionOf(a.path).localeCompare(extensionOf(b.path), undefined, { sensitivity: 'base' });
      if (byType !== 0) return byType;
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function TreeItem({
  node,
  selectedTreeItem,
  onSelectFile,
  onSelectFolder,
  onHighlightSelection,
  onCreateFolder,
  onCreateMarkdown,
  onRename,
  onDelete,
  onMove,
  onMoveRequest,
  depth = 0,
  expandedFolders,
  onToggleFolder,
  draggingPath,
  dragOverPath,
  onDragStart,
  onDragEnd,
  onDragOverFolder,
  onDropOnFolder,
  sortedChildren,
  workspacePath,
  onRevealInExplorer,
  onCopyPath,
  onRefresh,
}: {
  node: TreeNode;
  selectedTreeItem: TreeSelection | null;
  onSelectFile: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onHighlightSelection: (selection: TreeSelection) => void;
  onCreateFolder: (parentPath: string) => void;
  onCreateMarkdown: (parentPath: string) => void;
  onRename: (target: TreeSelection) => void;
  onDelete: (target: TreeSelection) => void;
  onMove: (source: TreeSelection, targetFolderPath: string) => void;
  onMoveRequest?: (source: TreeSelection) => void;
  depth?: number;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  draggingPath: string;
  dragOverPath: string;
  onDragStart: (selection: TreeSelection, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOverFolder: (folderPath: string, event: DragEvent<HTMLElement>) => void;
  onDropOnFolder: (folderPath: string, event: DragEvent<HTMLElement>) => void;
  sortedChildren: (nodes: TreeNode[]) => TreeNode[];
  workspacePath: string;
  onRevealInExplorer?: (absolutePath: string) => void | Promise<void>;
  onCopyPath?: (path: string, kind: 'relative' | 'absolute') => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
}) {
  const pathKey = node.path || node.name;
  const absolutePath = workspacePath ? joinWorkspacePath(workspacePath, pathKey) : '';
  const selection: TreeSelection = { path: node.path, isDirectory: node.directory };

  const runCopyPath = async (kind: 'relative' | 'absolute') => {
    const target = kind === 'absolute' ? absolutePath : node.path;
    if (!target) return;
    await (onCopyPath?.(target, kind) ?? copyText(target));
  };

  const runReveal = async () => {
    if (!absolutePath) return;
    await (onRevealInExplorer?.(absolutePath) ?? window.nextTyproa?.revealInExplorer?.(absolutePath));
  };

  const commonPathActions: MenuProps['items'] = [
    { key: 'reveal', icon: <FolderOpenOutlined />, label: '在资源管理器中显示', disabled: !absolutePath },
    { key: 'copy-relative', icon: <CopyOutlined />, label: '复制相对路径' },
    { key: 'copy-absolute', icon: <CopyOutlined />, label: '复制绝对路径', disabled: !absolutePath },
    { key: 'refresh', icon: <ReloadOutlined />, label: '刷新文件树', disabled: !onRefresh },
  ];

  const handleMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    domEvent.stopPropagation();
    onHighlightSelection(selection);
    if (key === 'create-folder') onCreateFolder(selection.path);
    if (key === 'create-markdown') onCreateMarkdown(selection.path);
    if (key === 'rename') onRename(selection);
    if (key === 'delete') onDelete(selection);
    if (key === 'move-to') onMoveRequest?.(selection);
    if (key === 'reveal') void runReveal();
    if (key === 'copy-relative') void runCopyPath('relative');
    if (key === 'copy-absolute') void runCopyPath('absolute');
    if (key === 'refresh') void onRefresh?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'F2') {
      event.preventDefault();
      onHighlightSelection(selection);
      onRename(selection);
      return;
    }

    if (event.key === 'Delete') {
      event.preventDefault();
      onHighlightSelection(selection);
      onDelete(selection);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (node.directory) onSelectFolder(node.path);
      else onSelectFile(node.path);
    }
  };

  if (node.directory) {
    const expanded = expandedFolders.has(pathKey);
    const menu: MenuProps = {
      items: [
        { key: 'create-folder', label: '新建文件夹' },
        { key: 'create-markdown', label: '新建 Markdown 文件' },
        { type: 'divider' },
        ...commonPathActions,
        { type: 'divider' },
        { key: 'move-to', icon: <SwapOutlined />, label: '移动到', disabled: !onMoveRequest },
        { type: 'divider' },
        { key: 'rename', label: '重命名' },
        { key: 'delete', label: '删除', danger: true },
      ],
      onClick: handleMenuClick,
    };

    return (
      <div className="tree-folder">
        <Dropdown menu={menu} trigger={['contextMenu']}>
          <button
            type="button"
            className={`tree-folder-btn ${
              selectedTreeItem?.isDirectory && selectedTreeItem.path === node.path
                ? 'active'
                : ''
            } ${dragOverPath === pathKey ? 'drop-target' : ''} ${draggingPath === node.path ? 'dragging' : ''}`}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            draggable
            onDragStart={(event) => onDragStart(selection, event)}
            onDragEnd={onDragEnd}
            onDragOver={(event) => onDragOverFolder(pathKey, event)}
            onDrop={(event) => onDropOnFolder(pathKey, event)}
            onContextMenu={() => onHighlightSelection(selection)}
            onKeyDown={handleKeyDown}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('.tree-caret-hitbox')) {
                onToggleFolder(pathKey);
                return;
              }
              onSelectFolder(node.path);
            }}
            title={node.path}
          >
            <span className="tree-caret-hitbox">
              <CaretRightOutlined className={`tree-caret ${expanded ? 'expanded' : ''}`} />
            </span>
            <FolderOutlined className="tree-folder-icon" />
            <span className="tree-folder-label">{node.name}</span>
          </button>
        </Dropdown>
        {expanded && (
          <div className="tree-folder-children">
            {sortedChildren(node.children).map((child) => (
              <TreeItem
                key={child.path || child.name}
                node={child}
                selectedTreeItem={selectedTreeItem}
                onSelectFile={onSelectFile}
                onSelectFolder={onSelectFolder}
                onHighlightSelection={onHighlightSelection}
                onCreateFolder={onCreateFolder}
                onCreateMarkdown={onCreateMarkdown}
                onRename={onRename}
                onDelete={onDelete}
                onMove={onMove}
                onMoveRequest={onMoveRequest}
                depth={depth + 1}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                draggingPath={draggingPath}
                dragOverPath={dragOverPath}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOverFolder={onDragOverFolder}
                onDropOnFolder={onDropOnFolder}
                sortedChildren={sortedChildren}
                workspacePath={workspacePath}
                onRevealInExplorer={onRevealInExplorer}
                onCopyPath={onCopyPath}
                onRefresh={onRefresh}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const unsupported = !isMarkdownPath(node.path);
  const menu: MenuProps = {
    items: [
      ...commonPathActions,
      { type: 'divider' },
      { key: 'move-to', icon: <SwapOutlined />, label: '移动到', disabled: !onMoveRequest },
      { key: 'rename', label: '重命名' },
      { key: 'delete', label: '删除', danger: true },
    ],
    onClick: handleMenuClick,
  };

  return (
    <Dropdown menu={menu} trigger={['contextMenu']}>
      <button
        type="button"
        className={`tree-file ${
          selectedTreeItem?.path === node.path && !selectedTreeItem?.isDirectory
            ? 'active'
            : ''
        } ${unsupported ? 'unsupported' : ''} ${draggingPath === node.path ? 'dragging' : ''}`}
        style={{ paddingLeft: `${28 + depth * 12}px` }}
        draggable={!unsupported}
        onDragStart={(event) => {
          if (unsupported) return;
          onDragStart(selection, event);
        }}
        onDragEnd={onDragEnd}
        onClick={() => onSelectFile(node.path)}
        onContextMenu={() => onHighlightSelection(selection)}
        onKeyDown={handleKeyDown}
        title={absolutePath || node.path}
      >
        {unsupported ? <FileOutlined className="tree-file-icon" /> : <FileTextOutlined className="tree-file-icon" />}
        <span className="tree-file-label">{node.name}</span>
      </button>
    </Dropdown>
  );
}

export function FileTree({
  nodes,
  selectedTreeItem,
  onSelectFile,
  onSelectFolder,
  onHighlightSelection,
  onCreateFolder,
  onCreateMarkdown,
  onRename,
  onDelete,
  onMove,
  onMoveRequest,
  expandedFolders,
  onExpandedFoldersChange,
  workspacePath = '',
  sortMode,
  directoriesFirst,
  showToolbar = true,
  getUpdatedAt,
  onSortModeChange,
  onDirectoriesFirstChange,
  onRevealInExplorer,
  onCopyPath,
  onRefresh,
}: FileTreeProps) {
  const [dragging, setDragging] = useState<TreeSelection | null>(null);
  const [dragOverPath, setDragOverPath] = useState('');
  const [rootDragOver, setRootDragOver] = useState(false);
  const [internalSortMode, setInternalSortMode] = useState<FileTreeSortMode>('name');
  const [internalDirectoriesFirst, setInternalDirectoriesFirst] = useState(true);

  const effectiveSortMode = sortMode ?? internalSortMode;
  const effectiveDirectoriesFirst = directoriesFirst ?? internalDirectoriesFirst;
  const sortedRootNodes = useMemo(
    () => sortTreeNodes(nodes, effectiveSortMode, effectiveDirectoriesFirst, getUpdatedAt),
    [effectiveDirectoriesFirst, effectiveSortMode, getUpdatedAt, nodes],
  );
  const sortedChildren = (children: TreeNode[]) => sortTreeNodes(
    children,
    effectiveSortMode,
    effectiveDirectoriesFirst,
    getUpdatedAt,
  );

  const setSortMode = (nextSortMode: FileTreeSortMode) => {
    setInternalSortMode(nextSortMode);
    onSortModeChange?.(nextSortMode);
  };

  const setDirectoriesFirst = (nextDirectoriesFirst: boolean) => {
    setInternalDirectoriesFirst(nextDirectoriesFirst);
    onDirectoriesFirstChange?.(nextDirectoriesFirst);
  };

  const toggleFolder = (path: string) => {
    const next = new Set(expandedFolders);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    onExpandedFoldersChange(Array.from(next).sort());
  };

  const handleDragStart = (selection: TreeSelection, event: DragEvent<HTMLElement>) => {
    setDragging(selection);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-nexttyproa-path', selection.path);
  };

  const handleDragEnd = () => {
    setDragging(null);
    setDragOverPath('');
    setRootDragOver(false);
  };

  const canDropOnFolder = (targetFolderPath: string) => {
    if (!dragging) return false;
    if (dragging.path === targetFolderPath) return false;
    if (dragging.isDirectory && targetFolderPath.startsWith(`${dragging.path}/`)) return false;
    return true;
  };

  const handleDragOverFolder = (folderPath: string, event: DragEvent<HTMLElement>) => {
    if (!canDropOnFolder(folderPath)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setRootDragOver(false);
    setDragOverPath(folderPath);
  };

  const handleDropOnFolder = (folderPath: string, event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (dragging && canDropOnFolder(folderPath)) {
      onMove(dragging, folderPath);
    }
    handleDragEnd();
  };

  const canDropOnRoot = () => {
    if (!dragging) return false;
    return dragging.path.includes('/');
  };

  const handleDragOverRoot = (event: DragEvent<HTMLDivElement>) => {
    if (!canDropOnRoot()) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverPath('');
    setRootDragOver(true);
  };

  const handleDragLeaveRoot = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setRootDragOver(false);
    }
  };

  const handleDropOnRoot = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (dragging && canDropOnRoot()) {
      onMove(dragging, '');
    }
    handleDragEnd();
  };

  const toolbar = showToolbar ? (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>排序</span>
        <select
          title="文件树排序"
          aria-label="文件树排序"
          value={effectiveSortMode}
          onChange={(event) => setSortMode(event.target.value as FileTreeSortMode)}
          style={{
            minWidth: 0,
            width: '100%',
            height: 24,
            border: '1px solid var(--border)',
            borderRadius: 5,
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: 12,
          }}
        >
          <option value="name">名称</option>
          <option value="updatedAt">更新时间</option>
          <option value="type">类型</option>
        </select>
      </label>
      <label
        title="目录优先"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          color: 'var(--text-muted)',
          fontSize: 11,
          whiteSpace: 'nowrap',
        }}
      >
        <input
          type="checkbox"
          checked={effectiveDirectoriesFirst}
          onChange={(event) => setDirectoriesFirst(event.target.checked)}
        />
        目录优先
      </label>
      <button
        type="button"
        title="刷新文件树"
        aria-label="刷新文件树"
        disabled={!onRefresh}
        onClick={() => { void onRefresh?.(); }}
        style={{
          width: 24,
          height: 24,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          borderRadius: 5,
          background: 'transparent',
          color: onRefresh ? 'var(--text-secondary)' : 'var(--text-muted)',
          cursor: onRefresh ? 'pointer' : 'not-allowed',
        }}
      >
        <ReloadOutlined />
      </button>
    </div>
  ) : null;

  if (nodes.length === 0) {
    return (
      <>
        {toolbar}
        <div className="sidebar-empty">
          <p>暂无文件</p>
          <span>选择工作区或新建一个 Markdown 文件</span>
        </div>
      </>
    );
  }

  return (
    <>
      {toolbar}
      <div
        className={`file-tree ${rootDragOver ? 'root-drop-target' : ''}`}
        onDragOver={handleDragOverRoot}
        onDragLeave={handleDragLeaveRoot}
        onDrop={handleDropOnRoot}
        aria-label="文件树根目录"
      >
        {sortedRootNodes.map((node) => (
          <TreeItem
            key={node.path || node.name}
            node={node}
            selectedTreeItem={selectedTreeItem}
            onSelectFile={onSelectFile}
            onSelectFolder={onSelectFolder}
            onHighlightSelection={onHighlightSelection}
            onCreateFolder={onCreateFolder}
            onCreateMarkdown={onCreateMarkdown}
            onRename={onRename}
            onDelete={onDelete}
            onMove={onMove}
            onMoveRequest={onMoveRequest}
            expandedFolders={expandedFolders}
            onToggleFolder={toggleFolder}
            draggingPath={dragging?.path ?? ''}
            dragOverPath={dragOverPath}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOverFolder={handleDragOverFolder}
            onDropOnFolder={handleDropOnFolder}
            sortedChildren={sortedChildren}
            workspacePath={workspacePath}
            onRevealInExplorer={onRevealInExplorer}
            onCopyPath={onCopyPath}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </>
  );
}
