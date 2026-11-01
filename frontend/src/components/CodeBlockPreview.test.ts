import { describe, expect, it, vi } from 'vitest';
import { getCodeBlockPreviewKind, renderCodeBlockPreview } from './CodeBlockPreview';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg role="img"></svg>' })),
  },
}));

/**
 * 推进事件循环直到 done() 成立，最多 turns 轮。等的是"调度轮次"而不是一段墙上时间：
 * 每轮只让出一次事件循环，所以总耗时取决于被等的工作本身，而不取决于一个写死的超时值。
 */
async function flushUntil(done: () => boolean, turns = 50) {
  for (let i = 0; i < turns && !done(); i += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }
}

describe('CodeBlockPreview', () => {
  it('identifies preview kinds by fenced code language', () => {
    expect(getCodeBlockPreviewKind('LaTeX')?.label).toBe('LaTeX 预览');
    expect(getCodeBlockPreviewKind('tex')?.label).toBe('LaTeX 预览');
    expect(getCodeBlockPreviewKind('mermaid')?.label).toBe('Mermaid 预览');
    expect(getCodeBlockPreviewKind('text')).toBeNull();
  });

  it('renders LaTeX with a LaTeX preview class instead of Mermaid', () => {
    const result = renderCodeBlockPreview('latex', 'x^2 + y^2', false, vi.fn());

    expect(result).toContain('code-preview--latex');
    expect(result).toContain('LaTeX 预览');
    expect(result).toContain('katex-display');
    expect(result).not.toContain('code-preview--mermaid');
    expect(result).not.toContain('Mermaid');
  });

  it('renders Mermaid loading with a Mermaid preview class', () => {
    const result = renderCodeBlockPreview('mermaid', 'graph TD\\nA-->B', false, vi.fn());

    expect(result).toContain('code-preview--mermaid');
    expect(result).toContain('Mermaid 预览');
    expect(result).toContain('正在渲染 Mermaid');
    expect(result).not.toContain('code-preview--latex');
  });

  it('emits exactly one preview title per preview shell', () => {
    const latex = renderCodeBlockPreview('latex', 'a+b', false, vi.fn());
    const mermaid = renderCodeBlockPreview('mermaid', 'graph TD\\nA-->B', false, vi.fn());

    expect(latex?.match(/LaTeX 预览/g)).toHaveLength(1);
    expect(mermaid?.match(/Mermaid 预览/g)).toHaveLength(1);
    expect(latex).not.toContain('预览预览');
    expect(mermaid).not.toContain('预览预览');
  });

  /*
   * 这条用例在空载下也要约 1.6 秒，而同文件其他用例都是 0–4ms。实测（2026-11-01）：
   *   import=0ms render=0ms flush=1601ms turns=2
   * 即时间全花在让出事件循环上，每轮约 800ms，且与等待方式无关（换成 vi.waitFor 同样 1.65 秒）。
   * 根因未查明——预先 `await import('mermaid')` 和在 beforeAll 里预热并抽干都没有缩短它。
   * 因此这里只消除 flaky，不假装修好了慢：
   *   - 等待改成按"调度轮次"推进而不是轮询墙上时间，失败时给出真实的断言差异而不是 waitFor 超时；
   *   - 给这一条显式的 30 秒超时。它平时 1.6 秒就结束，所以这个值只在机器被压满时起作用，
   *     而全局 testTimeout 仍是 5 秒，不牵连其余 189 条用例的反馈速度。
   * 不要把这个超时搬到全局配置里，那会让将来真正卡死的用例也慢 6 倍才报错。
   */
  it('applies async previews for multiple Mermaid blocks independently', async () => {
    const applyFirst = vi.fn();
    const applySecond = vi.fn();

    renderCodeBlockPreview('mermaid', 'graph TD\nA-->B', false, applyFirst);
    renderCodeBlockPreview('mermaid', 'graph TD\nC-->D', false, applySecond);

    await flushUntil(() => applyFirst.mock.calls.length > 0 && applySecond.mock.calls.length > 0);

    expect(applyFirst).toHaveBeenCalledWith(expect.stringContaining('code-preview--mermaid'));
    expect(applySecond).toHaveBeenCalledWith(expect.stringContaining('code-preview--mermaid'));
  }, 30000);

  it('does not create preview panels for unknown languages or empty content', () => {
    expect(renderCodeBlockPreview('text', 'hello', false, vi.fn())).toBeNull();
    expect(renderCodeBlockPreview('latex', '   ', false, vi.fn())).toBeNull();
  });
});
