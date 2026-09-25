import { describe, expect, it } from 'vitest';
import { joinFrontmatter, splitFrontmatter } from './frontmatter';

describe('splitFrontmatter', () => {
  it('splits a leading YAML block (with the blank line after it) from the body', () => {
    const content = '---\ntitle: 人月神话读书笔记\ntags: [读书, 软件工程]\n---\n\n# 人月神话\n';
    expect(splitFrontmatter(content)).toEqual({
      frontmatter: '---\ntitle: 人月神话读书笔记\ntags: [读书, 软件工程]\n---\n\n',
      body: '# 人月神话\n',
    });
  });

  it('returns the content unchanged when there is no frontmatter', () => {
    expect(splitFrontmatter('# 标题\n\n正文\n')).toEqual({ frontmatter: '', body: '# 标题\n\n正文\n' });
    expect(splitFrontmatter('')).toEqual({ frontmatter: '', body: '' });
  });

  it('only treats a fence on the very first line as frontmatter', () => {
    const content = '正文\n\n---\ntitle: x\n---\n';
    expect(splitFrontmatter(content)).toEqual({ frontmatter: '', body: content });
  });

  it('ignores an opening fence that is never closed', () => {
    const content = '---\n\n一段正文\n';
    expect(splitFrontmatter(content)).toEqual({ frontmatter: '', body: content });
  });

  it('does not treat a longer thematic break as a fence', () => {
    const content = '-----\ntitle: x\n-----\n';
    expect(splitFrontmatter(content)).toEqual({ frontmatter: '', body: content });
  });

  it('accepts an empty block, trailing spaces on fences and CRLF line endings', () => {
    expect(splitFrontmatter('---\n---\n正文')).toEqual({ frontmatter: '---\n---\n', body: '正文' });
    expect(splitFrontmatter('--- \r\na: 1\r\n---\t\r\n\r\n正文\r\n')).toEqual({
      frontmatter: '--- \r\na: 1\r\n---\t\r\n\r\n',
      body: '正文\r\n',
    });
  });

  it('handles a closing fence at the end of the file', () => {
    expect(splitFrontmatter('---\na: 1\n---')).toEqual({ frontmatter: '---\na: 1\n---', body: '' });
  });

  it('round-trips: frontmatter + body is always the original content', () => {
    const samples = [
      '---\na: 1\n---\n# t\n',
      '---\na: 1\n---\n\n\n\n正文',
      '---\r\na: 1\r\n---\r\n',
      '---\n---',
      '没有 frontmatter',
      '---\n未闭合',
    ];
    for (const sample of samples) {
      const { frontmatter, body } = splitFrontmatter(sample);
      expect(frontmatter + body).toBe(sample);
    }
  });
});

describe('joinFrontmatter', () => {
  it('prepends the frontmatter unchanged', () => {
    expect(joinFrontmatter('---\na: 1\n---\n\n', '# 标题\n')).toBe('---\na: 1\n---\n\n# 标题\n');
    expect(joinFrontmatter('', '# 标题\n')).toBe('# 标题\n');
  });

  it('keeps a closing fence at EOF from merging into new body text', () => {
    expect(joinFrontmatter('---\na: 1\n---', '新正文\n')).toBe('---\na: 1\n---\n新正文\n');
    expect(joinFrontmatter('---\na: 1\n---', '')).toBe('---\na: 1\n---');
  });
});
