export interface MermaidBlock {
  id: string;
  index: number;
  code: string;
}

const MERMAID_FENCE = /^```[ \t]*mermaid(?:[ \t].*)?\n([\s\S]*?)^```[ \t]*$/gim;

export function parseMermaidBlocks(markdown: string): MermaidBlock[] {
  const normalized = (markdown || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks: MermaidBlock[] = [];
  let match: RegExpExecArray | null;

  while ((match = MERMAID_FENCE.exec(normalized)) !== null) {
    const code = stripTrailingNewline(match[1]);
    blocks.push({
      id: `mermaid-${blocks.length + 1}-${stableHash(code)}`,
      index: blocks.length + 1,
      code,
    });
  }

  return blocks;
}

function stripTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value.slice(0, -1) : value;
}

function stableHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}
