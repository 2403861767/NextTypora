import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { getMarkdown } from '@milkdown/kit/utils';
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react';
import { useTyporaInlineCode } from '../hooks/useTyporaInlineCode';
import { useTyporaImageSource } from '../hooks/useTyporaImageSource';
import { renderCodeBlockPreview } from './CodeBlockPreview';
import { proxyImageUrl } from '../utils/assets';
import { uploadEditorImage } from '../utils/imageUpload';
import { normalizeEditorImageMarkdown } from '../utils/markdownImages';
import { joinFrontmatter, splitFrontmatter } from '../utils/frontmatter';
import { createMarkdownBlockPreserver, joinListsBySpread, type MarkdownBlockPreserver } from '../utils/preserveMarkdownBlocks';
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
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
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
          [Crepe.Feature.ImageBlock]: {
            onUpload: uploadImage,
            inlineOnUpload: uploadImage,
            blockOnUpload: uploadImage,
            proxyDomURL: resolveImage,
          },
          [Crepe.Feature.CodeMirror]: {
            previewLabel: '预览',
            previewLoading: '<div class="code-preview-loading">正在渲染预览...</div>',
            previewOnlyByDefault: false,
            renderPreview: (language: string, code: string, applyPreview: (value: null | string | HTMLElement) => void) => {
              return renderCodeBlockPreview(language, code, isDarkRef.current, applyPreview);
            },
          },
        },
      });

      // 重新序列化改动过的块时：紧凑列表保持紧凑（修正 Milkdown 字符串 spread），无序列表用最常见的 "-"
      crepe.editor.config((ctx) => {
        ctx.update(remarkStringifyOptionsCtx, (options) => ({
          ...options,
          bullet: '-' as const,
          join: [...(options.join ?? []), joinListsBySpread],
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

export function MarkdownEditor({ value, onChange, onReady, noteKey, notePath, spellCheckEnabled, isDark, typewriterMode = false, pendingMarkdownRef }: MarkdownEditorProps) {
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
      />
    </MilkdownProvider>
  );
}
