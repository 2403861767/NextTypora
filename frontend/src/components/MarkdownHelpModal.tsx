import { useEffect, useRef, type ReactNode } from 'react';
import { CloseOutlined } from '@ant-design/icons';

interface MarkdownHelpModalProps {
  open: boolean;
  onClose: () => void;
}

interface HelpTopic {
  title: string;
  description: string;
  example: string;
  preview: ReactNode;
}

const HELP_TOPICS: HelpTopic[] = [
  {
    title: '标题、段落与分割线',
    description: '使用 # 到 ###### 创建标题；空行分隔段落；行尾两个空格可强制换行；--- 创建分割线。',
    example: '# 一级标题\n\n正文第一段。\n行尾两个空格  \n这里会换行。\n\n---',
    preview: (
      <div className="help-preview-article">
        <h1>一级标题</h1>
        <p>正文第一段。<br />这里会换行。</p>
        <hr />
      </div>
    ),
  },
  {
    title: '强调、删除线与行内代码',
    description: '常用强调语法会在 WYSIWYG 和源码模式之间保持为标准 Markdown。',
    example: '**加粗**\n*斜体*\n~~删除线~~\n`inline code`',
    preview: (
      <div className="help-preview-article">
        <p><strong>加粗</strong></p>
        <p><em>斜体</em></p>
        <p><del>删除线</del></p>
        <p><code>inline code</code></p>
      </div>
    ),
  },
  {
    title: '引用与列表',
    description: '列表支持无序、有序、嵌套和任务清单，适合整理写作提纲和待办。',
    example: '> 这是一段引用\n\n- 无序列表\n  - 嵌套列表\n1. 有序列表\n2. 第二项\n- [ ] 未完成任务\n- [x] 已完成任务',
    preview: (
      <div className="help-preview-article">
        <blockquote>这是一段引用</blockquote>
        <ul>
          <li>无序列表
            <ul><li>嵌套列表</li></ul>
          </li>
        </ul>
        <ol>
          <li>有序列表</li>
          <li>第二项</li>
        </ol>
        <ul className="help-task-list">
          <li><input type="checkbox" readOnly /> 未完成任务</li>
          <li><input type="checkbox" checked readOnly /> 已完成任务</li>
        </ul>
      </div>
    ),
  },
  {
    title: '链接与图片',
    description: '图片可使用本地路径或远程地址；本地保存模式会把粘贴图片写入 {笔记名}.assets/ 目录。',
    example: '[NextTyproa](https://example.com)\n\n![图片说明](note.assets/image.png)',
    preview: (
      <div className="help-preview-article">
        <p><a href="https://example.com" onClick={(event) => event.preventDefault()}>NextTyproa</a></p>
        <figure className="help-preview-image">
          <span>图片</span>
          <figcaption>图片说明</figcaption>
        </figure>
      </div>
    ),
  },
  {
    title: '代码块与语言标记',
    description: '三反引号创建代码块；在第一行写语言名可以获得更清晰的代码展示。',
    example: '```ts\nconst message = "Hello Markdown";\nconsole.log(message);\n```',
    preview: (
      <div className="help-preview-article">
        <div className="help-code-preview-label">TypeScript</div>
        <pre><code>const message = "Hello Markdown";{'\n'}console.log(message);</code></pre>
      </div>
    ),
  },
  {
    title: '表格',
    description: '使用管道符和分隔线创建表格，适合写参数、对比和清单。',
    example: '| 名称 | 说明 |\n| --- | --- |\n| 标题 | 使用 # |\n| 表格 | 使用管道符分隔 |',
    preview: (
      <div className="help-preview-article">
        <table>
          <thead><tr><th>名称</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td>标题</td><td>使用 #</td></tr>
            <tr><td>表格</td><td>使用管道符分隔</td></tr>
          </tbody>
        </table>
      </div>
    ),
  },
  {
    title: '数学公式',
    description: '支持行内公式、块级公式，也支持 latex / tex / katex / math 代码块预览。',
    example: '行内公式：$E = mc^2$\n\n$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$\n\n```latex\n\\frac{a}{b} + \\sqrt{x}\n```',
    preview: (
      <div className="help-preview-article">
        <p>行内公式：<span className="help-math-inline">E = mc²</span></p>
        <div className="help-math-block">∫₀¹ x² dx = 1/3</div>
        <div className="help-math-block">a / b + √x</div>
      </div>
    ),
  },
  {
    title: 'Mermaid 图表',
    description: 'Mermaid 代码块第一行必须声明图表类型，例如 flowchart TD、graph TD 或 sequenceDiagram。',
    example: '```mermaid\nflowchart TD\n  A[开始] --> B{完成了吗?}\n  B -- 是 --> C[导出]\n  B -- 否 --> D[继续写]\n```',
    preview: (
      <div className="help-mermaid-preview" aria-label="Mermaid 流程图预览">
        <span>开始</span>
        <i />
        <span>完成了吗?</span>
        <i />
        <span>导出 / 继续写</span>
      </div>
    ),
  },
  {
    title: '脚注、Frontmatter 与自动链接',
    description: '脚注适合补充说明；Frontmatter 要放在文档开头；普通 URL 会自动识别为链接。',
    example: '---\ntitle: 写作笔记\ntags: [markdown, nexttyproa]\n---\n\n这里有一个脚注[^1]。\n\n[^1]: 脚注说明\n\nhttps://example.com',
    preview: (
      <div className="help-preview-article">
        <p className="help-frontmatter-chip">title: 写作笔记 · markdown</p>
        <p>这里有一个脚注<sup>1</sup>。</p>
        <p><a href="https://example.com" onClick={(event) => event.preventDefault()}>https://example.com</a></p>
        <p className="help-footnote"><sup>1</sup> 脚注说明</p>
      </div>
    ),
  },
  {
    title: '目录与标题锚点',
    description: 'NextTyproa 会统一处理中文标题和重复标题的锚点规则，可用于目录和内部跳转。',
    example: '[TOC]\n[[toc]]\n\n## 中文标题\n\n[跳转到中文标题](#中文标题)',
    preview: (
      <div className="help-preview-article">
        <nav className="help-toc-preview">
          <a href="#中文标题" onClick={(event) => event.preventDefault()}>中文标题</a>
        </nav>
        <h2 id="中文标题">中文标题</h2>
        <p><a href="#中文标题" onClick={(event) => event.preventDefault()}>跳转到中文标题</a></p>
      </div>
    ),
  },
];

export function MarkdownHelpModal({ open, onClose }: MarkdownHelpModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => panelRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="help-overlay" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        className="help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="markdown-help-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="help-header">
          <div>
            <h2 id="markdown-help-title">Markdown 使用指南</h2>
            <p>从常用写作格式到 NextTyproa 支持的进阶语法。</p>
          </div>
          <button type="button" className="help-close" onClick={onClose} aria-label="关闭 Markdown 帮助">
            <CloseOutlined />
          </button>
        </header>

        <div className="help-body">
          {HELP_TOPICS.map((topic) => (
            <section className="help-section" key={topic.title}>
              <div className="help-section-copy">
                <h3>{topic.title}</h3>
                <p>{topic.description}</p>
              </div>
              <div className="help-demo">
                <div className="help-demo-pane">
                  <span className="help-demo-label">写法</span>
                  <pre className="help-example">
                    <code>{topic.example}</code>
                  </pre>
                </div>
                <div className="help-demo-pane">
                  <span className="help-demo-label">预览</span>
                  <div className="help-preview">{topic.preview}</div>
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
