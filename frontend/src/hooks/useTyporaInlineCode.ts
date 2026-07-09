import { useEffect, type RefObject } from 'react';
import type { Editor } from '@milkdown/kit/core';
import { editorViewCtx } from '@milkdown/core';
import { inlineCodeSchema } from '@milkdown/kit/preset/commonmark';
import { TextSelection } from '@milkdown/kit/prose/state';

function shouldHandleBacktick(event: KeyboardEvent) {
  return (
    (event.key === '`' || event.code === 'Backquote') &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.isComposing
  );
}

function shouldHandleBackspace(event: KeyboardEvent) {
  return (
    event.key === 'Backspace' &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.isComposing
  );
}

function shouldHandleArrow(event: KeyboardEvent) {
  return (
    (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.isComposing
  );
}

function hasInlineCodeMark(marks: readonly { type: { name: string } }[]) {
  return marks.some((mark) => mark.type.name === 'inlineCode');
}

interface InlineCodeTextRange {
  from: number;
  to: number;
  text: string;
}

function findInlineCodeRangeAtParentOffset(
  parent: { childCount: number; child: (index: number) => { isText: boolean; text?: string; nodeSize: number; marks: readonly { type: { name: string } }[] } },
  parentStart: number,
  parentOffset: number,
  mode: 'inside' | 'before-cursor',
): InlineCodeTextRange | null {
  let offset = 0;
  let rangeStartOffset = -1;
  let rangeEndOffset = -1;
  let rangeText = '';

  const flush = (): InlineCodeTextRange | null => {
    if (rangeStartOffset < 0) return null;

    const containsCursor = parentOffset > rangeStartOffset && parentOffset < rangeEndOffset;
    const endsAtCursor = parentOffset === rangeEndOffset;
    const matched = mode === 'inside' ? containsCursor : endsAtCursor;

    if (!matched) return null;
    return {
      from: parentStart + rangeStartOffset,
      to: parentStart + rangeEndOffset,
      text: rangeText,
    };
  };

  for (let index = 0; index < parent.childCount; index += 1) {
    const child = parent.child(index);
    const isInlineCodeText = child.isText && hasInlineCodeMark(child.marks);

    if (isInlineCodeText) {
      if (rangeStartOffset < 0) {
        rangeStartOffset = offset;
        rangeText = '';
      }
      rangeEndOffset = offset + child.nodeSize;
      rangeText += child.text ?? '';
    } else {
      const matched = flush();
      if (matched) return matched;
      rangeStartOffset = -1;
      rangeEndOffset = -1;
      rangeText = '';
    }

    offset += child.nodeSize;
  }

  return flush();
}

function toggleSelectedInlineCode(editor: Editor) {
  const view = editor.ctx.get(editorViewCtx);
  const { selection, schema } = view.state;

  if (selection.empty || selection.$from.parent.type.spec.code) {
    return false;
  }

  const { from, to } = selection;
  const inlineCode = inlineCodeSchema.type(editor.ctx);
  const tr = view.state.tr;

  if (view.state.doc.rangeHasMark(from, to, inlineCode)) {
    tr.removeMark(from, to, inlineCode);
  } else {
    Object.values(schema.marks).forEach((mark) => {
      if (mark !== inlineCode) tr.removeMark(from, to, mark);
    });
    tr.addMark(from, to, inlineCode.create());
  }

  tr.setStoredMarks([]);
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function revealInlineCodeBeforeCursor(editor: Editor) {
  const view = editor.ctx.get(editorViewCtx);
  const { selection } = view.state;

  if (!selection.empty || selection.$from.parent.type.spec.code) {
    return false;
  }

  const $cursor = selection.$from;
  const range = findInlineCodeRangeAtParentOffset(
    $cursor.parent,
    $cursor.start(),
    $cursor.parentOffset,
    'before-cursor',
  );
  if (!range || !range.text) return false;

  const rawText = `\`${range.text}\``;
  const tr = view.state.tr.replaceWith(range.from, range.to, view.state.schema.text(rawText));
  const cursorPos = range.from + rawText.length - 1;

  tr.setStoredMarks([]);
  tr.setSelection(TextSelection.create(tr.doc, cursorPos));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function revealInlineCodeAtCursor(editor: Editor) {
  const view = editor.ctx.get(editorViewCtx);
  const { selection } = view.state;

  if (!selection.empty || selection.$from.parent.type.spec.code) {
    return false;
  }

  const $cursor = selection.$from;
  const range = findInlineCodeRangeAtParentOffset(
    $cursor.parent,
    $cursor.start(),
    $cursor.parentOffset,
    'inside',
  );
  if (!range || !range.text) return false;

  const rawText = `\`${range.text}\``;
  const relativeCursor = $cursor.pos - range.from;
  const tr = view.state.tr.replaceWith(range.from, range.to, view.state.schema.text(rawText));
  const cursorPos = range.from + relativeCursor + 1;

  tr.setStoredMarks([]);
  tr.setSelection(TextSelection.create(tr.doc, cursorPos));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function clearInlineCodeStoredMarksAtBoundary(editor: Editor) {
  const view = editor.ctx.get(editorViewCtx);
  const { selection } = view.state;

  if (!selection.empty || selection.$from.parent.type.spec.code) {
    return false;
  }

  const $cursor = selection.$from;
  const inlineCode = inlineCodeSchema.type(editor.ctx);
  const beforeRange = findInlineCodeRangeAtParentOffset(
    $cursor.parent,
    $cursor.start(),
    $cursor.parentOffset,
    'before-cursor',
  );
  const insideRange = findInlineCodeRangeAtParentOffset(
    $cursor.parent,
    $cursor.start(),
    $cursor.parentOffset,
    'inside',
  );

  const storedHasInlineCode = Boolean(view.state.storedMarks?.some((mark) => mark.type === inlineCode));

  if (insideRange) {
    return false;
  }

  if (!beforeRange && !storedHasInlineCode) {
    return false;
  }

  const tr = view.state.tr.setStoredMarks([]);
  tr.setMeta('addToHistory', false);
  view.dispatch(tr);
  return true;
}

function insertPlainTextAtInlineCodeBoundary(editor: Editor, text: string) {
  if (!text) return false;

  const view = editor.ctx.get(editorViewCtx);
  const { selection } = view.state;

  if (!selection.empty || selection.$from.parent.type.spec.code) {
    return false;
  }

  const $cursor = selection.$from;
  const beforeRange = findInlineCodeRangeAtParentOffset(
    $cursor.parent,
    $cursor.start(),
    $cursor.parentOffset,
    'before-cursor',
  );
  const insideRange = findInlineCodeRangeAtParentOffset(
    $cursor.parent,
    $cursor.start(),
    $cursor.parentOffset,
    'inside',
  );

  if (!beforeRange || insideRange) return false;

  const tr = view.state.tr.replaceWith($cursor.pos, $cursor.pos, view.state.schema.text(text));
  tr.setStoredMarks([]);
  tr.setSelection(TextSelection.create(tr.doc, $cursor.pos + text.length));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function convertTypedInlineCode(editor: Editor) {
  const view = editor.ctx.get(editorViewCtx);
  const { selection } = view.state;

  if (!selection.empty || selection.$from.parent.type.spec.code) {
    return false;
  }

  const inlineCode = inlineCodeSchema.type(editor.ctx);
  const $cursor = selection.$from;
  const parentStart = $cursor.start();
  const cursorOffset = $cursor.parentOffset;
  const textBeforeCursor = $cursor.parent.textBetween(0, cursorOffset, '\n', '\n');

  if (!textBeforeCursor.endsWith('`')) {
    return false;
  }

  const openingOffset = textBeforeCursor.lastIndexOf('`', textBeforeCursor.length - 2);
  if (openingOffset < 0) {
    return false;
  }

  const codeText = textBeforeCursor.slice(openingOffset + 1, -1);
  if (!codeText.trim() || codeText.includes('\n')) {
    return false;
  }

  const openingPos = parentStart + openingOffset;
  const closingPos = parentStart + textBeforeCursor.length - 1;
  const tr = view.state.tr;

  tr.delete(closingPos, closingPos + 1);
  tr.delete(openingPos, openingPos + 1);
  tr.addMark(openingPos, openingPos + codeText.length, inlineCode.create());
  tr.setStoredMarks([]);
  tr.setSelection(TextSelection.create(tr.doc, openingPos + codeText.length));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function normalizeInlineCodeAroundSelection(editor: Editor, revealSource = false) {
  if (convertTypedInlineCode(editor)) return true;
  if (revealSource && revealInlineCodeAtCursor(editor)) return true;
  return clearInlineCodeStoredMarksAtBoundary(editor);
}

export function useTyporaInlineCode(
  containerRef: RefObject<HTMLElement | null>,
  getEditor: () => Editor | undefined,
  loading: boolean,
) {
  useEffect(() => {
    if (loading) return undefined;

    const container = containerRef.current;
    if (!container) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandleBacktick(event) && !shouldHandleBackspace(event) && !shouldHandleArrow(event)) return;

      const editor = getEditor();
      if (!editor) return;

      const handled = shouldHandleBacktick(event)
        ? toggleSelectedInlineCode(editor)
        : shouldHandleBackspace(event)
          ? revealInlineCodeBeforeCursor(editor)
          : event.key === 'ArrowRight'
            ? clearInlineCodeStoredMarksAtBoundary(editor)
            : false;

      if (!handled) return;

      if (!shouldHandleArrow(event)) event.preventDefault();
      event.stopPropagation();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const editor = getEditor();
      if (!editor) return;

      if (
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight' ||
        event.key === 'Home' ||
        event.key === 'End'
      ) {
        if (convertTypedInlineCode(editor)) return;
        if (event.key === 'ArrowLeft' && revealInlineCodeBeforeCursor(editor)) return;
        if (revealInlineCodeAtCursor(editor)) return;
        clearInlineCodeStoredMarksAtBoundary(editor);
        return;
      }

      normalizeInlineCodeAroundSelection(editor);
    };

    let normalizeFrame = 0;
    const scheduleNormalize = (revealSource = false) => {
      window.cancelAnimationFrame(normalizeFrame);
      normalizeFrame = window.requestAnimationFrame(() => {
        const editor = getEditor();
        if (!editor) return;
        normalizeInlineCodeAroundSelection(editor, revealSource);
      });
    };

    const onInput = () => scheduleNormalize(false);
    const onBeforeInput = (event: InputEvent) => {
      if (event.inputType !== 'insertText' || !event.data || event.isComposing) return;

      const editor = getEditor();
      if (!editor) return;

      if (!insertPlainTextAtInlineCodeBoundary(editor, event.data)) return;

      event.preventDefault();
      event.stopPropagation();
    };

    const onSelectionChange = () => {
      const selection = document.getSelection();
      const anchorNode = selection?.anchorNode;
      if (!anchorNode || !container.contains(anchorNode)) return;
      scheduleNormalize(true);
    };

    const onPointerUp = () => {
      window.setTimeout(() => {
        const editor = getEditor();
        if (!editor) return;
        if (normalizeInlineCodeAroundSelection(editor, true)) return;
        revealInlineCodeAtCursor(editor);
      });
    };

    container.addEventListener('keydown', onKeyDown, true);
    container.addEventListener('keyup', onKeyUp, true);
    container.addEventListener('beforeinput', onBeforeInput, true);
    container.addEventListener('input', onInput, true);
    container.addEventListener('compositionend', onInput, true);
    container.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('selectionchange', onSelectionChange);

    return () => {
      window.cancelAnimationFrame(normalizeFrame);
      container.removeEventListener('keydown', onKeyDown, true);
      container.removeEventListener('keyup', onKeyUp, true);
      container.removeEventListener('beforeinput', onBeforeInput, true);
      container.removeEventListener('input', onInput, true);
      container.removeEventListener('compositionend', onInput, true);
      container.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [containerRef, getEditor, loading]);
}
