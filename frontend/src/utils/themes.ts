import type { AppThemeId, EditorThemeId } from '../types';

export interface ThemeDefinition {
  id: AppThemeId;
  name: string;
  shellMode: 'light' | 'dark';
  editorThemeId: EditorThemeId;
  description: string;
  variables: Record<string, string>;
}

export interface ExternalThemeDefinition {
  id: string;
  name: string;
  author?: string;
  version?: string;
  mode?: 'light' | 'dark' | 'both';
  previewColor?: string;
  filename?: string;
  css: string;
}

export const BUILT_IN_THEMES: ThemeDefinition[] = [
  {
    id: 'default-light',
    name: 'Porcelain Light',
    shellMode: 'light',
    editorThemeId: 'default-light',
    description: '瓷白纸张与磨砂侧栏的 macOS 风格浅色界面。',
    variables: {
      '--bg': '#eef2f7',
      '--bg-panel': 'rgba(246, 248, 251, 0.78)',
      '--bg-hover': 'rgba(27, 39, 55, 0.07)',
      '--bg-active': 'rgba(0, 113, 227, 0.14)',
      '--border': 'rgba(83, 96, 117, 0.22)',
      '--border-subtle': 'rgba(83, 96, 117, 0.13)',
      '--border-strong': 'rgba(68, 80, 99, 0.32)',
      '--text': '#1f2329',
      '--text-secondary': '#4c5564',
      '--text-muted': '#7c8797',
      '--accent': '#0a84ff',
      '--accent-hover': '#006edb',
      '--accent-soft': 'rgba(10, 132, 255, 0.13)',
      '--editor-bg': '#fbfcfe',
      '--editor-fg': '#24272d',
      '--content-width': '820px',
    },
  },
  {
    id: 'default-dark',
    name: 'Graphite Dark',
    shellMode: 'dark',
    editorThemeId: 'default-dark',
    description: '石墨色外壳与高对比写作区的深色工作室。',
    variables: {
      '--bg': '#17191d',
      '--bg-panel': 'rgba(35, 38, 44, 0.82)',
      '--bg-hover': 'rgba(255, 255, 255, 0.075)',
      '--bg-active': 'rgba(92, 170, 255, 0.18)',
      '--border': 'rgba(212, 220, 232, 0.14)',
      '--border-subtle': 'rgba(212, 220, 232, 0.09)',
      '--border-strong': 'rgba(212, 220, 232, 0.24)',
      '--text': '#eceff4',
      '--text-secondary': '#bac3d0',
      '--text-muted': '#858f9e',
      '--accent': '#67b7ff',
      '--accent-hover': '#8cc9ff',
      '--accent-soft': 'rgba(103, 183, 255, 0.16)',
      '--editor-bg': '#191c20',
      '--editor-fg': '#e8ecf2',
      '--content-width': '820px',
    },
  },
  {
    id: 'sepia',
    name: 'Sepia',
    shellMode: 'light',
    editorThemeId: 'sepia',
    description: '暖纸张色调，适合长文阅读。',
    variables: {
      '--bg': '#f5efe3',
      '--bg-panel': '#eee3d2',
      '--bg-hover': '#e5d8c3',
      '--bg-active': '#dbc9ad',
      '--border': '#d5c1a4',
      '--text': '#3f3529',
      '--text-secondary': '#6c5b48',
      '--accent': '#8a5a2b',
      '--accent-hover': '#70471e',
      '--accent-soft': 'rgba(138, 90, 43, 0.14)',
      '--editor-bg': '#fbf4e8',
      '--editor-fg': '#3f3529',
      '--code-bg': '#efe3cf',
      '--inline-code-bg': '#efe3cf',
      '--inline-code-fg': '#9a4f20',
    },
  },
  {
    id: 'github',
    name: 'GitHub',
    shellMode: 'light',
    editorThemeId: 'github',
    description: '接近 GitHub Markdown 的清晰排版。',
    variables: {
      '--bg': '#ffffff',
      '--bg-panel': '#f6f8fa',
      '--bg-hover': '#eef2f6',
      '--border': '#d0d7de',
      '--text': '#24292f',
      '--text-secondary': '#57606a',
      '--accent': '#0969da',
      '--accent-hover': '#0550ae',
      '--accent-soft': 'rgba(9, 105, 218, 0.12)',
      '--editor-bg': '#ffffff',
      '--editor-fg': '#24292f',
      '--editor-font': '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      '--content-width': '860px',
      '--quote-border': '#d0d7de',
      '--code-bg': '#f6f8fa',
      '--inline-code-bg': '#eff2f5',
      '--inline-code-fg': '#cf222e',
    },
  },
  {
    id: 'academic',
    name: 'Academic',
    shellMode: 'light',
    editorThemeId: 'academic',
    description: '论文与读书笔记取向的高可读排版。',
    variables: {
      '--bg': '#fbfbfa',
      '--bg-panel': '#f0f1ee',
      '--bg-hover': '#e5e8e3',
      '--border': '#d5d8d2',
      '--text': '#242826',
      '--text-secondary': '#565f58',
      '--accent': '#2f6f58',
      '--accent-hover': '#255843',
      '--accent-soft': 'rgba(47, 111, 88, 0.13)',
      '--editor-bg': '#fffefa',
      '--editor-fg': '#202421',
      '--editor-font': '"Source Serif Pro", "Iowan Old Style", "Noto Serif SC", "Songti SC", serif',
      '--content-width': '720px',
      '--quote-border': '#7d8b80',
      '--quote-bg': 'rgba(47, 111, 88, 0.06)',
      '--code-bg': '#eef1ed',
      '--inline-code-bg': '#eef1ed',
      '--inline-code-fg': '#255843',
    },
  },
];

export const DEFAULT_THEME_ID: AppThemeId = 'default-light';

export function getThemeDefinition(themeId?: string): ThemeDefinition {
  return BUILT_IN_THEMES.find((theme) => theme.id === themeId) ?? BUILT_IN_THEMES[0];
}

export function isThemeId(value: unknown): value is AppThemeId {
  return typeof value === 'string' && BUILT_IN_THEMES.some((theme) => theme.id === value);
}

export function applyThemeToRoot(root: HTMLElement, themeId: AppThemeId, editorThemeId: EditorThemeId = themeId) {
  const theme = getThemeDefinition(themeId);
  const editorTheme = getThemeDefinition(editorThemeId);

  root.dataset.theme = theme.shellMode;
  root.dataset.themeId = theme.id;
  root.dataset.editorTheme = editorTheme.id;

  [...BUILT_IN_THEMES, editorTheme].forEach((definition) => {
    Object.keys(definition.variables).forEach((key) => root.style.removeProperty(key));
  });

  Object.entries(theme.variables).forEach(([key, value]) => root.style.setProperty(key, value));
  Object.entries(editorTheme.variables)
    .filter(([key]) => key.startsWith('--editor') || key.startsWith('--content') || key.includes('code') || key.startsWith('--quote'))
    .forEach(([key, value]) => root.style.setProperty(key, value));
}

export function scopeCustomEditorCss(css: string, scope = '.typora-editor-host'): string {
  return css
    .split('}')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [selectorText, ...bodyParts] = block.split('{');
      const body = bodyParts.join('{').trim();
      if (!selectorText || !body) return '';
      const scopedSelectors = selectorText
        .split(',')
        .map((selector) => selector.trim())
        .filter(Boolean)
        .map((selector) => {
          if (selector.startsWith(scope)) return selector;
          if (selector.startsWith('@')) return selector;
          return `${scope} ${selector}`;
        });
      return scopedSelectors.length ? `${scopedSelectors.join(', ')} { ${body} }` : '';
    })
    .filter(Boolean)
    .join('\n');
}

export function parseThemeMetadata(css: string, fallbackName = 'Imported Theme'): Omit<ExternalThemeDefinition, 'id' | 'css'> {
  const commentMatch = css.match(/\/\*([\s\S]*?)\*\//);
  const metadata = new Map<string, string>();
  if (commentMatch) {
    commentMatch[1].split(/\r?\n/).forEach((line) => {
      const match = line.replace(/^\s*\*\s?/, '').match(/^@?([\w-]+)\s*:\s*(.+)$/);
      if (match) {
        metadata.set(match[1].toLowerCase(), match[2].trim());
      }
    });
  }

  const mode = metadata.get('mode')?.toLowerCase();
  return {
    name: metadata.get('name') || metadata.get('theme') || fallbackName,
    author: metadata.get('author'),
    version: metadata.get('version'),
    mode: mode === 'dark' || mode === 'light' || mode === 'both' ? mode : undefined,
    previewColor: metadata.get('preview-color') || metadata.get('preview'),
    filename: fallbackName,
  };
}
