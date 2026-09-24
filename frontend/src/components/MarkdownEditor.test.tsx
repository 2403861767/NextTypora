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
});
