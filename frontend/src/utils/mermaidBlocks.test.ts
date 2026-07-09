import { describe, expect, it } from 'vitest';
import { parseMermaidBlocks } from './mermaidBlocks';

describe('parseMermaidBlocks', () => {
  it('extracts mermaid fenced code blocks', () => {
    const blocks = parseMermaidBlocks(`
# Demo

\`\`\`mermaid
graph TD
  A --> B
\`\`\`
`);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      index: 1,
      code: 'graph TD\n  A --> B',
    });
  });

  it('ignores non-mermaid code fences', () => {
    const blocks = parseMermaidBlocks(`
\`\`\`js
console.log('hello');
\`\`\`
`);

    expect(blocks).toHaveLength(0);
  });

  it('supports multiple diagrams and CRLF input', () => {
    const blocks = parseMermaidBlocks('```mermaid\r\ngraph LR\r\nA-->B\r\n```\r\n\r\n```MERMAID\r\nsequenceDiagram\r\nA->>B: hi\r\n```');

    expect(blocks.map((block) => block.code)).toEqual([
      'graph LR\nA-->B',
      'sequenceDiagram\nA->>B: hi',
    ]);
  });
});
