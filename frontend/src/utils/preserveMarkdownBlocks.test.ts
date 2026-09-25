import { beforeAll, describe, expect, it } from 'vitest';
import { Editor, defaultValueCtx, editorViewCtx, parserCtx, remarkStringifyOptionsCtx, rootCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { createMarkdownBlockPreserver, joinListsBySpread } from './preserveMarkdownBlocks';

// BUG_BACKLOG_REAL_WORLD.md RW-P1-002：用真实的 Milkdown 编辑器（commonmark + gfm，与 MarkdownEditor 相同的序列化配置）
// 和 ProseMirror 事务模拟“只改一处”的各种编辑，检查写回的 markdown 只有被编辑的地方变化

beforeAll(() => {
  if (!('IntersectionObserver' in window)) {
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
      },
    });
  }
});

async function createEditor(markdown: string) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      ctx.update(remarkStringifyOptionsCtx, (options) => ({
        ...options,
        bullet: '-' as const,
        join: [...(options.join ?? []), joinListsBySpread],
      }));
    })
    .use(commonmark)
    .use(gfm)
    .create();
}

/** 载入 markdown，执行 edit，返回保存时写回的 markdown，以及它是否与编辑器里的文档语义一致 */
async function editAndSerialize(markdown: string, edit: (view: EditorView) => void) {
  const editor = await createEditor(markdown);
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const preserver = createMarkdownBlockPreserver(ctx, markdown, view.state.doc);
    expect(preserver.serialize(view.state.doc)).toBe(markdown);
    edit(view);
    const output = preserver.serialize(view.state.doc);
    return { output, sameDocument: canonical(ctx, ctx.get(parserCtx)(output)) === canonical(ctx, view.state.doc) };
  });
}

function canonical(ctx: Ctx, doc: ProseNode): string {
  const nodes: ProseNode[] = [];
  doc.forEach((node) => {
    if (!(node.type.name === 'paragraph' && node.childCount === 0)) nodes.push(node);
  });
  return ctx.get(serializerCtx)(ctx.get(schemaCtx).topNodeType.create(null, nodes));
}

function positionAfterText(view: EditorView, text: string): number {
  let position = -1;
  view.state.doc.descendants((node, pos) => {
    if (position < 0 && node.isText && node.text?.includes(text)) position = pos + node.text.indexOf(text) + text.length;
  });
  expect(position).toBeGreaterThan(0);
  return position;
}

const appendAfter = (text: string, typed: string) => (view: EditorView) => {
  view.dispatch(view.state.tr.insertText(typed, positionAfterText(view, text)));
};

/** 在包含 text 的列表项后面插入一个新列表项（属性沿用该列表项，内容为 newText） */
const insertItemAfter = (text: string, newText: string) => (view: EditorView) => {
  const $pos = view.state.doc.resolve(positionAfterText(view, text));
  let depth = $pos.depth;
  while (depth > 0 && $pos.node(depth).type.name !== 'list_item') depth -= 1;
  const item = $pos.node(depth);
  const { schema } = view.state;
  const newItem = schema.nodes.list_item.create(item.attrs, schema.nodes.paragraph.create(null, schema.text(newText)));
  view.dispatch(view.state.tr.insert($pos.after(depth), newItem));
};

const setChecked = (text: string, checked: boolean) => (view: EditorView) => {
  const $pos = view.state.doc.resolve(positionAfterText(view, text));
  let depth = $pos.depth;
  while (depth > 0 && $pos.node(depth).type.name !== 'list_item') depth -= 1;
  view.dispatch(view.state.tr.setNodeMarkup($pos.before(depth), undefined, { ...$pos.node(depth).attrs, checked }));
};

const deleteTopLevel = (typeName: string) => (view: EditorView) => {
  let from = -1;
  let to = -1;
  view.state.doc.forEach((node, offset) => {
    if (from < 0 && node.type.name === typeName) {
      from = offset;
      to = offset + node.nodeSize;
    }
  });
  expect(from).toBeGreaterThanOrEqual(0);
  view.dispatch(view.state.tr.delete(from, to));
};

describe('createMarkdownBlockPreserver: structural edits change only what was edited', () => {
  it('toggling a task checkbox in a "*" task list changes only that checkbox', async () => {
    const md = '# 待办\n\n* [ ] 回归打包版\n* [ ] 更新文档\n';
    const { output } = await editAndSerialize(md, setChecked('回归打包版', true));
    expect(output).toBe('# 待办\n\n* [x] 回归打包版\n* [ ] 更新文档\n');
  });

  it('a new item added to a "*" list uses "*" and leaves the other items untouched', async () => {
    const md = '* alpha\n* beta\n    * nested\n';
    const { output } = await editAndSerialize(md, insertItemAfter('alpha', 'gamma'));
    expect(output).toBe('* alpha\n* gamma\n* beta\n    * nested\n');
  });

  it('a new last item of a "1)" list continues the numbering with ")"', async () => {
    const md = '1) plan\n2) code\n';
    const { output } = await editAndSerialize(md, insertItemAfter('code', 'test'));
    expect(output).toBe('1) plan\n2) code\n3) test\n');
  });

  it('editing inside a "~~~" code block keeps the tilde fence', async () => {
    const md = '# 构建\n\n~~~bash\nnpm run dist:dir\n~~~\n';
    const { output } = await editAndSerialize(md, appendAfter('dist:dir', ' --verbose'));
    expect(output).toBe('# 构建\n\n~~~bash\nnpm run dist:dir --verbose\n~~~\n');
  });

  it('editing an indented code block keeps it indented', async () => {
    const md = '说明：\n\n    // 缩进代码块\n    const x = 1;\n';
    const { output } = await editAndSerialize(md, appendAfter('const x = 1;', ' // ok'));
    expect(output).toBe('说明：\n\n    // 缩进代码块\n    const x = 1; // ok\n');
  });

  it('editing a list item inside a blockquote changes only that line', async () => {
    const md = '> 评审要点：\n>\n> * 先修 P1\n> * 再修 P2\n';
    const { output } = await editAndSerialize(md, appendAfter('先修 P1', ' ✓'));
    expect(output).toBe('> 评审要点：\n>\n> * 先修 P1 ✓\n> * 再修 P2\n');
  });

  it('editing an item of a loose "*" list keeps it loose and keeps the markers', async () => {
    const md = '* 第一项\n\n* 第二项\n';
    const { output } = await editAndSerialize(md, appendAfter('第二项', ' L'));
    expect(output).toBe('* 第一项\n\n* 第二项 L\n');
  });

  it('editing a list item of a CRLF note keeps every CRLF', async () => {
    const md = '# 结论\r\n\r\n* 先修 P1\r\n* 再修 P2\r\n';
    const { output } = await editAndSerialize(md, appendAfter('再修 P2', ' L'));
    expect(output).toBe('# 结论\r\n\r\n* 先修 P1\r\n* 再修 P2 L\r\n');
  });
});

describe('createMarkdownBlockPreserver: guards', () => {
  it('deleting the block next to a link definition still produces the same document', async () => {
    const md = '# Doc\n\nPara with [ref][r].\n\n***\n\n[r]: https://example.com\n\nEnd.\n';
    const { output, sameDocument } = await editAndSerialize(md, deleteTopLevel('hr'));
    expect(sameDocument).toBe(true);
    expect(output).toContain('https://example.com');
  });

  it('inserting and deleting paragraphs produces the same document', async () => {
    const md = '# 标题\n\n第一段。\n\n第二段。\n';
    const inserted = await editAndSerialize(md, (view) => {
      const { schema } = view.state;
      view.dispatch(view.state.tr.insert(view.state.doc.content.size, schema.nodes.paragraph.create(null, schema.text('新增段落。'))));
    });
    expect(inserted.sameDocument).toBe(true);
    expect(inserted.output).toContain('新增段落。');
    const deleted = await editAndSerialize(md, deleteTopLevel('heading'));
    expect(deleted.sameDocument).toBe(true);
    expect(deleted.output).not.toContain('# 标题');
  });

  it('moving a paragraph produces the same document', async () => {
    const md = '甲段。\n\n乙段。\n\n丙段。\n';
    const { output, sameDocument } = await editAndSerialize(md, (view) => {
      const first = view.state.doc.child(0);
      const tr = view.state.tr.delete(0, first.nodeSize);
      view.dispatch(tr.insert(tr.doc.content.size, first));
    });
    expect(sameDocument).toBe(true);
    expect(output.indexOf('甲段。')).toBeGreaterThan(output.indexOf('丙段。'));
  });

  it('keeps a backslash hard break in a document that uses backslash breaks', async () => {
    const md = '第一行\\\n第二行\n';
    const { output } = await editAndSerialize(md, appendAfter('第二行', ' X'));
    expect(output).toBe('第一行\\\n第二行 X\n');
  });
});
