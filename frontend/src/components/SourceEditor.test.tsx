import { cleanup, fireEvent, render } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SourceEditor } from './SourceEditor';

const originalRangeRects = {
  getClientRects: Range.prototype.getClientRects,
  getBoundingClientRect: Range.prototype.getBoundingClientRect,
};

// jsdom 没有 matchMedia（SourceEditor 挂载时读取 prefers-reduced-motion），
// 也没有 Range 的布局方法（CodeMirror 在 requestAnimationFrame 中测量文本）
beforeAll(() => {
  const emptyRect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => emptyRect as DOMRect;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

// vitest 未开启 globals，Testing Library 不会自动卸载；先销毁编辑器，避免残留的测量回调在还原后运行
afterEach(() => {
  cleanup();
});

afterAll(() => {
  Range.prototype.getClientRects = originalRangeRects.getClientRects;
  Range.prototype.getBoundingClientRect = originalRangeRects.getBoundingClientRect;
  delete (window as { matchMedia?: unknown }).matchMedia;
});

// App 把 onChange 的值直接 setContent；只要从未收到过当前笔记以外的内容，标签就不会变脏、也不会触发自动保存
function receivedValues(onChange: ReturnType<typeof vi.fn>) {
  return onChange.mock.calls.map(([value]) => value);
}

const NOTE_A = '# Markdown Syntax Coverage\n\nSetext heading above, *emphasis* and **strong**.\n';
const NOTE_B = '# 2026-09-23\n\n今天的日记内容。\n';

function renderSourceEditor(noteKey: string, value: string, onChange: (value: string) => void) {
  const props = { onChange, isDark: false, spellCheckEnabled: false };
  const result = render(<SourceEditor {...props} noteKey={noteKey} notePath={noteKey.split(':')[0]} value={value} />);
  const rerender = (nextKey: string, nextValue: string) => result.rerender(
    <SourceEditor {...props} noteKey={nextKey} notePath={nextKey.split(':')[0]} value={nextValue} />,
  );
  const view = () => {
    const dom = result.container.querySelector<HTMLElement>('.cm-editor');
    const found = dom ? EditorView.findFromDOM(dom) : null;
    if (!found) throw new Error('CodeMirror view not found');
    return found;
  };
  // 真实的 Ctrl+Z：由 CodeMirror 的 historyKeymap (Mod-z) 处理
  const pressUndo = () => fireEvent.keyDown(view().contentDOM, { key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true });
  return { rerender, view, pressUndo };
}

describe('SourceEditor', () => {
  it('does not bring back the previous note when Ctrl+Z is pressed right after switching notes', () => {
    const onChange = vi.fn();
    const editor = renderSourceEditor('ascii-notes.md:1', NOTE_A, onChange);

    // App 切换笔记：同一个组件实例收到新笔记的内容
    editor.rerender('日记/2026-09-23.md:2', NOTE_B);
    expect(editor.view().state.doc.toString()).toBe(NOTE_B);
    expect(receivedValues(onChange).every((value) => value === NOTE_B)).toBe(true);

    editor.pressUndo();

    expect(editor.view().state.doc.toString()).toBe(NOTE_B);
    expect(onChange).not.toHaveBeenCalledWith(NOTE_A);
    expect(receivedValues(onChange).every((value) => value === NOTE_B)).toBe(true);
  });

  it('keeps undo history per note: undo reverts edits in the current note but never crosses into the previous one', () => {
    const onChange = vi.fn();
    const editor = renderSourceEditor('ascii-notes.md:1', NOTE_A, onChange);
    editor.rerender('日记/2026-09-23.md:2', NOTE_B);

    const view = editor.view();
    const end = view.state.doc.length;
    view.dispatch({ changes: { from: end, insert: '补充一句。' }, userEvent: 'input.type' });
    expect(onChange).toHaveBeenLastCalledWith(`${NOTE_B}补充一句。`);

    editor.pressUndo();
    expect(editor.view().state.doc.toString()).toBe(NOTE_B);
    expect(onChange).toHaveBeenLastCalledWith(NOTE_B);

    editor.pressUndo();
    expect(editor.view().state.doc.toString()).toBe(NOTE_B);
    expect(onChange).not.toHaveBeenCalledWith(NOTE_A);
  });

  it('keeps same-note content updates (e.g. find/replace) in sync and undoable', () => {
    const onChange = vi.fn();
    const editor = renderSourceEditor('日记/2026-09-23.md:2', NOTE_B, onChange);
    const replaced = NOTE_B.replace('日记', '笔记');

    editor.rerender('日记/2026-09-23.md:2', replaced);
    expect(editor.view().state.doc.toString()).toBe(replaced);

    editor.pressUndo();
    expect(editor.view().state.doc.toString()).toBe(NOTE_B);
    expect(onChange).toHaveBeenLastCalledWith(NOTE_B);
  });
});
