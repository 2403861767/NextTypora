import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from './MarkdownEditor';

describe('MarkdownEditor', () => {
  it('reports the loaded note through onReady and the very first edit through onChange', async () => {
    const onReady = vi.fn();
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        value={'# 标题\n\n第一段正文'}
        onChange={onChange}
        onReady={onReady}
        noteKey="note.md:0"
        notePath="note.md"
        spellCheckEnabled={false}
        isDark={false}
      />,
    );

    // 载入时就上报规范化后的内容，而不是等到用户第一次编辑
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(onReady.mock.calls[0][0]).toContain('第一段正文');
    expect(onChange).not.toHaveBeenCalled();

    // 模拟用户第一次输入：ProseMirror 通过 MutationObserver 读取 DOM 改动并派发事务
    const paragraph = container.querySelector('.ProseMirror p');
    const text = paragraph?.firstChild;
    expect(text?.nodeType).toBe(Node.TEXT_NODE);
    (text as Text).data += '，追加内容';

    await waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 5000 });
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('第一段正文，追加内容');
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  describe('YAML frontmatter', () => {
    // BUG_BACKLOG_REAL_WORLD.md RW-P0-003 中的 读书笔记/frontmatter.md
    const FRONTMATTER = '---\ntitle: 人月神话读书笔记\ntags: [读书, 软件工程]\nauthor: Brooks\n---\n\n';
    const NOTE = `${FRONTMATTER}# 人月神话\n\n没有银弹。\n`;

    function renderNote(value: string) {
      const onReady = vi.fn();
      const onChange = vi.fn();
      const view = render(
        <MarkdownEditor
          value={value}
          onChange={onChange}
          onReady={onReady}
          noteKey="读书笔记/frontmatter.md:0"
          notePath="读书笔记/frontmatter.md"
          spellCheckEnabled={false}
          isDark={false}
        />,
      );
      return { ...view, onReady, onChange };
    }

    it('keeps the frontmatter verbatim on load and shows it as metadata instead of an hr + heading', async () => {
      const { container, onReady } = renderNote(NOTE);

      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 5000 });
      const loaded: string = onReady.mock.calls[0][0];
      expect(loaded.slice(0, FRONTMATTER.length)).toBe(FRONTMATTER);
      expect(loaded).not.toContain('***');
      expect(loaded).not.toContain('\\[');
      expect(loaded).not.toContain('-----');

      // 正文里不能出现由 frontmatter 变成的分隔线和 setext 标题
      expect(container.querySelector('.ProseMirror hr')).toBeNull();
      const headings = Array.from(container.querySelectorAll('.ProseMirror h1, .ProseMirror h2'));
      expect(headings.map((heading) => heading.textContent)).toEqual(['人月神话']);

      const metadata = container.querySelector('.typora-frontmatter');
      expect(metadata?.textContent).toContain('title: 人月神话读书笔记');
      expect(metadata?.textContent).toContain('author: Brooks');
    });

    it('writes the untouched frontmatter back together with the first WYSIWYG edit', async () => {
      const { container, onReady, onChange } = renderNote(NOTE);
      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 5000 });

      const paragraphs = container.querySelectorAll('.ProseMirror p');
      const text = paragraphs[paragraphs.length - 1]?.firstChild;
      expect(text?.nodeType).toBe(Node.TEXT_NODE);
      expect(text?.textContent).toBe('没有银弹。');
      (text as Text).data += '（摘录）';

      await waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 5000 });
      const saved: string = onChange.mock.calls.at(-1)?.[0];
      expect(saved.slice(0, FRONTMATTER.length)).toBe(FRONTMATTER);
      const body = saved.slice(FRONTMATTER.length);
      expect(body).toContain('# 人月神话');
      expect(body).toContain('没有银弹。（摘录）');
      // frontmatter 只出现一次，没有被复制进正文
      expect(body).not.toContain('title:');
      expect(body).not.toContain('author: Brooks');
    });

    it('keeps CRLF line endings inside the frontmatter', async () => {
      const crlfFrontmatter = '---\r\ntitle: CRLF 笔记\r\nauthor: Brooks\r\n---\r\n\r\n';
      const { onReady } = renderNote(`${crlfFrontmatter}正文段落\r\n`);

      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 5000 });
      const loaded: string = onReady.mock.calls[0][0];
      expect(loaded.slice(0, crlfFrontmatter.length)).toBe(crlfFrontmatter);
      expect(loaded.slice(crlfFrontmatter.length)).toContain('正文段落');
    });
  });
});
