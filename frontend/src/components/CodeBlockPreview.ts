import katex from 'katex';

type ApplyPreview = (value: null | string | HTMLElement) => void;

type CodeBlockPreviewKind = 'latex' | 'mermaid';

interface PreviewKindConfig {
  id: CodeBlockPreviewKind;
  label: string;
}

const PREVIEW_KINDS: Record<CodeBlockPreviewKind, PreviewKindConfig> = {
  latex: {
    id: 'latex',
    label: 'LaTeX 预览',
  },
  mermaid: {
    id: 'mermaid',
    label: 'Mermaid 预览',
  },
};

const LATEX_LANGUAGES = new Set(['latex', 'tex', 'katex', 'math']);
const MERMAID_LANGUAGES = new Set(['mermaid']);

let previewId = 0;

export function getCodeBlockPreviewKind(language: string): PreviewKindConfig | null {
  const normalized = normalizeLanguage(language);

  if (LATEX_LANGUAGES.has(normalized)) {
    return PREVIEW_KINDS.latex;
  }

  if (MERMAID_LANGUAGES.has(normalized)) {
    return PREVIEW_KINDS.mermaid;
  }

  return null;
}

export function renderCodeBlockPreview(
  language: string,
  content: string,
  isDark: boolean,
  applyPreview: ApplyPreview,
) {
  const kind = getCodeBlockPreviewKind(language);
  const code = content.trim();

  if (!kind || !code) {
    return null;
  }

  if (kind.id === 'latex') {
    return renderLatexPreview(code);
  }

  renderMermaidPreview(code, isDark, ++previewId, applyPreview);
  return previewShell(
    kind.id,
    '<div class="mermaid-preview-loading">正在渲染 Mermaid...</div>',
  );
}

function renderLatexPreview(code: string) {
  const html = katex.renderToString(code, {
    displayMode: true,
    throwOnError: false,
  });

  return previewShell('latex', `<div class="latex-preview-body">${html}</div>`);
}

function renderMermaidPreview(
  code: string,
  isDark: boolean,
  id: number,
  applyPreview: ApplyPreview,
) {
  const renderId = `nexttyproa-mermaid-${id}`;

  void import('mermaid')
    .then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: isDark ? 'dark' : 'default',
      });
      const result = await mermaid.render(renderId, code);
      applyPreview(previewShell('mermaid', `<div class="mermaid-preview-body">${result.svg}</div>`));
    })
    .catch((error) => {
      applyPreview(
        previewShell(
          'mermaid',
          `
            <div class="mermaid-preview-error">
              <span>${escapeHtml(formatMermaidError(error))}</span>
              <pre>${escapeHtml(code)}</pre>
            </div>
          `,
        ),
      );
    });
}

function previewShell(kind: CodeBlockPreviewKind, body: string) {
  const label = PREVIEW_KINDS[kind].label;
  return `
    <div class="code-preview code-preview--${kind}">
      <div class="code-preview-label">${label}</div>
      <div class="code-preview-surface">${body}</div>
    </div>
  `;
}

function normalizeLanguage(language: string) {
  return language.trim().toLowerCase().replace(/^language-/, '');
}

function formatMermaidError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Mermaid 语法解析失败';
  if (message.includes('No diagram type detected')) {
    return '未检测到图表类型：第一行需要写 flowchart TD、graph TD、sequenceDiagram 等 Mermaid 图表声明。';
  }
  if (message.toLowerCase().includes('syntax')) {
    return `Mermaid 语法错误：${message}`;
  }
  return message;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
