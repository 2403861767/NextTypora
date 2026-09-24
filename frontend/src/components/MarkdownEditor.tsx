import { useEffect, useRef } from 'react';
import { Crepe } from '@milkdown/crepe';
import { getMarkdown } from '@milkdown/kit/utils';
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react';
import { useTyporaInlineCode } from '../hooks/useTyporaInlineCode';
import { useTyporaImageSource } from '../hooks/useTyporaImageSource';
import { renderCodeBlockPreview } from './CodeBlockPreview';
import { proxyImageUrl } from '../utils/assets';
import { uploadEditorImage } from '../utils/imageUpload';
import { normalizeEditorImageMarkdown } from '../utils/markdownImages';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/classic.css';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onReady?: (value: string) => void;
  noteKey: string;
  notePath: string;
  spellCheckEnabled: boolean;
  isDark: boolean;
  typewriterMode?: boolean;
}

function EditorInner({
  value,
  onChange,
  onReady,
  notePath,
  spellCheckEnabled,
  isDark,
  typewriterMode,
}: Pick<MarkdownEditorProps, 'value' | 'onChange' | 'onReady' | 'notePath' | 'spellCheckEnabled' | 'isDark' | 'typewriterMode'>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const notePathRef = useRef(notePath);
  const isDarkRef = useRef(isDark);
  const [loading, getEditor] = useInstance();
  onChangeRef.current = onChange;
  onReadyRef.current = onReady;
  notePathRef.current = notePath;
  isDarkRef.current = isDark;

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

      const crepe = new Crepe({
        root,
        defaultValue: value,
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

      crepe.on((listener) => {
        // 载入笔记不会触发 markdownUpdated（它只在文档被修改后触发），所以挂载时主动把序列化后的
        // 初始内容交给 onReady；此后每一次 markdownUpdated 都是用户编辑，必须走 onChange 才会被标记为未保存
        listener.mounted((ctx) => {
          onReadyRef.current?.(normalizeEditorImageMarkdown(getMarkdown()(ctx)));
        });
        listener.markdownUpdated((_ctx, markdown) => {
          onChangeRef.current(normalizeEditorImageMarkdown(markdown));
        });
      });

      return crepe;
    },
    [],
  );

  return (
    <div ref={containerRef} className="typora-editor">
      <Milkdown />
    </div>
  );
}

export function MarkdownEditor({ value, onChange, onReady, noteKey, notePath, spellCheckEnabled, isDark, typewriterMode = false }: MarkdownEditorProps) {
  return (
    <MilkdownProvider key={noteKey}>
      <EditorInner
        value={value}
        onChange={onChange}
        onReady={onReady}
        notePath={notePath}
        spellCheckEnabled={spellCheckEnabled}
        isDark={isDark}
        typewriterMode={typewriterMode}
      />
    </MilkdownProvider>
  );
}
