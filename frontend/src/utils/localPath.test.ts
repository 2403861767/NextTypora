import { describe, expect, it } from 'vitest';
import { relativePathInFolder } from './localPath';

// BUG_BACKLOG_REAL_WORLD.md RW-P1-006：判断打开的文件是否已经在当前工作区内
describe('relativePathInFolder', () => {
  it('returns the /-separated path of a file anywhere inside the folder', () => {
    expect(relativePathInFolder('D:\\project\\test\\e2e-vault', 'D:\\project\\test\\e2e-vault\\日记\\2026-09-23.md'))
      .toBe('日记/2026-09-23.md');
    expect(relativePathInFolder('D:\\vault', 'D:\\vault\\ascii-notes.md')).toBe('ascii-notes.md');
    expect(relativePathInFolder('/home/me/vault', '/home/me/vault/a/b/c.md')).toBe('a/b/c.md');
  });

  it('matches folders the same way as foldersEqual: mixed separators, letter case, trailing separator', () => {
    expect(relativePathInFolder('D:/Vault/', 'd:\\vault\\日记\\笔记.md')).toBe('日记/笔记.md');
    expect(relativePathInFolder('d:\\vault\\', 'D:/Vault/日记/笔记.md')).toBe('日记/笔记.md');
  });

  it('works for a drive root workspace', () => {
    expect(relativePathInFolder('D:\\', 'D:\\notes\\a.md')).toBe('notes/a.md');
  });

  it('returns undefined for files outside the folder', () => {
    expect(relativePathInFolder('D:\\vault', 'E:\\vault2\\第二库笔记.md')).toBeUndefined();
    // 只是名字以工作区路径开头的兄弟目录
    expect(relativePathInFolder('D:\\vault', 'D:\\vault-2\\a.md')).toBeUndefined();
    expect(relativePathInFolder('D:\\vault', 'D:\\vault')).toBeUndefined();
    expect(relativePathInFolder('', 'D:\\vault\\a.md')).toBeUndefined();
  });
});
