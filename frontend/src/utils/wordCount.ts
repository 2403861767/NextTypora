/** Rough Typora-style word count: CJK characters + Latin word tokens. */
export function countDocumentWords(content: string): number {
  const stripped = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`_~-]/g, ' ')
    .trim();

  if (!stripped) return 0;

  const cjk = (stripped.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const latinWords = stripped
    .split(/\s+/)
    .filter((token) => /[a-zA-Z0-9]/.test(token)).length;

  return cjk + latinWords;
}
