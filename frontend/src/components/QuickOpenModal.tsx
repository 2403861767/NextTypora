import { FileTextOutlined, SearchOutlined } from '@ant-design/icons';
import { Empty, Input, List, Modal, Typography } from 'antd';
import type { InputRef } from 'antd/es/input';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { TreeNode } from '../types';
import { fadeSoftMotion, listItemEnterMotion } from '../utils/motionPresets';

const { Text } = Typography;

interface QuickOpenFile {
  name: string;
  path: string;
  parentPath: string;
}

interface QuickOpenModalProps {
  open: boolean;
  nodes: TreeNode[];
  selectedPath?: string;
  workspacePath?: string;
  onOpen: (path: string) => void | Promise<void>;
  onClose: () => void;
  maxResults?: number;
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function parentPathOf(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : '';
}

function collectMarkdownFiles(nodes: TreeNode[], result: QuickOpenFile[] = []): QuickOpenFile[] {
  nodes.forEach((node) => {
    if (node.directory) {
      collectMarkdownFiles(node.children, result);
      return;
    }

    if (!isMarkdownPath(node.path)) return;
    result.push({
      name: node.name,
      path: normalizePath(node.path),
      parentPath: parentPathOf(node.path),
    });
  });
  return result;
}

function scoreFile(file: QuickOpenFile, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 1;

  const name = file.name.toLowerCase();
  const path = file.path.toLowerCase();
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.some((token) => !path.includes(token) && !name.includes(token))) {
    return -1;
  }

  let score = 0;
  tokens.forEach((token) => {
    if (name === token) score += 80;
    else if (name.startsWith(token)) score += 45;
    else if (name.includes(token)) score += 25;
    else if (path.includes(token)) score += 12;
  });

  if (path.includes(normalizedQuery)) score += 20;
  return score;
}

export function QuickOpenModal({
  open,
  nodes,
  selectedPath,
  workspacePath,
  onOpen,
  onClose,
  maxResults = 80,
}: QuickOpenModalProps) {
  const inputRef = useRef<InputRef>(null);
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const files = useMemo(() => collectMarkdownFiles(nodes), [nodes]);
  const results = useMemo(() => {
    const scored = files
      .map((file) => ({ file, score: scoreFile(file, query) }))
      .filter(({ score }) => score >= 0)
      .sort((a, b) => {
        if (a.file.path === selectedPath) return -1;
        if (b.file.path === selectedPath) return 1;
        if (b.score !== a.score) return b.score - a.score;
        return a.file.path.localeCompare(b.file.path, undefined, { sensitivity: 'base' });
      });
    return scored.slice(0, maxResults).map(({ file }) => file);
  }, [files, maxResults, query, selectedPath]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const openFile = async (path: string) => {
    await onOpen(path);
    onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault();
      void openFile(results[activeIndex].path);
    }
  };

  return (
    <Modal
      title="快速打开"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={620}
      centered
    >
      <Input
        ref={inputRef}
        prefix={<SearchOutlined />}
        placeholder="输入文件名或路径"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        allowClear
      />

      <div style={{ marginTop: 10, maxHeight: 420, overflow: 'auto' }}>
        <AnimatePresence mode="wait" initial={false}>
        {results.length === 0 ? (
          <motion.div key="quick-open-empty" {...fadeSoftMotion}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={files.length === 0 ? '当前工作区没有 Markdown 文件' : '没有匹配文件'}
          />
          </motion.div>
        ) : (
          <motion.div key="quick-open-results" {...fadeSoftMotion}>
          <List
            size="small"
            dataSource={results}
            renderItem={(file, index) => (
              <List.Item style={{ padding: 0 }}>
                <motion.button
                  {...listItemEnterMotion(index, reduceMotion ?? false)}
                  type="button"
                  title={workspacePath ? `${workspacePath}\\${file.path}` : file.path}
                  onClick={() => { void openFile(file.path); }}
                  style={{
                    width: '100%',
                    minHeight: 42,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    border: 'none',
                    borderRadius: 5,
                    padding: '7px 10px',
                    background: index === activeIndex ? 'var(--accent-soft)' : 'transparent',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    font: 'inherit',
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <FileTextOutlined style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 13,
                      }}
                    >
                      {file.name}
                    </span>
                    <Text
                      type="secondary"
                      style={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 11,
                      }}
                    >
                      {file.parentPath || '工作区根目录'}
                    </Text>
                  </span>
                </motion.button>
              </List.Item>
            )}
          />
          </motion.div>
        )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}
