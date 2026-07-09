import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { ReloadOutlined, UndoOutlined } from '@ant-design/icons';
import { Alert, Button, Input, Radio, Select, Space, Switch, Typography, message } from 'antd';
import { AnimatePresence, motion } from 'motion/react';
import type { ExternalTheme, PreferenceSettings, ShortcutBinding } from '../types';
import { persistPreferenceSettings } from '../utils/appSettings';
import { fadeSoftMotion, sheetRevealMotion } from '../utils/motionPresets';
import { testPicGoConnection } from '../utils/picgo';
import { BUILT_IN_THEMES } from '../utils/themes';
import {
  detectReservedShortcutBindings,
  detectShortcutConflicts,
  isDefaultShortcut,
  isKeyboardShortcutCandidate,
  resolveShortcutBindings,
  shortcutFromKeyboardEvent,
} from '../utils/shortcuts';

const { Text, Paragraph } = Typography;

const SHORTCUT_CATEGORY_LABELS: Record<ShortcutBinding['category'], string> = {
  file: '文件',
  edit: '编辑',
  format: '格式',
  view: '视图',
  export: '导出',
  settings: '设置',
};

const SHORTCUT_CATEGORY_ORDER: ShortcutBinding['category'][] = ['file', 'edit', 'format', 'view', 'export', 'settings'];

interface SettingsModalProps {
  open: boolean;
  initial: PreferenceSettings;
  onClose: () => void;
  onSaved: (settings: PreferenceSettings) => void;
}

export function SettingsModal({ open, initial, onClose, onSaved }: SettingsModalProps) {
  const [draft, setDraft] = useState<PreferenceSettings>(initial);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [recordingShortcutId, setRecordingShortcutId] = useState<string | null>(null);
  const [externalThemes, setExternalThemes] = useState<ExternalTheme[]>([]);
  const [loadingThemes, setLoadingThemes] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(initial);
      setTestResult(null);
      setRecordingShortcutId(null);
      void reloadExternalThemes();
    }
  }, [open, initial]);

  const handleTestPicGo = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testPicGoConnection({
        serverUrl: draft.picgoServerUrl,
        secret: draft.picgoSecret,
      });
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await persistPreferenceSettings(draft);
      onSaved(saved);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const reloadExternalThemes = async () => {
    if (!window.nextTyproa?.listThemes) return;
    setLoadingThemes(true);
    try {
      setExternalThemes(await window.nextTyproa.listThemes());
    } finally {
      setLoadingThemes(false);
    }
  };

  const handleOpenThemeDirectory = async () => {
    if (!window.nextTyproa?.openThemeDirectory) return;
    await window.nextTyproa.openThemeDirectory();
  };

  const handleImportTheme = async () => {
    if (!window.nextTyproa?.importThemeCss) return;
    const theme = await window.nextTyproa.importThemeCss();
    if (!theme) return;
    setExternalThemes((prev) => [theme, ...prev.filter((item) => item.id !== theme.id)]);
    setDraft((prev) => ({ ...prev, customCss: theme.css }));
    message.success(`已导入并启用主题：${theme.name}`);
  };

  const shortcutBindings = resolveShortcutBindings(draft.shortcuts);
  const shortcutConflicts = detectShortcutConflicts(shortcutBindings);
  const reservedShortcutUsages = detectReservedShortcutBindings(shortcutBindings);
  const hasShortcutProblems = shortcutConflicts.length > 0 || reservedShortcutUsages.length > 0;
  const shortcutLabelsById = new Map(shortcutBindings.map((shortcut) => [shortcut.id, shortcut.label]));
  const shortcutGroups = SHORTCUT_CATEGORY_ORDER.map((category) => ({
    category,
    label: SHORTCUT_CATEGORY_LABELS[category],
    shortcuts: shortcutBindings.filter((shortcut) => shortcut.category === category),
  })).filter((group) => group.shortcuts.length > 0);
  const shortcutConflictDescription = shortcutConflicts
    .map((conflict) => {
      const labels = conflict.actionIds.map((id) => shortcutLabelsById.get(id) ?? id).join('、');
      return `${conflict.key}: ${labels}`;
    })
    .join('；');
  const reservedShortcutDescription = reservedShortcutUsages
    .map((usage) => `${usage.key}: ${shortcutLabelsById.get(usage.actionId) ?? usage.actionId}`)
    .join('；');
  const themeOptions = BUILT_IN_THEMES.map((theme) => ({
    label: theme.name,
    value: theme.id,
  }));

  const resetShortcut = (actionId: string) => {
    setRecordingShortcutId(null);
    setDraft((prev) => {
      const nextShortcuts = { ...prev.shortcuts };
      delete nextShortcuts[actionId];
      return { ...prev, shortcuts: nextShortcuts };
    });
  };

  const resetAllShortcuts = () => {
    setRecordingShortcutId(null);
    setDraft((prev) => ({ ...prev, shortcuts: {} }));
  };

  const recordShortcut = (event: ReactKeyboardEvent<HTMLElement>, actionId: string) => {
    if (recordingShortcutId !== actionId) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      setRecordingShortcutId(null);
      return;
    }

    const nextShortcut = shortcutFromKeyboardEvent(event.nativeEvent);
    if (!isKeyboardShortcutCandidate(nextShortcut)) return;

    setDraft((prev) => {
      const nextShortcuts = { ...prev.shortcuts };
      if (isDefaultShortcut(actionId, [nextShortcut])) {
        delete nextShortcuts[actionId];
      } else {
        nextShortcuts[actionId] = [nextShortcut];
      }
      return { ...prev, shortcuts: nextShortcuts };
    });
    setRecordingShortcutId(null);
  };

  return (
    <ModalFrame
      open={open}
      title="偏好设置"
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      saveDisabled={hasShortcutProblems}
    >
      <section className="settings-section">
        <Text className="settings-section-title">主题与外观</Text>
        <Paragraph type="secondary" className="settings-hint">
          应用外壳和编辑区主题可以独立切换，自定义 CSS 仅作用于编辑器区域。
        </Paragraph>
        <div className="settings-grid-row">
          <label className="settings-field-stack">
            <span className="settings-field-label">应用主题</span>
            <Select
              value={draft.themeId}
              options={themeOptions}
              onChange={(themeId) => setDraft((prev) => ({ ...prev, themeId }))}
            />
          </label>
          <label className="settings-field-stack">
            <span className="settings-field-label">编辑区主题</span>
            <Select
              value={draft.editorThemeId}
              options={themeOptions}
              onChange={(editorThemeId) => setDraft((prev) => ({ ...prev, editorThemeId }))}
            />
          </label>
        </div>
        <Text className="settings-field-label">编辑区自定义 CSS</Text>
        <Input.TextArea
          value={draft.customCss}
          placeholder=".ProseMirror p { line-height: 1.8; }"
          autoSize={{ minRows: 3, maxRows: 6 }}
          onChange={(e) => setDraft((prev) => ({ ...prev, customCss: e.target.value }))}
        />
        <div className="settings-theme-actions">
          <Button size="small" onClick={handleOpenThemeDirectory} disabled={!window.nextTyproa?.openThemeDirectory}>
            打开主题目录
          </Button>
          <Button size="small" onClick={handleImportTheme} disabled={!window.nextTyproa?.importThemeCss}>
            导入 CSS 主题
          </Button>
          <Button size="small" loading={loadingThemes} onClick={reloadExternalThemes} disabled={!window.nextTyproa?.listThemes}>
            重新加载主题
          </Button>
        </div>
        {externalThemes.length > 0 && (
          <div className="settings-theme-list">
            {externalThemes.map((theme) => (
              <div className="settings-theme-row" key={theme.id}>
                <span
                  className="settings-theme-swatch"
                  style={{ background: theme.previewColor || 'var(--accent)' }}
                  aria-hidden
                />
                <span className="settings-theme-meta">
                  <span className="settings-theme-name">{theme.name}</span>
                  <Text type="secondary" className="settings-theme-desc">
                    {[theme.author, theme.version, theme.mode].filter(Boolean).join(' · ') || theme.filename}
                  </Text>
                </span>
                <Button size="small" onClick={() => setDraft((prev) => ({ ...prev, customCss: theme.css }))}>
                  启用
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="settings-section">
        <Text className="settings-section-title">编辑器</Text>
        <Paragraph type="secondary" className="settings-hint">
          默认关闭拼写检查，避免英文术语和代码片段出现红色波浪线。
        </Paragraph>
        <div className="settings-switch-row">
          <span>
            <span className="settings-radio-label">拼写检查</span>
            <Text type="secondary" className="settings-radio-desc">
              开启后浏览器会检查普通正文拼写。
            </Text>
          </span>
          <Switch
            checked={draft.spellCheckEnabled}
            onChange={(checked) => setDraft((prev) => ({ ...prev, spellCheckEnabled: checked }))}
          />
        </div>
      </section>

      <section className="settings-section">
        <Text className="settings-section-title">图片上传</Text>
        <Paragraph type="secondary" className="settings-hint">
          插入或粘贴图片时使用的方式（与 Typora 一致）。
        </Paragraph>
        <Radio.Group
          value={draft.mode}
          onChange={(e) => {
            setDraft((prev) => ({ ...prev, mode: e.target.value }));
            setTestResult(null);
          }}
          className="settings-radio-group"
        >
          <Space direction="vertical" size={12}>
            <Radio value="local">
              <span className="settings-radio-label">本地保存</span>
              <Text type="secondary" className="settings-radio-desc">
                保存到笔记旁的 <Text code>{'{笔记名}'}.assets/</Text> 目录，Typora 可直接打开
              </Text>
            </Radio>
            <Radio value="picgo">
              <span className="settings-radio-label">PicGo 图床</span>
              <Text type="secondary" className="settings-radio-desc">
                通过 PicGo Server 上传，Markdown 写入图床 URL
              </Text>
            </Radio>
          </Space>
        </Radio.Group>
      </section>

      {draft.mode === 'picgo' && (
        <section className="settings-section settings-picgo">
          <Text className="settings-field-label">PicGo Server 地址</Text>
          <Input
            value={draft.picgoServerUrl}
            placeholder="http://127.0.0.1:36677"
            onChange={(e) => {
              setDraft((prev) => ({ ...prev, picgoServerUrl: e.target.value }));
              setTestResult(null);
            }}
          />
          <Text className="settings-field-label">Server 密钥（可选）</Text>
          <Input.Password
            value={draft.picgoSecret}
            placeholder="PicGo 设置中启用 Server 密钥时填写"
            onChange={(e) => {
              setDraft((prev) => ({ ...prev, picgoSecret: e.target.value }));
              setTestResult(null);
            }}
          />
          <div className="settings-picgo-actions">
            <Button loading={testing} onClick={handleTestPicGo}>
              测试 PicGo 连接
            </Button>
            {testResult && (
              <Text type={testResult.ok ? 'success' : 'danger'}>{testResult.message}</Text>
            )}
          </div>
          <Paragraph type="secondary" className="settings-hint settings-picgo-tip">
            请先在 PicGo 中开启「PicGo-Server」（默认端口 36677），并配置好图床。
          </Paragraph>
        </section>
      )}

      <section className="settings-section">
        <div className="settings-section-heading-row">
          <Text className="settings-section-title">快捷键</Text>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            disabled={Object.keys(draft.shortcuts).length === 0}
            onClick={resetAllShortcuts}
          >
            全部重置
          </Button>
        </div>
        <Paragraph type="secondary" className="settings-hint">
          点击快捷键后直接按下新的组合键；按 Esc 可取消录制。
        </Paragraph>
        {shortcutConflicts.length > 0 && (
          <Alert
            type="warning"
            showIcon
            className="settings-shortcut-alert"
            message={`检测到 ${shortcutConflicts.length} 个快捷键冲突，请调整后再保存。`}
            description={shortcutConflictDescription}
          />
        )}
        {reservedShortcutUsages.length > 0 && (
          <Alert
            type="error"
            showIcon
            className="settings-shortcut-alert"
            message="包含系统保留快捷键，请更换后再保存。"
            description={reservedShortcutDescription}
          />
        )}
        <div className="settings-shortcut-groups">
          {shortcutGroups.map((group) => (
            <div className="settings-shortcut-group" key={group.category}>
              <Text className="settings-shortcut-group-title">{group.label}</Text>
              <div className="settings-shortcut-list">
                {group.shortcuts.map((shortcut) => (
                  <div className="settings-shortcut-row" key={shortcut.id}>
                    <span className="settings-shortcut-label">
                      {shortcut.label}
                      {shortcut.scope === 'editor' && <Text type="secondary" className="settings-shortcut-scope">编辑器作用域</Text>}
                      {draft.shortcuts[shortcut.id]?.length > 0 && <Text type="secondary" className="settings-shortcut-scope">已自定义</Text>}
                    </span>
                    <span className="settings-shortcut-actions">
                      <button
                        type="button"
                        className={`settings-shortcut-recorder ${recordingShortcutId === shortcut.id ? 'recording' : ''} ${reservedShortcutUsages.some((usage) => usage.actionId === shortcut.id) ? 'invalid' : ''}`}
                        aria-label={`录制${shortcut.label}快捷键`}
                        aria-pressed={recordingShortcutId === shortcut.id}
                        onClick={(event) => {
                          setRecordingShortcutId(shortcut.id);
                          event.currentTarget.focus();
                        }}
                        onKeyDown={(event) => recordShortcut(event, shortcut.id)}
                        onBlur={() => {
                          setRecordingShortcutId((current) => (current === shortcut.id ? null : current));
                        }}
                      >
                        {recordingShortcutId === shortcut.id ? (
                          <span className="settings-shortcut-recording-text">按下快捷键</span>
                        ) : (
                          <span className="settings-shortcut-keys">
                            {(shortcut.keys ?? shortcut.defaultKeys).map((key) => <kbd key={key}>{key}</kbd>)}
                          </span>
                        )}
                      </button>
                      <Button
                        type="text"
                        size="small"
                        icon={<UndoOutlined />}
                        disabled={!draft.shortcuts[shortcut.id]?.length}
                        onClick={() => resetShortcut(shortcut.id)}
                        aria-label={`重置${shortcut.label}快捷键`}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </ModalFrame>
  );
}

function ModalFrame({
  open,
  title,
  onClose,
  onSave,
  saving,
  saveDisabled,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  saveDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
    <motion.div className="settings-overlay" onClick={onClose} role="presentation" {...fadeSoftMotion}>
      <motion.div
        className="settings-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        {...sheetRevealMotion}
      >
        <header className="settings-header">
          <h2>{title}</h2>
          <button type="button" className="settings-close" onClick={onClose} aria-label="关闭">×</button>
        </header>
        <div className="settings-body">{children}</div>
        <footer className="settings-footer">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} disabled={saveDisabled} onClick={onSave}>保存</Button>
        </footer>
      </motion.div>
    </motion.div>
      )}
    </AnimatePresence>
  );
}
