import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Decoration } from '@milkdown/kit/prose/view';
import { uploadConfig } from '@milkdown/kit/plugin/upload';
import { getMarkdown } from '@milkdown/kit/utils';
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react';
import { useTyporaInlineCode } from '../hooks/useTyporaInlineCode';
import { useTyporaImageSource } from '../hooks/useTyporaImageSource';
import { renderCodeBlockPreview } from './CodeBlockPreview';
import { proxyImageUrl } from '../utils/assets';
import { uploadEditorImage } from '../utils/imageUpload';
import { normalizeEditorImageMarkdown } from '../utils/markdownImages';
import { joinFrontmatter, splitFrontmatter } from '../utils/frontmatter';
import { slashMenuChineseTrigger } from '../utils/slashMenuTrigger';
import { configureMarkdownStringify, createMarkdownBlockPreserver, type HardBreakStyle, type MarkdownBlockPreserver } from '../utils/preserveMarkdownBlocks';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/classic.css';

/** 同步读取编辑器里还没通过 onChange 上报的最新内容（没有则返回 undefined）；noteKey 标明它属于哪一次载入 */
export interface PendingMarkdownReader {
  noteKey: string;
  read: () => string | undefined;
}

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onReady?: (value: string) => void;
  noteKey: string;
  notePath: string;
  spellCheckEnabled: boolean;
  isDark: boolean;
  typewriterMode?: boolean;
  pendingMarkdownRef?: MutableRefObject<PendingMarkdownReader | null>;
  onImageUploadError?: (error: unknown) => void;
  /** 代码块右上角的复制按钮复制成功后调用（Milkdown 只在成功时调用，失败时它自己吞掉，见 V104-01） */
  onCodeCopy?: (code: string) => void;
}

function EditorInner({
  value,
  onChange,
  onReady,
  noteKey,
  notePath,
  spellCheckEnabled,
  isDark,
  typewriterMode,
  pendingMarkdownRef,
  onImageUploadError,
  onCodeCopy,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const onImageUploadErrorRef = useRef(onImageUploadError);
  const onCodeCopyRef = useRef(onCodeCopy);
  const notePathRef = useRef(notePath);
  const isDarkRef = useRef(isDark);
  const readerRef = useRef<PendingMarkdownReader | null>(null);
  const disposedRef = useRef(false);
  const [loading, getEditor] = useInstance();
  // Milkdown 没有 frontmatter 节点，会把开头的 --- 解析成分隔线 + setext 标题并按正文重新序列化，
  // 所以编辑器只接管正文，frontmatter 原样保留并在输出时拼回去（在源码模式中编辑）
  const [frontmatter] = useState(() => splitFrontmatter(value).frontmatter);
  onChangeRef.current = onChange;
  onReadyRef.current = onReady;
  onImageUploadErrorRef.current = onImageUploadError;
  onCodeCopyRef.current = onCodeCopy;
  notePathRef.current = notePath;
  isDarkRef.current = isDark;

  // Milkdown 的销毁是异步的：卸载时立即撤下自己的 reader，避免 App 读到已关闭笔记的内容
  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      if (pendingMarkdownRef && pendingMarkdownRef.current === readerRef.current) {
        pendingMarkdownRef.current = null;
      }
      readerRef.current = null;
    };
  }, [pendingMarkdownRef]);

  useTyporaImageSource(containerRef, getEditor, loading);
  useTyporaInlineCode(containerRef, getEditor, loading);

  useEffect(() => {
    if (!typewriterMode || loading) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    let frame = 0;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollActiveBlock = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const selection = window.getSelection();
        const anchor = selection?.anchorNode;
        const element = anchor instanceof Element ? anchor : anchor?.parentElement;
        const block = element?.closest<HTMLElement>('.ProseMirror p, .ProseMirror li, .ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6, .ProseMirror pre, .milkdown-code-block, .milkdown-table-wrapper');
        block?.scrollIntoView({
          block: 'center',
          inline: 'nearest',
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
        });
      });
    };

    container.addEventListener('keyup', scrollActiveBlock);
    container.addEventListener('mouseup', scrollActiveBlock);
    container.addEventListener('input', scrollActiveBlock);
    return () => {
      window.cancelAnimationFrame(frame);
      container.removeEventListener('keyup', scrollActiveBlock);
      container.removeEventListener('mouseup', scrollActiveBlock);
      container.removeEventListener('input', scrollActiveBlock);
    };
  }, [loading, typewriterMode]);

  useEffect(() => {
    if (loading) return undefined;

    const container = containerRef.current;
    if (!container) return undefined;

    const applySpellCheck = () => {
      const editorRoot = container.querySelector<HTMLElement>('.ProseMirror');
      if (!editorRoot) return;

      editorRoot.spellcheck = spellCheckEnabled;
      editorRoot.setAttribute('spellcheck', String(spellCheckEnabled));

      editorRoot
        .querySelectorAll<HTMLElement>('.milkdown-code-block [contenteditable="true"], .cm-content')
        .forEach((element) => {
          element.spellcheck = false;
          element.setAttribute('spellcheck', 'false');
        });
    };

    applySpellCheck();
    const observer = new MutationObserver(applySpellCheck);
    observer.observe(container, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [loading, spellCheckEnabled]);

  useEditor(
    (root) => {
      const uploadImage = (file: File) => uploadEditorImage(notePathRef.current, file);
      const resolveImage = (url: string) => proxyImageUrl(notePathRef.current, url);

      const body = splitFrontmatter(value).body;
      const crepe = new Crepe({
        root,
        defaultValue: body,
        features: {
          [Crepe.Feature.ListItem]: true,
          [Crepe.Feature.TopBar]: true,
          [Crepe.Feature.Toolbar]: true,
          [Crepe.Feature.Table]: true,
          [Crepe.Feature.Latex]: true,
          [Crepe.Feature.CodeMirror]: true,
          [Crepe.Feature.AI]: false,
        },
        featureConfigs: {
          [Crepe.Feature.Placeholder]: {
            text: '输入 / 唤起命令，或直接开始写作…',
            mode: 'block',
          },
          // 斜杠菜单（V104-03）。Crepe 只拿菜单项的显示名做筛选，所以菜单项在中文后面保留原英文名：
          // 新名字包含整个旧名字，/code、/table 这些老关键词照样能筛到，/代码 也能。分组名不参与筛选，只写中文
          [Crepe.Feature.BlockEdit]: {
            textGroup: {
              label: '文本',
              text: { label: '正文 Text' },
              h1: { label: '一级标题 Heading 1' },
              h2: { label: '二级标题 Heading 2' },
              h3: { label: '三级标题 Heading 3' },
              h4: { label: '四级标题 Heading 4' },
              h5: { label: '五级标题 Heading 5' },
              h6: { label: '六级标题 Heading 6' },
              quote: { label: '引用 Quote' },
              divider: { label: '分割线 Divider' },
            },
            listGroup: {
              label: '列表',
              bulletList: { label: '无序列表 Bullet List' },
              orderedList: { label: '有序列表 Ordered List' },
              taskList: { label: '任务清单 Task List' },
            },
            advancedGroup: {
              label: '高级',
              image: { label: '图片 Image' },
              codeBlock: { label: '代码块 Code' },
              table: { label: '表格 Table' },
              math: { label: '数学公式 Math' },
            },
          },
          [Crepe.Feature.ImageBlock]: {
            onUpload: uploadImage,
            inlineOnUpload: uploadImage,
            blockOnUpload: uploadImage,
            proxyDomURL: resolveImage,
            // 图片块文案（V104-03）。行内图片的确定按钮、块级图片的说明按钮是图标，不改
            blockUploadButton: '上传图片',
            blockUploadPlaceholderText: '或粘贴链接',
            blockConfirmButton: '确定',
            blockCaptionPlaceholderText: '输入图片说明',
            inlineUploadButton: '上传',
            inlineUploadPlaceholderText: '或粘贴链接',
          },
          [Crepe.Feature.LinkTooltip]: {
            inputPlaceholder: '粘贴链接…',
          },
          [Crepe.Feature.CodeMirror]: {
            previewLabel: '预览',
            // 工具栏其余文案（V104-02）。没设语言时语言按钮上的 "Text" 是 Milkdown 写死的，没有配置项
            copyText: '复制',
            searchPlaceholder: '搜索语言',
            noResultText: '无匹配语言',
            // 代码和预览并排时，这个按钮隐藏的是源码、只留预览；仅预览时点它回到编辑
            previewToggleText: (previewOnly: boolean) => (previewOnly ? '编辑' : '隐藏代码'),
            previewLoading: '<div class="code-preview-loading">正在渲染预览...</div>',
            previewOnlyByDefault: false,
            // Crepe 的默认值是空函数：复制成功了界面上却什么都不发生（V104-01）
            onCopy: (code: string) => onCodeCopyRef.current?.(code),
            renderPreview: (language: string, code: string, applyPreview: (value: null | string | HTMLElement) => void) => {
              return renderCodeBlockPreview(language, code, isDarkRef.current, applyPreview);
            },
          },
        },
      });

      // 重新序列化改动过的内容时：紧凑列表保持紧凑（修正 Milkdown 字符串 spread），无序列表用最常见的 "-"，
      // 硬换行沿用这篇文档原来的写法（载入后由 preserver 检测）
      let hardBreakStyle: HardBreakStyle = 'backslash';
      crepe.editor.config((ctx) => configureMarkdownStringify(ctx, () => hardBreakStyle));

      // 中文输入法按 / 打出的「、」「／」也能唤起斜杠菜单（V104-05）
      crepe.editor.use(slashMenuChineseTrigger);

      // 粘贴/拖入图片时 upload 插件先显示占位（默认是英文 "Upload in progress..."，V104-03 换成中文）；
      // 上传失败它只 console.error，占位永远不会消失。失败时交给 App 提示原因，并返回空内容，让插件移除占位且不插入任何东西
      crepe.editor.config((ctx) => {
        ctx.update(uploadConfig.key, (config) => ({
          ...config,
          // Crepe 的 uploader 只处理图片文件，所以占位里写"图片"
          uploadWidgetFactory: (pos, spec) => {
            const widget = document.createElement('span');
            widget.textContent = '正在上传图片…';
            return Decoration.widget(pos, widget, spec);
          },
          uploader: async (...args) => {
            try {
              return await config.uploader(...args);
            } catch (error) {
              onImageUploadErrorRef.current?.(error);
              return [];
            }
          },
        }));
      });

      crepe.on((listener) => {
        // 最近一次通过 onReady/onChange 上报的文档；markdownUpdated 有 200ms 防抖，编辑器销毁时还会直接取消，
        // 所以 App 在切换、关闭、退出前要通过 pendingMarkdownRef 同步取走这之后的修改
        let reportedDoc: ProseNode | null = null;
        // 未改动的块原样沿用载入时的文本，只有改动过的块重新序列化
        let preserver: MarkdownBlockPreserver | null = null;
        const toMarkdown = (ctx: Ctx) => {
          const { doc } = ctx.get(editorViewCtx).state;
          const markdown = preserver ? preserver.serialize(doc) : normalizeEditorImageMarkdown(getMarkdown()(ctx));
          return joinFrontmatter(frontmatter, markdown);
        };
        // 载入笔记不会触发 markdownUpdated（它只在文档被修改后触发），所以挂载时主动把序列化后的
        // 初始内容交给 onReady；此后每一次 markdownUpdated 都是用户编辑，必须走 onChange 才会被标记为未保存
        listener.mounted((ctx) => {
          reportedDoc = ctx.get(editorViewCtx).state.doc;
          preserver = createMarkdownBlockPreserver(ctx, body, reportedDoc, normalizeEditorImageMarkdown);
          hardBreakStyle = preserver.hardBreakStyle;
          onReadyRef.current?.(toMarkdown(ctx));
          if (disposedRef.current) return;
          const reader: PendingMarkdownReader = {
            noteKey,
            read: () => {
              try {
                const { doc } = ctx.get(editorViewCtx).state;
                if (reportedDoc && doc.eq(reportedDoc)) return undefined;
                return toMarkdown(ctx);
              } catch {
                // 编辑器已经销毁
                return undefined;
              }
            },
          };
          readerRef.current = reader;
          if (pendingMarkdownRef) pendingMarkdownRef.current = reader;
        });
        listener.markdownUpdated((ctx) => {
          reportedDoc = ctx.get(editorViewCtx).state.doc;
          onChangeRef.current(toMarkdown(ctx));
        });
      });

      return crepe;
    },
    [],
  );

  return (
    <div ref={containerRef} className="typora-editor">
      {frontmatter && (
        <pre className="typora-frontmatter" aria-label="YAML Frontmatter" title="Frontmatter 请在源码模式中编辑">
          {frontmatter.replace(/\r\n/g, '\n').trimEnd()}
        </pre>
      )}
      <Milkdown />
    </div>
  );
}

export function MarkdownEditor({ value, onChange, onReady, noteKey, notePath, spellCheckEnabled, isDark, typewriterMode = false, pendingMarkdownRef, onImageUploadError, onCodeCopy }: MarkdownEditorProps) {
  return (
    <MilkdownProvider key={noteKey}>
      <EditorInner
        value={value}
        onChange={onChange}
        onReady={onReady}
        noteKey={noteKey}
        notePath={notePath}
        spellCheckEnabled={spellCheckEnabled}
        isDark={isDark}
        typewriterMode={typewriterMode}
        pendingMarkdownRef={pendingMarkdownRef}
        onImageUploadError={onImageUploadError}
        onCodeCopy={onCodeCopy}
      />
    </MilkdownProvider>
  );
}
