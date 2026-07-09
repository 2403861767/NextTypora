import type { ShortcutBinding } from '../types';

export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  { id: 'open-file', label: '打开 Markdown 文件', category: 'file', defaultKeys: ['Ctrl+O', 'Meta+O'] },
  { id: 'open-folder', label: '打开文件夹', category: 'file', defaultKeys: ['Ctrl+Shift+O', 'Meta+Shift+O'] },
  { id: 'new-note', label: '新建笔记', category: 'file', defaultKeys: ['Ctrl+N', 'Meta+N'] },
  { id: 'save', label: '保存当前笔记', category: 'file', defaultKeys: ['Ctrl+S', 'Meta+S'] },
  { id: 'search-notes', label: '搜索笔记', category: 'edit', defaultKeys: ['Ctrl+Shift+F', 'Meta+Shift+F'] },
  { id: 'find-current-document', label: '当前文档查找', category: 'edit', defaultKeys: ['Ctrl+F', 'Meta+F'] },
  { id: 'replace-current-document', label: '当前文档替换', category: 'edit', defaultKeys: ['Ctrl+H', 'Meta+H'] },
  { id: 'open-quickly', label: '快速打开', category: 'file', defaultKeys: ['Ctrl+P', 'Meta+P'] },
  { id: 'close-tab', label: '关闭当前标签页', category: 'file', defaultKeys: ['Ctrl+W', 'Meta+W'] },
  { id: 'next-tab', label: '切换到下一个标签页', category: 'view', defaultKeys: ['Ctrl+Tab', 'Meta+Alt+ArrowRight'] },
  { id: 'bold', label: '加粗', category: 'format', scope: 'editor', defaultKeys: ['Ctrl+B', 'Meta+B'] },
  { id: 'italic', label: '斜体', category: 'format', scope: 'editor', defaultKeys: ['Ctrl+I', 'Meta+I'] },
  { id: 'underline', label: '下划线', category: 'format', scope: 'editor', defaultKeys: ['Ctrl+U', 'Meta+U'] },
  { id: 'insert-link', label: '插入链接', category: 'format', scope: 'editor', defaultKeys: ['Ctrl+K', 'Meta+K'] },
  { id: 'toggle-source', label: '切换源码模式', category: 'view', defaultKeys: ['Ctrl+/', 'Meta+/', 'Ctrl+`', 'Meta+`'] },
  { id: 'toggle-sidebar', label: '显示/隐藏侧边栏', category: 'view', defaultKeys: ['Ctrl+Shift+L', 'Meta+Shift+L'] },
  { id: 'open-outline-sidebar', label: '打开大纲侧栏', category: 'view', defaultKeys: ['Ctrl+Shift+1', 'Meta+Ctrl+1'] },
  { id: 'open-file-sidebar', label: '打开文件树侧栏', category: 'view', defaultKeys: ['Ctrl+Shift+3', 'Meta+Ctrl+3'] },
  { id: 'toggle-focus-mode', label: '专注模式', category: 'view', defaultKeys: ['Ctrl+Alt+F', 'Meta+Alt+F'] },
  { id: 'toggle-typewriter-mode', label: '打字机模式', category: 'view', defaultKeys: ['Ctrl+Shift+T', 'Meta+Shift+T'] },
  { id: 'toggle-distraction-free', label: '沉浸写作模式', category: 'view', defaultKeys: ['F11', 'Ctrl+Shift+D', 'Meta+Shift+D'] },
  { id: 'export-html', label: '导出 HTML', category: 'export', defaultKeys: ['Ctrl+Shift+E', 'Meta+Shift+E'] },
  { id: 'export-pdf', label: '导出 PDF', category: 'export', defaultKeys: ['Ctrl+Alt+P', 'Meta+Alt+P'] },
  { id: 'open-settings', label: '偏好设置', category: 'settings', defaultKeys: ['Ctrl+,', 'Meta+,'] },
];

export interface ShortcutConflict {
  key: string;
  actionIds: string[];
}

export interface ReservedShortcutUsage {
  key: string;
  actionId: string;
}

const MODIFIER_ALIASES: Record<string, 'Ctrl' | 'Meta' | 'Alt' | 'Shift'> = {
  control: 'Ctrl',
  ctrl: 'Ctrl',
  command: 'Meta',
  cmd: 'Meta',
  meta: 'Meta',
  option: 'Alt',
  alt: 'Alt',
  shift: 'Shift',
};

const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  space: 'Space',
  spacebar: 'Space',
  del: 'Delete',
  delete: 'Delete',
  return: 'Enter',
  enter: 'Enter',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  tab: 'Tab',
  backspace: 'Backspace',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
};

export const RESERVED_SYSTEM_SHORTCUTS = [
  'Ctrl+Alt+Delete',
  'Alt+F4',
  'Meta+Q',
].map(normalizeShortcut);

export function normalizeShortcut(shortcut: string): string {
  const parts = shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';

  const rawKey = parts.pop() ?? '';
  const modifiers = new Set<string>();

  parts.forEach((part) => {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) modifiers.add(modifier);
  });

  const ordered = [
    modifiers.has('Ctrl') ? 'Ctrl' : '',
    modifiers.has('Meta') ? 'Meta' : '',
    modifiers.has('Alt') ? 'Alt' : '',
    modifiers.has('Shift') ? 'Shift' : '',
  ].filter(Boolean);
  const key = normalizeKey(rawKey);
  if (!key || MODIFIER_ALIASES[key.toLowerCase()]) return '';

  return [...ordered, key].join('+');
}

export function shortcutFromKeyboardEvent(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key'>): string {
  const key = normalizeKey(event.key);
  if (!key || isModifierKey(key)) return '';

  return normalizeShortcut([
    event.ctrlKey ? 'Ctrl' : '',
    event.metaKey ? 'Meta' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    key,
  ].filter(Boolean).join('+'));
}

export function resolveShortcutBindings(overrides: Record<string, string[]> = {}): ShortcutBinding[] {
  return DEFAULT_SHORTCUTS.map((binding) => {
    const override = Array.isArray(overrides[binding.id])
      ? Array.from(new Set(overrides[binding.id].map(normalizeShortcut).filter(Boolean)))
      : undefined;
    return {
      ...binding,
      keys: override?.length ? override : binding.defaultKeys,
    };
  });
}

export function detectShortcutConflicts(bindings: ShortcutBinding[]): ShortcutConflict[] {
  const byKey = new Map<string, string[]>();

  bindings.forEach((binding) => {
    (binding.keys ?? binding.defaultKeys).forEach((key) => {
      const normalized = normalizeShortcut(key);
      byKey.set(normalized, [...(byKey.get(normalized) ?? []), binding.id]);
    });
  });

  return Array.from(byKey.entries())
    .map(([key, actionIds]) => ({ key, actionIds: Array.from(new Set(actionIds)) }))
    .filter((conflict) => conflict.actionIds.length > 1);
}

export function detectReservedShortcutBindings(bindings: ShortcutBinding[]): ReservedShortcutUsage[] {
  return bindings.flatMap((binding) => (
    (binding.keys ?? binding.defaultKeys)
      .map(normalizeShortcut)
      .filter((key) => key && isReservedShortcut(key))
      .map((key) => ({ key, actionId: binding.id }))
  ));
}

export function isReservedShortcut(shortcut: string): boolean {
  return RESERVED_SYSTEM_SHORTCUTS.includes(normalizeShortcut(shortcut));
}

export function isDefaultShortcut(actionId: string, keys: string[]): boolean {
  const binding = DEFAULT_SHORTCUTS.find((item) => item.id === actionId);
  if (!binding) return false;
  return shortcutListsEqual(binding.defaultKeys, keys);
}

export function isKeyboardShortcutCandidate(shortcut: string): boolean {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return false;

  const parts = normalized.split('+');
  const key = parts[parts.length - 1];
  const hasModifier = parts.length > 1;
  return hasModifier || /^F\d{1,2}$/i.test(key);
}

export function findShortcutAction(bindings: ShortcutBinding[], event: KeyboardEvent): string | undefined {
  if (event.defaultPrevented) return undefined;

  const pressed = shortcutFromKeyboardEvent(event);
  if (EDITOR_RESERVED_SHORTCUTS.has(pressed)) return undefined;

  const action = bindings.find((binding) => (
    binding.scope !== 'editor'
    && (binding.keys ?? binding.defaultKeys).some((key) => normalizeShortcut(key) === pressed)
  ))?.id;

  if (!action) return undefined;

  if (isSourceEditorTarget(event.target) && SOURCE_EDITOR_SEARCH_ACTIONS.has(action)) {
    return undefined;
  }

  if (isFormFieldTarget(event.target) && !FORM_FIELD_PASSTHROUGH_ACTIONS.has(action)) {
    return undefined;
  }

  return action;
}

function normalizeKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '';
  if (trimmed === ' ') return 'Space';

  const alias = KEY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;

  if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();
  return trimmed.length === 1 ? trimmed.toUpperCase() : trimmed;
}

function isModifierKey(key: string): boolean {
  return Boolean(MODIFIER_ALIASES[key.toLowerCase()]);
}

function shortcutListsEqual(left: string[], right: string[]): boolean {
  const leftNormalized = left.map(normalizeShortcut).filter(Boolean).sort();
  const rightNormalized = right.map(normalizeShortcut).filter(Boolean).sort();
  if (leftNormalized.length !== rightNormalized.length) return false;
  return leftNormalized.every((shortcut, index) => shortcut === rightNormalized[index]);
}

const EDITOR_RESERVED_SHORTCUTS = new Set([
  'Ctrl+B',
  'Meta+B',
  'Ctrl+I',
  'Meta+I',
  'Ctrl+U',
  'Meta+U',
  'Ctrl+K',
  'Meta+K',
].map(normalizeShortcut));

const SOURCE_EDITOR_SEARCH_ACTIONS = new Set([
  'find-current-document',
  'replace-current-document',
]);

const FORM_FIELD_PASSTHROUGH_ACTIONS = new Set([
  'save',
  'open-settings',
]);

function targetElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

function isSourceEditorTarget(target: EventTarget | null): boolean {
  return Boolean(targetElement(target)?.closest('.source-editor-shell'));
}

function isFormFieldTarget(target: EventTarget | null): boolean {
  const element = targetElement(target);
  if (!element) return false;
  return Boolean(element.closest('input, textarea, select, .cm-panel, .find-replace-panel, .settings-panel'));
}
