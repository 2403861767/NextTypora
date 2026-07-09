import { describe, expect, it, vi } from 'vitest';
import { getCodeBlockPreviewKind, renderCodeBlockPreview } from './CodeBlockPreview';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg role="img"></svg>' })),
  },
}));

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

  it('applies async previews for multiple Mermaid blocks independently', async () => {
    const applyFirst = vi.fn();
    const applySecond = vi.fn();

    renderCodeBlockPreview('mermaid', 'graph TD\nA-->B', false, applyFirst);
    renderCodeBlockPreview('mermaid', 'graph TD\nC-->D', false, applySecond);

    await vi.waitFor(() => {
      expect(applyFirst).toHaveBeenCalledWith(expect.stringContaining('code-preview--mermaid'));
      expect(applySecond).toHaveBeenCalledWith(expect.stringContaining('code-preview--mermaid'));
    });
  });

  it('does not create preview panels for unknown languages or empty content', () => {
    expect(renderCodeBlockPreview('text', 'hello', false, vi.fn())).toBeNull();
    expect(renderCodeBlockPreview('latex', '   ', false, vi.fn())).toBeNull();
  });
});
