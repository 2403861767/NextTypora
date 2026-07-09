import {
  CopyOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Button, Dropdown, Empty, Typography, type MenuProps } from 'antd';
import { motion, useReducedMotion } from 'motion/react';
import type { TreeNode, TreeSelection } from '../types';
import { listItemEnterMotion } from '../utils/motionPresets';

const { Text } = Typography;

interface FileListProps {
  nodes: TreeNode[];
  selectedPath?: string;
  selectedTreeItem?: TreeSelection | null;
  currentFolderPath?: string;
  workspacePath?: string;
  onSelectFile: (path: string) => void;
  onCreateMarkdown?: (parentPath: string) => void;
  onRefresh?: () => void | Promise<void>;
  onRevealInExplorer?: (absolutePath: string) => void | Promise<void>;
  onCopyPath?: (path: string, kind: 'relative' | 'absolute') => void | Promise<void>;
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function parentPathOf(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : '';
}

function joinWorkspacePath(workspacePath: string, relativePath: string): string {
  const sep = workspacePath.includes('\\') ? '\\' : '/';
  const base = workspacePath.replace(/[/\\]+$/, '');
  const rel = relativePath.replace(/^[/\\]+/, '').replace(/\//g, sep);
  return `${base}${sep}${rel}`;
}

function findFolderChildren(nodes: TreeNode[], folderPath: string): TreeNode[] {
  const normalizedFolder = normalizePath(folderPath);
  if (!normalizedFolder) return nodes;

  for (const node of nodes) {
    if (node.directory && normalizePath(node.path) === normalizedFolder) {
      return node.children;
    }
    if (node.directory) {
      const found = findFolderChildren(node.children, normalizedFolder);
      if (found.length > 0 || node.children.some((child) => normalizePath(child.path) === normalizedFolder)) {
        return found;
      }
    }
  }
  return [];
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

export function FileList({
  nodes,
  selectedPath = '',
  selectedTreeItem,
  currentFolderPath,
  workspacePath = '',
  onSelectFile,
  onCreateMarkdown,
  onRefresh,
  onRevealInExplorer,
  onCopyPath,
}: FileListProps) {
  const reduceMotion = useReducedMotion();
  const activeFolder = normalizePath(
    currentFolderPath
      ?? (selectedTreeItem?.isDirectory ? selectedTreeItem.path : parentPathOf(selectedPath))
      ?? '',
  );
  const files = findFolderChildren(nodes, activeFolder)
    .filter((node) => !node.directory && isMarkdownPath(node.path))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const runCopyPath = async (path: string, kind: 'relative' | 'absolute') => {
    const target = kind === 'absolute' && workspacePath ? joinWorkspacePath(workspacePath, path) : path;
    await (onCopyPath?.(target, kind) ?? copyText(target));
  };

  const runReveal = async (path: string) => {
    if (!workspacePath) return;
    const absolutePath = joinWorkspacePath(workspacePath, path);
    await (onRevealInExplorer?.(absolutePath) ?? window.nextTyproa?.revealInExplorer?.(absolutePath));
  };

  const menuFor = (path: string): MenuProps => ({
    items: [
      { key: 'reveal', icon: <FolderOpenOutlined />, label: '在资源管理器中显示', disabled: !workspacePath },
      { key: 'copy-relative', icon: <CopyOutlined />, label: '复制相对路径' },
      { key: 'copy-absolute', icon: <CopyOutlined />, label: '复制绝对路径', disabled: !workspacePath },
      { type: 'divider' },
      { key: 'refresh', icon: <ReloadOutlined />, label: '刷新文件列表', disabled: !onRefresh },
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === 'reveal') void runReveal(path);
      if (key === 'copy-relative') void runCopyPath(path, 'relative');
      if (key === 'copy-absolute') void runCopyPath(path, 'absolute');
      if (key === 'refresh') void onRefresh?.();
    },
  });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 8px 6px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text
            title={activeFolder || '工作区根目录'}
            style={{
              display: 'block',
              color: 'var(--text)',
              fontSize: 12,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {activeFolder || '工作区根目录'}
          </Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {files.length} 个 Markdown 文件
          </Text>
        </div>
        <Button
          type="text"
          size="small"
          icon={<FileAddOutlined />}
          title="在当前目录新建 Markdown 文件"
          aria-label="在当前目录新建 Markdown 文件"
          disabled={!onCreateMarkdown}
          onClick={() => onCreateMarkdown?.(activeFolder)}
        />
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          title="刷新文件列表"
          aria-label="刷新文件列表"
          disabled={!onRefresh}
          onClick={() => { void onRefresh?.(); }}
        />
      </div>

      <div style={{ minHeight: 0, overflow: 'auto', padding: '4px 6px 12px' }}>
        {files.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="当前目录没有 Markdown 文件"
          />
        ) : (
          files.map((file, index) => (
            <Dropdown key={file.path} menu={menuFor(file.path)} trigger={['contextMenu']}>
              <motion.button
                {...listItemEnterMotion(index, reduceMotion ?? false)}
                type="button"
                title={file.path}
                onClick={() => onSelectFile(file.path)}
                style={{
                  width: '100%',
                  minHeight: 32,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  border: 'none',
                  borderRadius: 5,
                  padding: '5px 8px',
                  background: selectedPath === file.path ? 'var(--accent-soft)' : 'transparent',
                  color: selectedPath === file.path ? 'var(--accent)' : 'var(--text)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  font: 'inherit',
                }}
              >
                <FileTextOutlined style={{ flexShrink: 0, opacity: selectedPath === file.path ? 1 : 0.62 }} />
                <span
                  style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 13,
                  }}
                >
                  {file.name}
                </span>
              </motion.button>
            </Dropdown>
          ))
        )}
      </div>
    </div>
  );
}
