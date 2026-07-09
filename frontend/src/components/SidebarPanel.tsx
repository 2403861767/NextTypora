import type { ReactNode } from 'react';
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
}: SidebarPanelProps) {
  const bodyContent =
    tab === 'files' ? filesContent :
    tab === 'file-list' ? (fileListContent ?? filesContent) :
    tab === 'search' ? searchContent :
    outlineContent;

  return (
    <aside className={`typora-sidebar sidebar-unified ${open ? 'open' : 'closed'}`}>
      <div className="sidebar-brand-row">
        <span className="sidebar-brand-title">Workspace</span>
        <button type="button" className="sidebar-more-btn" title="侧边栏选项" aria-label="侧边栏选项">...</button>
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

      <div className="sidebar-body" role="tabpanel">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} className="sidebar-body-motion" {...panelRevealMotion}>
            {bodyContent}
          </motion.div>
        </AnimatePresence>
      </div>

      {workspacePath && (tab === 'files' || tab === 'file-list') && (
        <div className="sidebar-footer" title={workspacePath}>
          <span className="sidebar-footer-label">本地文件夹</span>
          {workspacePath}
        </div>
      )}
    </aside>
  );
}
