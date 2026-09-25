import type { Ctx } from '@milkdown/kit/ctx';
import { parserCtx, remarkCtx, remarkStringifyOptionsCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';

/**
 * Milkdown 每次都把整篇文档重新序列化：setext 标题变 ATX、列表符号和松紧、表格对齐、两个空格的硬换行、
 * 文件结尾、行尾都会被改写（RW-P1-002）。这里让没有被编辑的部分原样沿用磁盘上的文本，只有改动过的内容才重新序列化。
 */
export interface MarkdownBlockPreserver {
  serialize: (doc: ProseNode) => string;
  /** 文档里已有的硬换行写法，重新序列化时沿用 */
  hardBreakStyle: HardBreakStyle;
}

export type HardBreakStyle = 'spaces' | 'backslash';

interface MdNode {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MdNode[];
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

/**
 * 建立对应关系需要额外解析约三遍原文（约 0.9ms / 千字符）。超过这个长度的文件跳过，保持整篇重新序列化，
 * 避免打开超大文件时明显卡顿。
 */
const MAX_PRESERVED_SOURCE_LENGTH = 200_000;

function isEmptyParagraph(node: ProseNode): boolean {
  return node.type.name === 'paragraph' && node.childCount === 0;
}

const hasPosition = (node: MdNode): boolean => node.position?.start.offset !== undefined && node.position?.end.offset !== undefined;
const startOf = (node: MdNode): number => node.position!.start.offset!;
const endOf = (node: MdNode): number => node.position!.end.offset!;

/**
 * @param source 载入时交给编辑器的 markdown（不含 frontmatter）
 * @param baseDoc 编辑器载入 source 后的文档；之后未改动的节点与它共享同一个对象
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

  // 全文都是 CRLF 时，重新序列化出来的文本也用 CRLF，避免出现混合行尾
  const crlf = source.includes('\r\n') && !/(^|[^\r])\n/.test(source);
  const eol = crlf ? '\r\n' : '\n';
  const toEol = (text: string): string => (crlf ? text.replace(/\r?\n/g, '\r\n') : text);

  const serializeRaw = (nodes: ProseNode[]): string => serializer(schema.topNodeType.create(null, nodes)).replace(/\n$/, '');
  const serializeNodes = (nodes: ProseNode[]): string => toEol(normalizeSerialized(serializeRaw(nodes)));
  const nonEmptyChildren = (doc: ProseNode): ProseNode[] => {
    const nodes: ProseNode[] = [];
    doc.forEach((node) => {
      if (!isEmptyParagraph(node)) nodes.push(node);
    });
    return nodes;
  };

  // 空段落（如编辑器自动补在末尾的段落）在 markdown 里没有对应内容，输出时直接略过
  const serializeAll = (doc: ProseNode): string => {
    const nodes = nonEmptyChildren(doc);
    const text = nodes.length > 0 ? serializeNodes(nodes) : '';
    return text ? `${text}${eol}` : '';
  };

  // 用于判断两份 markdown 是否表示同一篇文档：都按 Milkdown 的规范格式序列化后比较
  const canonical = (doc: ProseNode): string => {
    const nodes = nonEmptyChildren(doc);
    return nodes.length > 0 ? normalizeSerialized(serializeRaw(nodes)) : '';
  };

  // 载入时每个顶层块对应的原文位置。用与 Milkdown 解析器相同的 remark 流程拿到位置。
  // standalone：单独解析这段原文能得到同一个块（v1 只沿用这些块）；
  // inContext：附上全文的链接定义和脚注定义后能得到同一个块（引用式链接、脚注引用所在的段落）
  let blocks: MdNode[] = [];
  const standalone: boolean[] = [];
  const inContext: boolean[] = [];
  let hardBreakStyle: HardBreakStyle = 'backslash';
  try {
    if (source.length <= MAX_PRESERVED_SOURCE_LENGTH) {
      const remark = ctx.get(remarkCtx);
      const tree = remark.runSync(remark.parse(source), source) as unknown as MdNode;
      const children = tree.children ?? [];
      const fullDoc = parse(source);
      if (fullDoc.childCount === children.length && baseDoc.childCount >= children.length) {
        blocks = children;
        hardBreakStyle = detectHardBreakStyle(tree, source);
        const positioned = blocks.every(hasPosition);
        const definitions = positioned ? separatorsOf(blocks, source).map((text) => text.trim()).filter(Boolean) : [];
        const footnoteDefinitions = blocks.filter((node) => node.type === 'footnoteDefinition' && hasPosition(node));
        const context = [...definitions, ...footnoteDefinitions.map((node) => source.slice(startOf(node), endOf(node)))].join('\n\n');
        blocks.forEach((node, index) => {
          const parsed = fullDoc.child(index);
          const loaded = baseDoc.child(index);
          if (!hasPosition(node) || loaded.type !== parsed.type || !loaded.content.eq(parsed.content)) {
            standalone.push(false);
            inContext.push(false);
            return;
          }
          const slice = source.slice(startOf(node), endOf(node));
          const alone = parse(slice);
          const ok = alone.childCount === 1 && Boolean(alone.firstChild?.eq(parsed));
          standalone.push(ok);
          if (ok || !context) {
            inContext.push(ok);
            return;
          }
          const withContext = parse(`${slice}\n\n${context}`);
          inContext.push(withContext.childCount === 1 + footnoteDefinitions.length && Boolean(withContext.firstChild?.eq(parsed)));
        });
      }
    }
  } catch {
    blocks = [];
    standalone.length = 0;
    inContext.length = 0;
  }

  const v2Enabled = blocks.length > 0 && blocks.every(hasPosition);
  const serializeV1 = createV1(standalone);

  return {
    hardBreakStyle,
    serialize(doc) {
      if (blocks.length === 0) return serializeAll(doc);
      if (v2Enabled) {
        let output: string | null = null;
        try {
          output = serializeV2(doc);
        } catch {
          output = null;
        }
        // 细粒度的结果只有在重新解析后与编辑器里的文档完全一致时才采用，否则退回按顶层块沿用的做法
        if (output !== null && canonical(parse(output)) === canonical(doc)) return output;
      }
      return serializeV1(doc);
    },
  };

  // ---------------- v1：按顶层块沿用原文，改动过的块整块重新序列化 ----------------

  function createV1(verified: boolean[]) {
    const ranges: Array<SourceRange | null> = blocks.map((node, index) => (
      verified[index] ? { start: startOf(node), end: endOf(node) } : null
    ));
    const baseIndex = new Map<ProseNode, number>();
    ranges.forEach((range, index) => {
      if (range) baseIndex.set(baseDoc.child(index), index);
    });
    const blockCount = (text: string): number => parse(text).childCount;

    return (doc: ProseNode): string => {
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
          output += eol + eol;
        }
        output += piece.text;
      }
      const last = pieces[pieces.length - 1];
      output += last.index !== undefined && last.index === blocks.length - 1 ? source.slice(ranges[last.index]!.end) : eol;
      return output;
    };
  }

  // ---------------- v2：沿用原来的分隔文本，并深入列表、引用、表格，只重写真正改动的部分 ----------------

  function serializeV2(doc: ProseNode): string {
    return assemble(
      doc,
      baseDoc,
      blocks,
      source.slice(0, startOf(blocks[0])),
      source.slice(endOf(blocks[blocks.length - 1])),
      eol + eol,
      (index) => inContext[index],
      (node, index) => renderNode(node, baseDoc.child(index), blocks[index], inContext[index]),
      (nodes) => serializeNodes(nodes),
    );
  }

  /**
   * 拼接一个容器（文档、列表、引用）的子节点。kids 与 base 的子节点一一对应。
   * 未改动的子节点输出原文；原文中相邻的两块之间沿用原来的分隔文本；
   * 在原位置被修改的子节点交给 renderInPlace，新增的交给 renderRun，删除时保留被丢弃分隔文本里的链接定义。
   */
  function assemble(
    node: ProseNode,
    base: ProseNode,
    kids: MdNode[],
    lead: string,
    trail: string,
    blank: string,
    keepable: (index: number) => boolean,
    renderInPlace: (child: ProseNode, index: number) => string,
    renderRun: (nodes: ProseNode[]) => string,
  ): string {
    const count = kids.length;
    // seps[i] 是第 i 个子节点前面的文本，seps[count] 是最后一个子节点之后的文本
    const seps = [lead, ...kids.slice(1).map((kid, i) => source.slice(endOf(kids[i]), startOf(kid))), trail];
    // 只有文档顶层的分隔文本里会有链接定义；列表、引用内部的分隔文本含缩进和 > 等容器语法，不能搬动
    const carried = (from: number, to: number): string => (
      base === baseDoc ? seps.slice(from, to).map((text) => text.trim()).filter(Boolean).join(eol) : ''
    );

    let output = '';
    let previous = -1;
    let run: ProseNode[] = [];
    const gap = (a: number, b: number): string => {
      const nodes = run.filter((child) => !isEmptyParagraph(child));
      run = [];
      const replaced = b - a - 1;
      if (nodes.length === 0) {
        if (replaced === 0) return seps[b];
        // 删除：保留原来的分隔文本，被丢弃的分隔文本里如果有链接定义则一并保留
        const keepTrail = b === count;
        const kept = keepTrail ? seps[count] : seps[a + 1];
        const definitions = keepTrail ? carried(a + 1, count) : carried(a + 2, b + 1);
        if (!definitions) return kept;
        return keepTrail ? (a === -1 ? '' : blank) + definitions + kept : kept + definitions + blank;
      }
      const body = nodes.length === replaced
        ? nodes.map((child, j) => (j > 0 ? seps[a + 1 + j] : '') + renderInPlace(child, a + 1 + j)).join('')
        : renderRun(nodes);
      if (replaced === 0) return b === count ? blank + body + seps[count] : seps[a + 1] + body + blank;
      const definitions = nodes.length === replaced ? '' : carried(a + 2, b);
      return seps[a + 1] + body + (definitions ? blank + definitions : '') + seps[b];
    };

    const idx = new Map<ProseNode, number>();
    for (let i = 0; i < base.childCount; i += 1) if (keepable(i)) idx.set(base.child(i), i);
    let next = 0;
    node.forEach((child) => {
      let k = idx.get(child);
      if (k === undefined && next < base.childCount && keepable(next) && base.child(next).eq(child)) k = next;
      if (k !== undefined && k >= next) {
        output += gap(previous, k) + source.slice(startOf(kids[k]), endOf(kids[k]));
        previous = k;
        next = k + 1;
      } else {
        run.push(child);
      }
    });
    return output + gap(previous, count);
  }

  /** 一个在原位置被修改的节点：尽量深入其中沿用原文，再按原来的写法调整重新序列化的文本 */
  function renderNode(node: ProseNode, base: ProseNode, md: MdNode, trusted = true): string {
    if (trusted && (node === base || node.eq(base))) return source.slice(startOf(md), endOf(md));
    if (trusted && node.type === base.type) {
      const text = renderContainer(node, base, md);
      if (text !== null) return text;
    }
    const prefix = continuationPrefix(startOf(md));
    const original = source.slice(startOf(md), endOf(md)).split(/\r?\n/);
    let text = withPrefix(serializeNodes([node]), prefix);

    // setext 标题（=== / ---）保持 setext
    if (node.type.name === 'heading' && node.type === base.type && node.attrs.level <= 2 && node.attrs.level === base.attrs.level) {
      const underline = original[original.length - 1];
      const atx = /^#{1,2} (.*)$/.exec(text);
      if (original.length > 1 && /^ {0,3}(=+|-+)[ \t]*$/.test(underline) && atx) text = `${atx[1]}${eol}${underline}`;
    }

    // 代码块保持原来的围栏（``` / ~~~ 及其长度）或缩进写法
    if (node.type.name === 'code_block' && node.type === base.type && md.type === 'code') {
      const fence = /^\s*(`{3,}|~{3,})/.exec(original[0]);
      if (!fence && !node.attrs.language) {
        text = node.textContent.split('\n')
          .map((line, i) => (i === 0 ? '' : line ? prefix : prefix.trimEnd()) + (line ? `    ${line}` : ''))
          .join(eol);
      } else if (fence) {
        const lines = text.split(eol);
        lines[0] = lines[0].replace(/^`{3,}/, fence[1]);
        lines[lines.length - 1] = lines[lines.length - 1].replace(/`{3,}(\s*)$/, `${fence[1]}$1`);
        text = lines.join(eol);
      }
    }
    return text;
  }

  function renderContainer(node: ProseNode, base: ProseNode, md: MdNode): string | null {
    const name = node.type.name;
    const kids = md.children ?? [];

    if ((name === 'bullet_list' || name === 'ordered_list') && md.type === 'list' && kids.length > 0 && base.childCount === kids.length) {
      const indent = continuationPrefix(startOf(md));
      const first = source.slice(startOf(kids[0]));
      const bullet = first[0];
      const delimiter = /^\d+([.)])/.exec(first)?.[1] ?? '.';
      // 新增的列表项：用原列表的符号（* + - 或 1) 1.），编号取它自己的位置
      const renderNew = (item: ProseNode): string => {
        const order = Number.parseInt(String(item.attrs.label), 10);
        const attrs = name === 'ordered_list' ? { ...node.attrs, order: Number.isFinite(order) ? order : node.attrs.order } : node.attrs;
        const text = serializeNodes([node.type.create(attrs, [item])]);
        const adapted = name === 'ordered_list'
          ? text.replace(/^(\d+)[.)]/, (_, digits: string) => `${digits}${delimiter}`)
          : text.replace(/^[-*+]/, bullet);
        return withPrefix(adapted, indent);
      };
      const separator = kids.length > 1 ? source.slice(endOf(kids[0]), startOf(kids[1])) : eol + indent;
      return assemble(node, base, kids, '', '', separator, () => true,
        (item, i) => renderItem(item, base.child(i), kids[i]) ?? renderNew(item),
        (items) => items.map(renderNew).join(separator));
    }

    if (name === 'blockquote' && md.type === 'blockquote' && kids.length > 0 && base.childCount === kids.length) {
      const prefix = continuationPrefix(startOf(kids[0]));
      return assemble(node, base, kids,
        source.slice(startOf(md), startOf(kids[0])),
        source.slice(endOf(kids[kids.length - 1]), endOf(md)),
        eol + prefix.trimEnd() + eol + prefix,
        () => true,
        (child, i) => renderNode(child, base.child(i), kids[i]),
        (nodes) => withPrefix(serializeNodes(nodes), prefix));
    }

    // 表格：未改动的行（及对齐行）原样保留，被编辑的行按单元格重新拼接；列数变化时整表重写
    if (name === 'table' && md.type === 'table' && base.childCount === kids.length && node.childCount === base.childCount) {
      let output = '';
      for (let r = 0; r < node.childCount; r += 1) {
        const row = node.child(r);
        const baseRow = base.child(r);
        if (r > 0) output += source.slice(endOf(kids[r - 1]), startOf(kids[r]));
        const original = source.slice(startOf(kids[r]), endOf(kids[r]));
        if (row === baseRow || row.eq(baseRow)) {
          output += original;
          continue;
        }
        if (row.childCount !== baseRow.childCount) return null;
        const cells: string[] = [];
        row.forEach((cell) => {
          const paragraphs: ProseNode[] = [];
          cell.forEach((child) => paragraphs.push(child));
          cells.push(normalizeSerialized(serializeRaw(paragraphs)).replace(/\r?\n/g, ' ').replace(/(^|[^\\])\|/g, '$1\\|'));
        });
        output += `${original.trimStart().startsWith('|') ? '| ' : ''}${cells.join(' | ')}${original.trimEnd().endsWith('|') ? ' |' : ''}`;
      }
      return output;
    }

    return null;
  }

  /** 在原位置被修改的列表项：沿用原来的列表符号（任务列表同步勾选状态），子节点逐个处理 */
  function renderItem(item: ProseNode, base: ProseNode, md: MdNode): string | null {
    const kids = md.children ?? [];
    if (item.childCount !== base.childCount || kids.length !== base.childCount || kids.length === 0) return null;
    const { checked, ...attrs } = item.attrs;
    const { checked: baseChecked, ...baseAttrs } = base.attrs;
    if (JSON.stringify(attrs) !== JSON.stringify(baseAttrs)) return null;
    let marker = source.slice(startOf(md), startOf(kids[0]));
    if (checked !== baseChecked) {
      if (typeof checked !== 'boolean' || !/\[[ xX]\]/.test(marker)) return null;
      marker = marker.replace(/\[[ xX]\]/, checked ? '[x]' : '[ ]');
    }
    let text = marker;
    for (let c = 0; c < item.childCount; c += 1) {
      if (c > 0) text += source.slice(endOf(kids[c - 1]), startOf(kids[c]));
      text += renderNode(item.child(c), base.child(c), kids[c]);
    }
    return text;
  }

  /** 与 offset 所在行同一容器的续行前缀：保留引用符号 >，其余（列表符号、编号、复选框）换成空格 */
  function continuationPrefix(offset: number): string {
    return source.slice(source.lastIndexOf('\n', offset - 1) + 1, offset).replace(/[^>\s]/g, ' ');
  }

  function withPrefix(text: string, prefix: string): string {
    return text.split(/\r?\n/).map((line, i) => (i === 0 ? line : line ? prefix + line : prefix.trimEnd())).join(eol);
  }
}

function separatorsOf(blocks: MdNode[], source: string): string[] {
  return blocks.slice(1).map((node, i) => source.slice(endOf(blocks[i]), startOf(node)));
}

function detectHardBreakStyle(tree: MdNode, source: string): HardBreakStyle {
  let spaces = 0;
  let backslash = 0;
  const visit = (node: MdNode) => {
    if (node.type === 'break' && hasPosition(node)) {
      if (source[startOf(node)] === '\\') backslash += 1;
      else spaces += 1;
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  return spaces > backslash ? 'spaces' : 'backslash';
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

type UnsafePattern = { character: string; inConstruct?: string | readonly string[] | null; notInConstruct?: string | readonly string[] | null };

function listInScope(stack: readonly string[], list: UnsafePattern['inConstruct'], none: boolean): boolean {
  const items = typeof list === 'string' ? [list] : list;
  if (!items || items.length === 0) return none;
  return items.some((item) => stack.includes(item));
}

/**
 * 硬换行：与 mdast-util-to-markdown 2.x 的 break 处理相同（标题、表格单元格里不能换行时输出空格），
 * 只是可以按文档原来的习惯输出“两个空格 + 换行”，而不是固定的反斜杠。
 */
export function createHardBreakHandler(getStyle: () => HardBreakStyle) {
  return (_node: unknown, _parent: unknown, state: { unsafe: readonly UnsafePattern[]; stack: readonly string[] }, info: { before: string }): string => {
    for (const pattern of state.unsafe) {
      if (pattern.character === '\n' && listInScope(state.stack, pattern.inConstruct, true) && !listInScope(state.stack, pattern.notInConstruct, false)) {
        return /[ \t]/.test(info.before) ? '' : ' ';
      }
    }
    return getStyle() === 'spaces' ? '  \n' : '\\\n';
  };
}

/** 编辑器的 markdown 序列化配置：紧凑列表保持紧凑，新列表用 "-"，硬换行按文档原来的写法 */
export function configureMarkdownStringify(ctx: Ctx, getHardBreakStyle: () => HardBreakStyle = () => 'backslash'): void {
  ctx.update(remarkStringifyOptionsCtx, (options) => ({
    ...options,
    bullet: '-' as const,
    join: [...(options.join ?? []), joinListsBySpread],
    handlers: { ...options.handlers, break: createHardBreakHandler(getHardBreakStyle) },
  }));
}
