import type { ReactNode } from 'react';
import { Dropdown, type MenuProps } from 'antd';
import { AnimatePresence, motion } from 'motion/react';
import { panelRevealMotion } from '../utils/motionPresets';

export type SidebarTab = 'files' | 'file-list' | 'outline' | 'search';

interface SidebarPanelProps {
  open: boolean;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  filesContent: ReactNode;
  fileListContent?: ReactNode;
  outlineContent: ReactNode;
  searchContent?: ReactNode;
  workspacePath?: string;
  /** 在工作区根目录新建笔记 / 文件夹、刷新文件树：“…”按钮和文件树空白处的右键菜单共用 */
  onCreateMarkdown?: () => void;
  onCreateFolder?: () => void;
  onRefresh?: () => void;
}

export function SidebarPanel({
  open,
  tab,
  onTabChange,
  filesContent,
  fileListContent,
  outlineContent,
  searchContent,
  workspacePath,
  onCreateMarkdown,
  onCreateFolder,
  onRefresh,
}: SidebarPanelProps) {
  const bodyContent =
    tab === 'files' ? filesContent :
    tab === 'file-list' ? (fileListContent ?? filesContent) :
    tab === 'search' ? searchContent :
    outlineContent;

  const rootMenu: MenuProps = {
    items: [
      { key: 'create-markdown', label: '新建笔记', disabled: !onCreateMarkdown },
      { key: 'create-folder', label: '新建文件夹', disabled: !onCreateFolder },
      { type: 'divider' },
      { key: 'refresh', label: '刷新文件树', disabled: !onRefresh },
    ],
    onClick: ({ key }) => {
      if (key === 'create-markdown') onCreateMarkdown?.();
      if (key === 'create-folder') onCreateFolder?.();
      if (key === 'refresh') onRefresh?.();
    },
  };

  return (
    <aside className={`typora-sidebar sidebar-unified ${open ? 'open' : 'closed'}`}>
      <div className="sidebar-brand-row">
        <span className="sidebar-brand-title">Workspace</span>
        <Dropdown menu={rootMenu} trigger={['click']} placement="bottomRight">
          <button type="button" className="sidebar-more-btn" title="侧边栏选项" aria-label="侧边栏选项">...</button>
        </Dropdown>
      </div>
      <div className="sidebar-tabs" role="tablist" aria-label="侧边栏">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'files'}
          className={`sidebar-tab ${tab === 'files' ? 'active' : ''}`}
          onClick={() => onTabChange('files')}
        >
          Files
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'file-list'}
          className={`sidebar-tab ${tab === 'file-list' ? 'active' : ''}`}
          onClick={() => onTabChange('file-list')}
        >
          List
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'outline'}
          className={`sidebar-tab ${tab === 'outline' ? 'active' : ''}`}
          onClick={() => onTabChange('outline')}
        >
          Outline
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'search'}
          className={`sidebar-tab ${tab === 'search' ? 'active' : ''}`}
          onClick={() => onTabChange('search')}
        >
          Search
        </button>
      </div>

      {/* 文件树空白处的右键菜单挂在整个面板上：只有它能铺满侧栏，树的节点自己的右键菜单不会冒泡到这里 */}
      <Dropdown menu={rootMenu} trigger={tab === 'files' ? ['contextMenu'] : []}>
        <div className="sidebar-body" role="tabpanel">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} className="sidebar-body-motion" {...panelRevealMotion}>
              {bodyContent}
            </motion.div>
          </AnimatePresence>
        </div>
      </Dropdown>

      {workspacePath && (tab === 'files' || tab === 'file-list') && (
        <div className="sidebar-footer" title={workspacePath}>
          <span className="sidebar-footer-label">本地文件夹</span>
          {workspacePath}
        </div>
      )}
    </aside>
  );
}
