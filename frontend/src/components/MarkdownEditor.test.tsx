import { render, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
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

  // BUG_BACKLOG_REAL_WORLD.md RW-P1-001：markdownUpdated 有 200ms 防抖，切换/关闭前 App 需要能同步取到尚未上报的修改
  it('exposes edits that are still inside the change debounce through pendingMarkdownRef', async () => {
    const pendingMarkdownRef: Parameters<typeof MarkdownEditor>[0]['pendingMarkdownRef'] = { current: null };
    const onReady = vi.fn();
    const onChange = vi.fn();
    const { container, unmount } = render(
      <MarkdownEditor
        value={'# 标题\n\n第一段正文'}
        onChange={onChange}
        onReady={onReady}
        noteKey="note.md:3"
        notePath="note.md"
        spellCheckEnabled={false}
        isDark={false}
        pendingMarkdownRef={pendingMarkdownRef}
      />,
    );
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(pendingMarkdownRef?.current?.noteKey).toBe('note.md:3');
    expect(pendingMarkdownRef?.current?.read()).toBeUndefined();

    const text = container.querySelector('.ProseMirror p')?.firstChild as Text;
    text.data += '，追加内容';
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 还没有通过 onChange 上报，但已经能同步读到
    expect(onChange).not.toHaveBeenCalled();
    expect(pendingMarkdownRef?.current?.read()).toContain('第一段正文，追加内容');

    // 上报之后就没有“未上报”的内容了
    await waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 5000 });
    expect(pendingMarkdownRef?.current?.read()).toBeUndefined();

    unmount();
    expect(pendingMarkdownRef?.current).toBeNull();
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

  // BUG_BACKLOG_REAL_WORLD.md RW-P1-002：第一次编辑就把整篇文件重新格式化（硬换行、列表、标题、表格、文件结尾…）
  describe('keeps untouched markdown byte-for-byte', () => {
    // 测试用 ascii-notes.md 的原始内容（test/e2e-vault），第 35 行带两个尾随空格的硬换行
    const ASCII_NOTES = [
      'Markdown Syntax Coverage',
      '========================',
      '',
      'Setext heading above, *emphasis* with stars and __strong__ with underscores.',
      '',
      '* star bullet one',
      '* star bullet two',
      '    * nested with four spaces',
      '',
      '+ plus bullet',
      '',
      '1) paren ordered',
      '2) second',
      '',
      '| Left | Center | Right |',
      '|:-----|:------:|------:|',
      '| a    |   b    |     c |',
      '',
      '```js',
      'console.log("code block");',
      '```',
      '',
      '- [ ] task open',
      '- [x] task done',
      '',
      'Footnote reference[^1].',
      '',
      '[^1]: The footnote text.',
      '',
      'Line with trailing double space  ',
      'hard break above.',
      '',
      '<div align="center">raw html block</div>',
      '',
      '***',
      '',
      'Final paragraph with a [link](https://example.com "title") and an ![image](missing.png).',
      '',
    ].join('\n');

    beforeAll(() => {
      // Crepe 的代码块组件依赖 IntersectionObserver，jsdom 没有
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

    function renderNote(value: string, noteKey: string) {
      const onReady = vi.fn();
      const onChange = vi.fn();
      const view = render(
        <MarkdownEditor
          value={value}
          onChange={onChange}
          onReady={onReady}
          noteKey={noteKey}
          notePath="ascii-notes.md"
          spellCheckEnabled={false}
          isDark={false}
        />,
      );
      return { ...view, onReady, onChange };
    }

    /** 在文本以 startsWith 开头的段落（或 selector 指定的块）末尾输入（改的是最后一个文本节点） */
    function typeAtEndOf(container: HTMLElement, startsWith: string, typed: string, selector = 'p') {
      const paragraph = Array.from(container.querySelectorAll(`.ProseMirror ${selector}`))
        .find((element) => element.textContent?.startsWith(startsWith));
      const text = paragraph?.lastChild;
      expect(text?.nodeType).toBe(Node.TEXT_NODE);
      (text as Text).data += typed;
    }

    it('reports the loaded note exactly as it is on disk', async () => {
      const { onReady } = renderNote(ASCII_NOTES, 'ascii-notes.md:load');

      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 5000 });
      expect(onReady.mock.calls[0][0]).toBe(ASCII_NOTES);
    });

    it('changes only the edited line on the first edit', async () => {
      const { container, onReady, onChange } = renderNote(ASCII_NOTES, 'ascii-notes.md:edit-paragraph');
      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 5000 });

      typeAtEndOf(container, 'Setext heading above', ' X');

      await waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 5000 });
      expect(onChange.mock.calls.at(-1)?.[0]).toBe(ASCII_NOTES.replace('underscores.', 'underscores. X'));
    });

    it('editing a tight task list keeps it tight with its "-" markers and leaves everything else untouched', async () => {
      const { container, onReady, onChange } = renderNote(ASCII_NOTES, 'ascii-notes.md:edit-list');
      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 5000 });

      typeAtEndOf(container, 'task open', ' Y');

      await waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 5000 });
      expect(onChange.mock.calls.at(-1)?.[0]).toBe(ASCII_NOTES.replace('- [ ] task open', '- [ ] task open Y'));
    });

    it('never merges an edited list into a neighbouring list', async () => {
      // 两个相邻列表因为符号不同才是两个列表；重新序列化被编辑的那个时不能让它们合并成一个
      const { container, onReady, onChange } = renderNote('- a\n\n+ b\n', 'lists.md:0');
      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 5000 });

      typeAtEndOf(container, 'b', ' X');

      await waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 5000 });
      expect(onChange.mock.calls.at(-1)?.[0]).toMatch(/^([-*+]) a\n\n(?!\1)[-*+] b X\n$/);
    });

    // 打包版复测（test/p1-verify-evidence/REPORT.md）发现：被编辑的块本身仍会按 Milkdown 的规范格式整块重写
    describe('the edited block keeps its own formatting', () => {
      const READING_NOTES = [
        '# 《人月神话》读书笔记',
        '',
        '## 关键观点',
        '',
        '* 没有银弹',
        '* 向进度落后的项目增加人手，只会让它更加落后',
        '    * 沟通成本随人数平方增长',
        '    * 新人需要培训时间',
        '* 概念完整性最重要',
        '',
        '+ 外科手术队伍',
        '',
      ].join('\n');
      const MEETING_CRLF = [
        '# 会议纪要 2026-09-25',
        '',
        '参会：张三、李四、王五',
        '',
        '| 议题 | 负责人 | 截止 |',
        '|:-----|:------:|-----:|',
        '| 打包验证 | 张三 | 9/26 |',
        '',
        '- 先修 P1',
        '- 再修 P2',
        '',
      ].join('\r\n');
      const TECH_DOC = [
        '# 同步服务设计',
        '',
        '注意事项见[设计文档][design]和脚注[^1]。',
        '',
        '需要修改的一行说明。',
        '',
        '***',
        '',
        '[design]: https://example.com/design "设计文档"',
        '[^1]: 这是脚注内容。',
        '',
      ].join('\n');
      const CONTACTS = ['# 通讯录', '', '地址：上海市浦东新区  ', '电话：021-12345678', '', '- 备注', ''].join('\n');
      const SETEXT = ['项目总览', '========', '', '第一章', '------', '', '正文内容。', ''].join('\n');
      const TABLE = [
        '| 议题 | 负责人 | 截止 |',
        '|:-----|:------:|-----:|',
        '| 打包验证 | 张三 | 9/26 |',
        '| 文档更新 | 李四 | 9/30 |',
        '',
      ].join('\n');

      async function editAndSave(value: string, key: string, startsWith: string, typed: string, selector?: string) {
        const { container, onReady, onChange } = renderNote(value, key);
        await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 5000 });
        expect(onReady.mock.calls[0][0]).toBe(value);
        typeAtEndOf(container, startsWith, typed, selector);
        await waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 5000 });
        return onChange.mock.calls.at(-1)?.[0] as string;
      }

      it('editing one item of a "*" list with 4-space sub-items changes only that line', async () => {
        const saved = await editAndSave(READING_NOTES, 'reading:item', '没有银弹', ' EDIT2');
        expect(saved).toBe(READING_NOTES.replace('* 没有银弹', '* 没有银弹 EDIT2'));
      });

      it('editing a nested item changes only that line', async () => {
        const saved = await editAndSave(READING_NOTES, 'reading:nested', '新人需要培训时间', ' N');
        expect(saved).toBe(READING_NOTES.replace('    * 新人需要培训时间', '    * 新人需要培训时间 N'));
      });

      it('keeps CRLF line endings everywhere when a paragraph of a CRLF note is edited', async () => {
        const saved = await editAndSave(MEETING_CRLF, 'meeting:crlf', '参会：', ' EDIT3');
        expect(saved).toBe(MEETING_CRLF.replace('王五', '王五 EDIT3'));
      });

      it('leaves an untouched reference-style link paragraph alone', async () => {
        const saved = await editAndSave(TECH_DOC, 'tech:ref', '需要修改的一行说明', ' EDIT4');
        expect(saved).toBe(TECH_DOC.replace('需要修改的一行说明。', '需要修改的一行说明。 EDIT4'));
      });

      it('keeps a two-space hard break inside the edited paragraph', async () => {
        const saved = await editAndSave(CONTACTS, 'contacts:hb', '地址：', ' EDIT5');
        expect(saved).toBe(CONTACTS.replace('021-12345678', '021-12345678 EDIT5'));
      });

      it('keeps an edited setext heading in setext style', async () => {
        const saved = await editAndSave(SETEXT, 'setext:h2', '第一章', ' EDIT6', 'h2');
        expect(saved).toBe(SETEXT.replace('第一章', '第一章 EDIT6'));
      });

      it('editing a table cell changes only that row', async () => {
        const saved = await editAndSave(TABLE, 'table:cell', '打包验证', ' X');
        expect(saved).toBe(TABLE.replace('| 打包验证 | 张三 | 9/26 |', '| 打包验证 X | 张三 | 9/26 |'));
      });
    });
  });
});
