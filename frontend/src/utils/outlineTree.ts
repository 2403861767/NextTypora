import type { Heading } from './headings';

export interface OutlineTreeNode {
  heading: Heading;
  children: OutlineTreeNode[];
}

export function buildOutlineTree(headings: Heading[]): OutlineTreeNode[] {
  const root: OutlineTreeNode[] = [];
  const stack: OutlineTreeNode[] = [];

  for (const heading of headings) {
    const node: OutlineTreeNode = { heading, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].heading.level >= heading.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }

  return root;
}

export function outlineNodeKey(heading: Heading): string {
  return `${heading.line}-${heading.slug || heading.text}`;
}

export function collectOutlineNodeKeys(nodes: OutlineTreeNode[]): string[] {
  return nodes.flatMap((node) => [
    outlineNodeKey(node.heading),
    ...collectOutlineNodeKeys(node.children),
  ]);
}

export function collapseOutlineNodesByLevel(nodes: OutlineTreeNode[], maxExpandedLevel: number): Set<string> {
  const collapsed = new Set<string>();
  const visit = (node: OutlineTreeNode) => {
    if (node.children.length > 0 && node.heading.level >= maxExpandedLevel) {
      collapsed.add(outlineNodeKey(node.heading));
    }
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return collapsed;
}

export function filterOutlineTree(nodes: OutlineTreeNode[], query: string): OutlineTreeNode[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return nodes;

  return nodes.flatMap((node) => {
    const children = filterOutlineTree(node.children, query);
    const matches = node.heading.text.toLowerCase().includes(normalized);
    return matches || children.length > 0
      ? [{ ...node, children }]
      : [];
  });
}
