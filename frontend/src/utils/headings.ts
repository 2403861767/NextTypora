export interface Heading {
  level: number;
  text: string;
  line: number;
  slug: string;
  key: string;
}

export interface TocItem extends Heading {
  href: string;
}

const TOC_MARKER_PATTERN = /^\s*(?:\[toc\]|\[\[toc\]\])\s*$/i;

export function cleanHeadingText(raw: string): string {
  return raw
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+#+\s*$/g, '')
    .trim();
}

export function slugifyHeadingText(text: string): string {
  const normalized = cleanHeadingText(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || 'section';
}

export function createHeadingSlugger(): (text: string) => string {
  const seen = new Map<string, number>();

  return (text: string) => {
    const base = slugifyHeadingText(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

export function createHeadingKey(line: number, slug: string, text: string): string {
  return `${line}-${slug || slugifyHeadingText(text)}`;
}

export function parseHeadings(content: string): Heading[] {
  const slugFor = createHeadingSlugger();

  return content.split('\n').flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (!match) return [];
    const text = cleanHeadingText(match[2]);
    const slug = slugFor(text);
    return [{ level: match[1].length, text, line: index, slug, key: createHeadingKey(index, slug, text) }];
  });
}

export function headingIndexForLine(headings: Heading[], line: number): number {
  return headings.findIndex((h) => h.line === line);
}

export function isTocMarkerLine(line: string): boolean {
  return TOC_MARKER_PATTERN.test(line);
}

export function buildTocItems(content: string): TocItem[] {
  return parseHeadings(content).map((heading) => ({
    ...heading,
    href: `#${encodeURIComponent(heading.slug)}`,
  }));
}

export function renderMarkdownToc(content: string): string {
  const headings = buildTocItems(content);
  if (headings.length === 0) return '';

  const minLevel = Math.min(...headings.map((heading) => heading.level));
  return headings
    .map((heading) => {
      const indent = '  '.repeat(Math.max(0, heading.level - minLevel));
      return `${indent}- [${heading.text}](${heading.href})`;
    })
    .join('\n');
}

export function expandTocMarkers(content: string): string {
  const toc = renderMarkdownToc(content);
  return content
    .split('\n')
    .map((line) => (isTocMarkerLine(line) ? toc : line))
    .join('\n');
}

export function normalizeHeadingHash(hash: string): string {
  const withoutHash = hash.trim().replace(/^#/, '');
  try {
    return decodeURIComponent(withoutHash);
  } catch {
    return withoutHash;
  }
}

export function findHeadingBySlug(headings: Heading[], hash: string): Heading | undefined {
  const normalized = normalizeHeadingHash(hash);
  const lowerTarget = normalized.toLowerCase();
  const slugTarget = slugifyHeadingText(normalized);

  return headings.find((heading) => (
    heading.slug.toLowerCase() === lowerTarget
    || heading.slug === slugTarget
  ));
}

const HEADING_SELECTOR = '.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6';

function resolveEditorRoot(editorRoot?: HTMLElement | null): ParentNode | null {
  return editorRoot?.querySelector('.typora-editor')
    ?? editorRoot
    ?? document.querySelector('.typora-editor');
}

function domHeadingText(element: Element): string {
  return cleanHeadingText(element.textContent ?? '');
}

function domHeadingLevel(element: Element): number {
  const level = Number(element.tagName.slice(1));
  return Number.isFinite(level) ? level : 0;
}

function sameHeadingIdentity(left: Pick<Heading, 'level' | 'text'>, right: Pick<Heading, 'level' | 'text'>): boolean {
  return left.level === right.level && left.text === right.text;
}

function headingTargetIndex(headings: Heading[], line: number, targetHeading?: Heading | string): number {
  if (typeof targetHeading === 'string') {
    const keyIndex = headings.findIndex((heading) => heading.key === targetHeading);
    if (keyIndex >= 0) return keyIndex;
  } else if (targetHeading?.key) {
    const keyIndex = headings.findIndex((heading) => heading.key === targetHeading.key);
    if (keyIndex >= 0) return keyIndex;
  }

  return headingIndexForLine(headings, line);
}

function identityOccurrenceIndex(headings: Heading[], targetIndex: number): number {
  const targetHeading = headings[targetIndex];
  if (!targetHeading) return -1;

  return headings
    .slice(0, targetIndex + 1)
    .filter((heading) => sameHeadingIdentity(heading, targetHeading))
    .length - 1;
}

function findDomHeadingByIdentity(root: ParentNode, heading: Heading, occurrenceIndex: number): Element | undefined {
  const matches = Array.from(root.querySelectorAll<HTMLElement>(HEADING_SELECTOR))
    .filter((element) => (
      domHeadingLevel(element) === heading.level
      && domHeadingText(element) === heading.text
    ));

  return matches[occurrenceIndex] ?? matches[0];
}

export function scrollToHeadingLine(
  line: number,
  content: string,
  editorRoot?: HTMLElement | null,
  targetHeading?: Heading | string,
): void {
  const headings = parseHeadings(content);
  const index = headingTargetIndex(headings, line, targetHeading);
  if (index < 0) return;

  const root = resolveEditorRoot(editorRoot);
  if (!root) return;

  const identityTarget = findDomHeadingByIdentity(root, headings[index], identityOccurrenceIndex(headings, index));
  const domHeadings = root.querySelectorAll(HEADING_SELECTOR);
  const target = identityTarget ?? domHeadings[index];
  if (!target) return;

  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function scrollToHeadingHash(hash: string, content: string, editorRoot?: HTMLElement | null): void {
  const heading = findHeadingBySlug(parseHeadings(content), hash);
  if (!heading) return;
  scrollToHeadingLine(heading.line, content, editorRoot, heading);
}
