import { LeftOutlined, RightOutlined } from '@ant-design/icons';

interface StatusBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  documentTitle: string;
  wordCount: number;
}

export function StatusBar({
  sidebarOpen,
  onToggleSidebar,
  documentTitle,
  wordCount,
}: StatusBarProps) {
  return (
    <footer className="typora-statusbar">
      <div className="statusbar-left">
        <button
          type="button"
          className="statusbar-icon-btn"
          title={sidebarOpen ? '隐藏侧边栏' : '显示侧边栏'}
          aria-label={sidebarOpen ? '隐藏侧边栏' : '显示侧边栏'}
          aria-pressed={sidebarOpen}
          onClick={onToggleSidebar}
        >
          {sidebarOpen ? <LeftOutlined /> : <RightOutlined />}
        </button>
        {documentTitle && (
          <span className="statusbar-doc-chip" title={documentTitle}>
            {documentTitle}
          </span>
        )}
        <span className="statusbar-mode-chip">Markdown</span>
        <span className="statusbar-code-chip" aria-hidden="true">{'<>'}</span>
      </div>
      <div className="statusbar-right">
        <span className="statusbar-word-count">{wordCount} 词</span>
        <span className="statusbar-zoom">100%</span>
      </div>
    </footer>
  );
}
