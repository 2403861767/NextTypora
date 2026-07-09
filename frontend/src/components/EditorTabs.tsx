import { CloseOutlined, CopyOutlined, MoreOutlined } from '@ant-design/icons';
import { Dropdown, Tooltip, type MenuProps } from 'antd';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import type { EditorTab } from '../types';
import { motionTransitions, tabLayoutTransition } from '../utils/motionPresets';

interface EditorTabsProps {
  tabs: EditorTab[];
  activePath?: string;
  currentContent: string;
  currentLoadedContent: string;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onCloseOthers: (path: string) => void;
  onCloseRight: (path: string) => void;
  onCopyPath: (path: string) => void;
}

function fileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

export function EditorTabs({
  tabs,
  activePath,
  currentContent,
  currentLoadedContent,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseRight,
  onCopyPath,
}: EditorTabsProps) {
  const reduceMotion = useReducedMotion();

  if (tabs.length === 0) return null;

  const activeDirty = Boolean(activePath && currentContent !== currentLoadedContent);

  return (
    <div className="editor-tabs" role="tablist" aria-label="打开的文档">
      <LayoutGroup id="editor-tabs">
      <div className="editor-tabs-scroll">
        <AnimatePresence initial={false}>
        {tabs.map((tab, index) => {
          const active = tab.path === activePath;
          const dirty = active ? activeDirty : tab.content !== tab.loadedContent;
          const missing = tab.missing === true;
          const title = tab.title || fileName(tab.path);
          const menu: MenuProps = {
            items: [
              { key: 'close', label: '关闭' },
              { key: 'close-others', label: '关闭其他' },
              { key: 'close-right', label: '关闭右侧', disabled: index === tabs.length - 1 },
              { type: 'divider' },
              { key: 'copy-path', label: '复制路径', icon: <CopyOutlined /> },
            ],
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation();
              if (key === 'close') onClose(tab.path);
              if (key === 'close-others') onCloseOthers(tab.path);
              if (key === 'close-right') onCloseRight(tab.path);
              if (key === 'copy-path') onCopyPath(tab.path);
            },
          };

          return (
            <Dropdown key={tab.id || tab.path} menu={menu} trigger={['contextMenu']}>
              <motion.div
                layout
                initial={reduceMotion ? false : { opacity: 0, y: 3, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -2, scale: 0.985 }}
                transition={reduceMotion ? motionTransitions.fast : tabLayoutTransition}
                role="tab"
                tabIndex={0}
                aria-selected={active}
                aria-invalid={missing || undefined}
                className={`editor-tab ${active ? 'active' : ''} ${dirty ? 'dirty' : ''} ${missing ? 'missing' : ''}`}
                title={missing ? `${tab.path}（文件缺失或无法打开）` : tab.path}
                onClick={() => onSelect(tab.path)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onSelect(tab.path);
                }}
              >
                <span className="editor-tab-active-dot" aria-hidden="true" />
                <span className="editor-tab-dirty" aria-hidden="true" />
                <span className="editor-tab-title">{title}</span>
                {missing && (
                  <Tooltip title="文件缺失或无法打开">
                    <span className="editor-tab-missing" aria-label="文件缺失">!</span>
                  </Tooltip>
                )}
                <button
                  type="button"
                  className="editor-tab-close"
                  title="关闭标签页"
                  aria-label={`关闭 ${title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.path);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                    onClose(tab.path);
                  }}
                >
                  <CloseOutlined />
                </button>
              </motion.div>
            </Dropdown>
          );
        })}
        </AnimatePresence>
      </div>
      </LayoutGroup>
      <Dropdown
        menu={{
          items: [
            { key: 'copy-active', label: '复制当前路径', disabled: !activePath },
          ],
          onClick: ({ key }) => {
            if (key === 'copy-active' && activePath) onCopyPath(activePath);
          },
        }}
      >
        <button type="button" className="editor-tabs-more" title="标签页菜单" aria-label="标签页菜单">
          <MoreOutlined />
        </button>
      </Dropdown>
    </div>
  );
}
