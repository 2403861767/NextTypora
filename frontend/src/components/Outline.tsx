import { useMemo, useState } from 'react';
import { CaretRightOutlined, CompressOutlined, ExpandOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Input, Select, Space } from 'antd';
import type { Heading } from '../utils/headings';
import { parseHeadings } from '../utils/headings';
import {
  buildOutlineTree,
  collectOutlineNodeKeys,
  collapseOutlineNodesByLevel,
  filterOutlineTree,
  outlineNodeKey,
  type OutlineTreeNode,
} from '../utils/outlineTree';

interface OutlineProps {
  content: string;
  activeHeadingKey?: string;
  onJump?: (line: number, heading: Heading) => void;
}

function OutlineTreeItem({
  node,
  collapsed,
  activeHeadingKey,
  onToggle,
  onJump,
}: {
  node: OutlineTreeNode;
  collapsed: Set<string>;
  activeHeadingKey?: string;
  onToggle: (key: string) => void;
  onJump?: (line: number, heading: Heading) => void;
}) {
  const key = outlineNodeKey(node.heading);
  const isCollapsed = collapsed.has(key);
  const hasChildren = node.children.length > 0;
  const { heading } = node;

  return (
    <div className="outline-branch">
      <div className="outline-row">
        {hasChildren ? (
          <button
            type="button"
            className="outline-toggle"
            aria-label={isCollapsed ? '展开' : '折叠'}
            aria-expanded={!isCollapsed}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(key);
            }}
          >
            <CaretRightOutlined className={`outline-caret ${isCollapsed ? '' : 'expanded'}`} />
          </button>
        ) : (
          <span className="outline-toggle-spacer" aria-hidden />
        )}
        <button
          type="button"
          className={`outline-item outline-h${heading.level} ${activeHeadingKey === heading.key ? 'active' : ''}`}
          style={{ paddingLeft: `${4 + (heading.level - 1) * 14}px` }}
          title={heading.text}
          onClick={() => onJump?.(heading.line, heading)}
        >
          {heading.text}
        </button>
      </div>
      {hasChildren && !isCollapsed && (
        <div className="outline-children">
          {node.children.map((child) => (
            <OutlineTreeItem
              key={outlineNodeKey(child.heading)}
              node={child}
              collapsed={collapsed}
              activeHeadingKey={activeHeadingKey}
              onToggle={onToggle}
              onJump={onJump}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Outline({ content, activeHeadingKey, onJump }: OutlineProps) {
  const headings = useMemo(() => parseHeadings(content), [content]);
  const tree = useMemo(() => buildOutlineTree(headings), [headings]);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const filteredTree = useMemo(() => filterOutlineTree(tree, query), [tree, query]);

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(collectOutlineNodeKeys(tree)));
  const collapseByLevel = (level: number) => setCollapsed(collapseOutlineNodesByLevel(tree, level));

  if (headings.length === 0) {
    return (
      <div className="outline-panel">
        <div className="outline-empty">
          <span>暂无标题</span>
          <p>使用 # 标题 语法后，大纲会自动出现在这里</p>
        </div>
      </div>
    );
  }

  return (
    <div className="outline-panel">
      <div className="outline-toolbar">
        <Input
          size="small"
          allowClear
          prefix={<SearchOutlined />}
          value={query}
          placeholder="搜索标题"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Space.Compact size="small" className="outline-actions">
          <Button icon={<ExpandOutlined />} onClick={expandAll} aria-label="全部展开" />
          <Button icon={<CompressOutlined />} onClick={collapseAll} aria-label="全部折叠" />
          <Select
            value={undefined}
            placeholder="层级"
            popupMatchSelectWidth={false}
            options={[
              { label: '折叠到 H2', value: 2 },
              { label: '折叠到 H3', value: 3 },
              { label: '折叠到 H4', value: 4 },
            ]}
            onChange={collapseByLevel}
          />
        </Space.Compact>
      </div>
      <nav className="outline-list" aria-label="文档大纲">
        {filteredTree.map((node) => (
          <OutlineTreeItem
            key={outlineNodeKey(node.heading)}
            node={node}
            collapsed={collapsed}
            activeHeadingKey={activeHeadingKey}
            onToggle={toggle}
            onJump={onJump}
          />
        ))}
        {filteredTree.length === 0 && <div className="outline-empty compact">没有匹配标题</div>}
      </nav>
    </div>
  );
}
