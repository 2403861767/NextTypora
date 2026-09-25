/**
 * YAML frontmatter: the first line is `---` and the block ends at the next `---` line — the same rule the backend
 * (IndexService / ExportService) uses. The returned `frontmatter` also keeps the blank lines that follow the closing
 * fence, so `frontmatter + body` is always exactly the original content.
 */
const FRONTMATTER_PATTERN = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/;

export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const frontmatter = FRONTMATTER_PATTERN.exec(content)?.[0] ?? '';
  return { frontmatter, body: content.slice(frontmatter.length) };
}

export function joinFrontmatter(frontmatter: string, body: string): string {
  // 闭合的 --- 在文件末尾时，补一个换行，避免新正文接在 --- 后面
  if (frontmatter && body && !frontmatter.endsWith('\n')) {
    return `${frontmatter}\n${body}`;
  }
  return frontmatter + body;
}
