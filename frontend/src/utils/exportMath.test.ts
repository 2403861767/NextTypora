import { describe, expect, it } from 'vitest';
import { renderMathInExportedHtml } from './exportMath';

// V103-08：公式在编辑器里由 KaTeX 渲染，但导出 HTML/PDF 后会静默变成纯文本——
// 后端的 flexmark 根本没有数学扩展。这里在渲染进程用同一个 KaTeX 补上，输出 MathML。
describe('renderMathInExportedHtml', () => {
  it('把行内公式渲染成 MathML', () => {
    const out = renderMathInExportedHtml('<p>质能方程是 $E = mc^2$ 。</p>');

    expect(out).toContain('<math');
    expect(out).not.toContain('$E = mc^2$');
    expect(out).toContain('质能方程是');
  });

  it('把块级公式渲染成 display 模式', () => {
    const out = renderMathInExportedHtml('<p>$$\\int_0^1 x^2 dx$$</p>');

    expect(out).toContain('<math');
    expect(out).toContain('display="block"');
    expect(out).toContain('export-math--block');
  });

  // 自包含是本地优先的硬约束：ExportServiceTest 也断言导出不得引用 CDN
  it('不引入任何 CSS、JS 或外部资源', () => {
    const out = renderMathInExportedHtml('<p>$a^2$</p>');

    expect(out).not.toContain('cdn.');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<link');
    expect(out).not.toContain('stylesheet');
    // MathML 不需要 KaTeX 的字体文件
    expect(out).not.toContain('.woff');
  });

  it('不碰代码块里的 $，那不是公式', () => {
    const html = '<pre><code>echo "$HOME 和 $PATH"</code></pre>';

    expect(renderMathInExportedHtml(html)).toBe(html);
  });

  it('不碰行内代码里的 $', () => {
    const html = '<p>用 <code>$PATH</code> 查看，$x^2$ 才是公式。</p>';
    const out = renderMathInExportedHtml(html);

    expect(out).toContain('<code>$PATH</code>');
    expect(out).toContain('<math');
  });

  it('不把金额当公式', () => {
    const html = '<p>单价 $5 到 $10 不等。</p>';

    expect(renderMathInExportedHtml(html)).toBe(html);
  });

  it('没有公式时原样返回，不重写文档', () => {
    const html = '<p>一段普通正文。</p>';

    expect(renderMathInExportedHtml(html)).toBe(html);
  });

  it('同一段里的多条公式都渲染，周围文字保持原样', () => {
    const out = renderMathInExportedHtml('<p>由 $a$ 和 $b$ 可得 $c$ 。</p>');

    expect(out.match(/<math/g)).toHaveLength(3);
    expect(out).toContain('可得');
  });

  // 一条写坏的公式不应该让整次导出失败
  it('坏公式不会抛异常', () => {
    expect(() => renderMathInExportedHtml('<p>$\\frac{1}{$</p>')).not.toThrow();
  });

  // 有公式的文档会经 DOMParser 重新序列化，副作用是实体被归一化（&quot; → "）、
  // 行尾统一成 LF。两者对浏览器渲染等价，而且只影响"确实含公式"的文档——
  // 不含公式的文档上面那条用例保证是原样返回的。这里把这个取舍写成断言，免得将来被当成 bug。
  it('含公式的文档会被重新序列化：实体归一化，但结构与样式不变', () => {
    const before = '<!doctype html><html lang="zh-CN"><head><style>p{color:red}</style></head>'
      + '<body><p>$a^2$</p><pre><code>echo &quot;hi&quot;</code></pre></body></html>';
    const after = renderMathInExportedHtml(before);

    expect(after).toContain('<math');
    expect(after).toContain('lang="zh-CN"');
    expect(after).toContain('<style>p{color:red}</style>');
    // 代码块内容语义不变，只是引号不再写成实体
    expect(after).toContain('echo "hi"');
    expect(after).not.toContain('&quot;');
  });
});
