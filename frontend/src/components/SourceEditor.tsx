import { useEffect, useRef } from 'react';
import { SearchOutlined } from '@ant-design/icons';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { search, openSearchPanel, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { minimalSetup } from 'codemirror';
import { tags } from '@lezer/highlight';
import { uploadEditorImagesMarkdown } from '../utils/imageUpload';

interface SourceEditorProps {
  value: string;
  onChange: (value: string) => void;
  noteKey: string;
  notePath: string;
  isDark: boolean;
  spellCheckEnabled: boolean;
  typewriterMode?: boolean;
}

export function SourceEditor({ value, onChange, noteKey, notePath, isDark, spellCheckEnabled, typewriterMode = false }: SourceEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const notePathRef = useRef(notePath);
  const typewriterModeRef = useRef(typewriterMode);
  const prefersReducedMotionRef = useRef(false);
  const typewriterFrameRef = useRef<number | null>(null);

  onChangeRef.current = onChange;
  valueRef.current = value;
  notePathRef.current = notePath;
  typewriterModeRef.current = typewriterMode;

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotionPreference = () => {
      prefersReducedMotionRef.current = media.matches;
      if (viewRef.current) {
        viewRef.current.scrollDOM.style.scrollBehavior = media.matches ? 'auto' : '';
      }
    };

    syncMotionPreference();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', syncMotionPreference);
      return () => media.removeEventListener('change', syncMotionPreference);
    }

    media.addListener(syncMotionPreference);
    return () => media.removeListener(syncMotionPreference);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const centerActiveLine = (view: EditorView) => {
      if (!typewriterModeRef.current) return;

      if (typewriterFrameRef.current !== null) {
        window.cancelAnimationFrame(typewriterFrameRef.current);
      }

      typewriterFrameRef.current = window.requestAnimationFrame(() => {
        typewriterFrameRef.current = null;
        if (viewRef.current !== view) return;

        view.scrollDOM.style.scrollBehavior = prefersReducedMotionRef.current ? 'auto' : '';
        const pos = view.state.selection.main.head;
        const line = view.state.doc.lineAt(pos);
        view.dispatch({
          effects: EditorView.scrollIntoView(line.from, {
            y: 'center',
            yMargin: 80,
            x: 'nearest',
            xMargin: 16,
          }),
        });
      });
    };

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          minimalSetup,
          lineNumbers(),
          highlightActiveLine(),
          markdown(),
          search({ top: true }),
          keymap.of(searchKeymap),
          EditorState.allowMultipleSelections.of(false),
          isDark ? oneDark : [],
          syntaxHighlighting(markdownHighlightStyle(isDark), { fallback: false }),
          EditorView.lineWrapping,
          EditorView.domEventHandlers({
            paste: (event, view) => {
              const files = imageFilesFromDataTransfer(event.clipboardData);
              if (files.length === 0) return false;

              event.preventDefault();
              void insertUploadedImages(view, notePathRef.current, files);
              return true;
            },
            dragover: (event) => {
              const hasImages = imageFilesFromDataTransfer(event.dataTransfer).length > 0;
              if (!hasImages) return false;

              event.preventDefault();
              if (event.dataTransfer) {
                event.dataTransfer.dropEffect = 'copy';
              }
              return true;
            },
            drop: (event, view) => {
              const files = imageFilesFromDataTransfer(event.dataTransfer);
              if (files.length === 0) return false;

              event.preventDefault();
              const dropPos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined;
              void insertUploadedImages(view, notePathRef.current, files, dropPos);
              return true;
            },
          }),
          EditorView.theme(
            {
              '&': {
                height: '100%',
                backgroundColor: 'var(--editor-bg)',
                color: 'var(--editor-fg)',
                fontSize: '15px',
              },
              '&.cm-focused': {
                outline: 'none',
              },
              '.cm-scroller': {
                fontFamily: 'var(--editor-code-font)',
                lineHeight: '1.7',
              },
              '.cm-content': {
                padding: '40px max(32px, calc((100vw - var(--sidebar-width) - var(--content-width)) / 2))',
                caretColor: 'var(--accent)',
                minHeight: '100%',
              },
              '.cm-line': {
                padding: '0 8px',
              },
              '.cm-activeLine': {
                boxShadow: 'inset 3px 0 0 var(--accent)',
              },
              '.cm-gutters': {
                backgroundColor: 'var(--source-gutter-bg)',
                color: 'var(--text-muted)',
                borderRight: '1px solid var(--border-subtle)',
              },
              '.cm-lineNumbers .cm-gutterElement': {
                minWidth: '42px',
                padding: '0 12px 0 8px',
                fontSize: '12px',
              },
              '.cm-activeLine, .cm-activeLineGutter': {
                backgroundColor: 'var(--editor-active-line)',
              },
              '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
                backgroundColor: 'var(--source-selection) !important',
              },
              '.cm-cursor': {
                borderLeftColor: 'var(--accent)',
              },
              '.cm-panels': {
                backgroundColor: 'var(--bg-panel)',
                color: 'var(--text)',
                borderColor: 'var(--border)',
                borderRadius: '0 0 6px 6px',
                boxShadow: '0 8px 20px rgba(0, 0, 0, 0.12)',
              },
              '.cm-panel.cm-search': {
                padding: '8px 10px',
                fontFamily: 'inherit',
              },
              '.cm-panel.cm-search input': {
                border: '1px solid var(--border)',
                borderRadius: '6px',
                padding: '4px 8px',
                backgroundColor: 'var(--editor-bg)',
                color: 'var(--text)',
              },
              '.cm-panel.cm-search button': {
                border: '1px solid var(--border)',
                borderRadius: '6px',
                padding: '4px 8px',
                backgroundColor: 'var(--bg-panel)',
                color: 'var(--text)',
              },
              '.cm-searchMatch': {
                backgroundColor: 'rgba(255, 214, 102, 0.48)',
                outline: '1px solid rgba(250, 173, 20, 0.65)',
              },
              '.cm-searchMatch.cm-searchMatch-selected': {
                backgroundColor: 'rgba(255, 214, 102, 0.75)',
              },
            },
            { dark: isDark },
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const next = update.state.doc.toString();
              valueRef.current = next;
              onChangeRef.current(next);
            }
            if (update.docChanged || update.selectionSet) {
              centerActiveLine(update.view);
            }
          }),
          EditorView.contentAttributes.of({
            spellcheck: String(spellCheckEnabled),
          }),
        ],
      }),
    });

    viewRef.current = view;
    return () => {
      if (typewriterFrameRef.current !== null) {
        window.cancelAnimationFrame(typewriterFrameRef.current);
        typewriterFrameRef.current = null;
      }
      view.destroy();
      viewRef.current = null;
    };
    // 每篇笔记使用独立的 EditorState：切换笔记时重建，撤销历史不会跨笔记
  }, [isDark, spellCheckEnabled, noteKey]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const current = view.state.doc.toString();
    if (value === current) return;

    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  const openSearch = () => {
    const view = viewRef.current;
    if (!view) return;
    openSearchPanel(view);
    view.focus();
  };

  return (
    <div className="source-editor-shell">
      <button
        type="button"
        className="source-editor-search-btn"
        title="源码搜索 (Ctrl+F)"
        aria-label="源码搜索"
        onClick={openSearch}
      >
        <SearchOutlined />
      </button>
      <div ref={hostRef} className="source-editor" />
    </div>
  );
}

function imageFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];
  return Array.from(dataTransfer.files).filter((file) => (
    file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(file.name)
  ));
}

async function insertUploadedImages(view: EditorView, notePath: string, files: File[], pos?: number) {
  if (!notePath || files.length === 0) return;

  const markdown = await uploadEditorImagesMarkdown(notePath, files);
  if (!markdown) return;

  const insert = `\n\n${markdown}\n\n`;
  const selection = view.state.selection.main;
  const from = pos ?? selection.from;
  const to = pos ?? selection.to;

  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  });
  view.focus();
}

function markdownHighlightStyle(isDark: boolean) {
  return HighlightStyle.define([
    {
      tag: tags.heading,
      color: isDark ? '#79c0ff' : '#0f6fc6',
      fontWeight: '700',
    },
    {
      tag: tags.heading1,
      color: isDark ? '#a5d6ff' : '#0b5cad',
      fontWeight: '800',
    },
    {
      tag: tags.heading2,
      color: isDark ? '#8ccfff' : '#126bb8',
      fontWeight: '750',
    },
    {
      tag: tags.strong,
      color: isDark ? '#ffd580' : '#8a4b00',
      fontWeight: '800',
    },
    {
      tag: tags.emphasis,
      color: isDark ? '#d2a8ff' : '#7d3fc0',
      fontStyle: 'italic',
    },
    {
      tag: tags.strikethrough,
      color: 'var(--text-muted)',
      textDecoration: 'line-through',
    },
    {
      tag: [tags.link, tags.url],
      color: isDark ? '#7ee787' : '#0a7f3f',
      textDecoration: 'underline',
    },
    {
      tag: tags.monospace,
      color: 'var(--inline-code-fg)',
      backgroundColor: 'var(--inline-code-bg)',
      borderRadius: '4px',
    },
    {
      tag: tags.quote,
      color: isDark ? '#8b949e' : '#6a737d',
      fontStyle: 'italic',
    },
    {
      tag: [tags.list, tags.separator],
      color: isDark ? '#ffa657' : '#b45f06',
      fontWeight: '700',
    },
    {
      tag: tags.contentSeparator,
      color: 'var(--text-muted)',
    },
  ]);
}
