import { describe, expect, it } from 'vitest';
import { windowsFileNameError, windowsPathError } from './fileName';

describe('windows file name validation', () => {
  it('rejects reserved characters, device names and trailing dot or space on Windows', () => {
    for (const name of ['test<>file.md', 'a:b.md', 'what?.md', 'star*.md', 'pipe|.md', 'quote".md', 'tab\t.md',
      'CON.md', 'con', 'Nul.txt', 'COM1.md', 'lpt9.markdown', 'AUX .md', 'note.', 'note ']) {
      expect(windowsFileNameError(name, true), name).not.toBeNull();
    }
  });

  it('allows ordinary and CJK names on Windows', () => {
    for (const name of ['hello.md', '中文 space-!@.md', 'CONSOLE.md', 'COM10.md', 'my.con.md', '.hidden']) {
      expect(windowsFileNameError(name, true), name).toBeNull();
    }
  });

  it('does not restrict names on other platforms', () => {
    expect(windowsFileNameError('what?.md', false)).toBeNull();
    expect(windowsPathError('bad:dir/CON.md', false)).toBeNull();
  });

  it('checks every segment of a create path', () => {
    expect(windowsPathError('notes/hello.md', true)).toBeNull();
    expect(windowsPathError('what?/hello.md', true)).toContain('?');
    expect(windowsPathError('notes/PRN.md', true)).toContain('保留名称');
  });
});
