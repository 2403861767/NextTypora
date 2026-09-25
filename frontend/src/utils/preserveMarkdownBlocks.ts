import type { Ctx } from '@milkdown/kit/ctx';
import { parserCtx, remarkCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';

/**
 * Milkdown 每次都把整篇文档重新序列化：setext 标题变 ATX、列表符号和松紧、表格对齐、两个空格的硬换行、
 * 文件结尾都会被改写（RW-P1-002）。这里让没有被编辑的顶层块原样沿用磁盘上的文本，只有改动过的块才重新序列化。
 */
export interface MarkdownBlockPreserver {
  serialize: (doc: ProseNode) => string;
}

interface SourceRange {
  start: number;
  end: number;
}

interface Piece {
  text: string;
  /** 沿用原文的块：它在载入时文档中的下标 */
  index?: number;
}

interface PositionedNode {
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/**
 * 建立对应关系需要额外解析约三遍原文（约 0.9ms / 千字符）。超过这个长度的文件跳过，保持整篇重新序列化，
 * 避免打开超大文件时明显卡顿。
 */
const MAX_PRESERVED_SOURCE_LENGTH = 200_000;

function isEmptyParagraph(node: ProseNode): boolean {
  return node.type.name === 'paragraph' && node.childCount === 0;
}

/**
 * @param source 载入时交给编辑器的 markdown（不含 frontmatter）
 * @param baseDoc 编辑器载入 source 后的文档；之后未改动的顶层节点与它共享同一个对象
 * @param normalizeSerialized 只作用于重新序列化出来的文本
 */
export function createMarkdownBlockPreserver(
  ctx: Ctx,
  source: string,
  baseDoc: ProseNode,
  normalizeSerialized: (markdown: string) => string = (markdown) => markdown,
): MarkdownBlockPreserver {
  const parse = ctx.get(parserCtx);
  const serializer = ctx.get(serializerCtx);
  const schema = ctx.get(schemaCtx);

  const serializeNodes = (nodes: ProseNode[]): string => (
    normalizeSerialized(serializer(schema.topNodeType.create(null, nodes)).replace(/\n$/, ''))
  );

  // 空段落（如编辑器自动补在末尾的段落）在 markdown 里没有对应内容，输出时直接略过
  const serializeAll = (doc: ProseNode): string => {
    const nodes: ProseNode[] = [];
    doc.forEach((node) => {
      if (!isEmptyParagraph(node)) nodes.push(node);
    });
    const text = nodes.length > 0 ? serializeNodes(nodes) : '';
    return text ? `${text}\n` : '';
  };

  // 载入时每个顶层块对应的原文位置。用与 Milkdown 解析器相同的 remark 流程拿到位置，
  // 并且只有单独解析这段原文能得到同一个块时才沿用（引用式链接、脚注引用等依赖上下文的块会被排除）
  const ranges: Array<SourceRange | null> = [];
  let sourceBlockCount = 0;
  try {
    if (source.length <= MAX_PRESERVED_SOURCE_LENGTH) {
      const remark = ctx.get(remarkCtx);
      const tree = remark.runSync(remark.parse(source), source) as unknown as { children: PositionedNode[] };
      const fullDoc = parse(source);
      sourceBlockCount = tree.children.length;
      if (fullDoc.childCount === sourceBlockCount && baseDoc.childCount >= sourceBlockCount) {
        tree.children.forEach((node, index) => {
          const start = node.position?.start.offset;
          const end = node.position?.end.offset;
          const parsed = fullDoc.child(index);
          const loaded = baseDoc.child(index);
          if (start === undefined || end === undefined || loaded.type !== parsed.type || !loaded.content.eq(parsed.content)) {
            ranges.push(null);
            return;
          }
          const alone = parse(source.slice(start, end));
          ranges.push(alone.childCount === 1 && alone.firstChild?.eq(parsed) ? { start, end } : null);
        });
      }
    }
  } catch {
    ranges.length = 0;
  }

  const baseIndex = new Map<ProseNode, number>();
  ranges.forEach((range, index) => {
    if (range) baseIndex.set(baseDoc.child(index), index);
  });

  const blockCount = (text: string): number => parse(text).childCount;

  return {
    serialize(doc) {
      if (baseIndex.size === 0) return serializeAll(doc);

      const pieces: Piece[] = [];
      let run: ProseNode[] = [];
      const flushRun = () => {
        const nodes = run.filter((node) => !isEmptyParagraph(node));
        run = [];
        if (nodes.length > 0) pieces.push({ text: serializeNodes(nodes) });
      };

      // 按顺序匹配未改动的块：同一个节点对象（ProseMirror 会复用没改过的节点），或与下一个原始块完全相同（如撤销）
      let next = 0;
      doc.forEach((node) => {
        let index = baseIndex.get(node);
        if (index === undefined && ranges[next] && baseDoc.child(next).eq(node)) index = next;
        if (index !== undefined && index >= next) {
          flushRun();
          const range = ranges[index]!;
          pieces.push({ text: source.slice(range.start, range.end), index });
          next = index + 1;
        } else {
          run.push(node);
        }
      });
      flushRun();
      if (pieces.length === 0) return '';

      const first = pieces[0];
      let output = first.index === 0 ? source.slice(0, ranges[0]!.start) : '';
      output += first.text;
      for (let i = 1; i < pieces.length; i += 1) {
        const previous = pieces[i - 1];
        const piece = pieces[i];
        if (previous.index !== undefined && piece.index === previous.index + 1) {
          // 原文中本来就相邻：沿用原来的空行
          output += source.slice(ranges[previous.index]!.end, ranges[piece.index]!.start);
        } else {
          // 新的衔接处用空行分隔，并确认前后两段没有因此合并（如两个相邻列表、列表后的缩进代码）；否则整篇重新序列化
          if (blockCount(`${previous.text}\n\n${piece.text}`) !== blockCount(previous.text) + blockCount(piece.text)) {
            return serializeAll(doc);
          }
          output += '\n\n';
        }
        output += piece.text;
      }
      const last = pieces[pieces.length - 1];
      output += last.index !== undefined && last.index === sourceBlockCount - 1 ? source.slice(ranges[last.index]!.end) : '\n';
      return output;
    },
  };
}

type JoinNode = { type: string; spread?: unknown };

/**
 * Milkdown 7.21 把 bullet_list / list_item 的 spread 以字符串 "true"/"false" 交给 remark-stringify，
 * 而 mdast-util-to-markdown 只认布尔值，于是所有紧凑列表都被写成松散列表。这里按字符串的实际含义连接。
 */
export function joinListsBySpread(left: JoinNode, right: JoinNode, parent: JoinNode): number | undefined {
  if ((parent.type !== 'list' && parent.type !== 'listItem') || typeof parent.spread !== 'string') return undefined;
  // 与默认规则一致：两个段落之间必须有空行，否则会合并成一段
  if (left.type === 'paragraph' && right.type === 'paragraph') return undefined;
  return parent.spread === 'true' ? 1 : 0;
}
