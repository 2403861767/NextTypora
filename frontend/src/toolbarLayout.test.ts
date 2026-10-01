import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest 把 .css 模块（包括 ?raw）替换成空串，所以直接读文件
const css = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8');

// BUG_BACKLOG_REAL_WORLD.md RW-P3-004：窗口窄于约 1300px 时，标题栏的文件名、“已保存”和工具栏按钮互相重叠。
// 原因：.toolbar-section 的 min-width:0 让两个 auto 列可以被压得比内容窄，右组按钮（约 540px 宽）就向左溢出，
// 盖住标题和左组的导出按钮；标题列里 420px 宽的长文件名也会超出它的列，盖住两侧。
//
// jsdom 不排版，这里测的是保证“不会溢出”的样式约定，而不是像素位置；实际的几何重叠要在真实浏览器里量
// （修复前后分别在 900 / 1024 / 1100 / 1280 / 1366 / 1440px 下量过，见提交说明）。

interface Rule {
  media: string | null;
  selector: string;
  declarations: Map<string, string>;
}

/** 只解析本样式表用到的结构：顶层规则和一层 @media（其余 @ 规则整块跳过）。 */
function parseCss(source: string): Rule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];

  const readBlocks = (block: string, media: string | null) => {
    let position = 0;
    while (position < block.length) {
      const open = block.indexOf('{', position);
      if (open === -1) break;
      let depth = 1;
      let close = open + 1;
      while (close < block.length && depth > 0) {
        if (block[close] === '{') depth += 1;
        else if (block[close] === '}') depth -= 1;
        close += 1;
      }
      const prelude = block.slice(position, open).trim();
      const body = block.slice(open + 1, close - 1);
      if (prelude.startsWith('@media')) {
        readBlocks(body, prelude.slice('@media'.length).trim().replace(/\s+/g, ' '));
      } else if (!prelude.startsWith('@')) {
        const declarations = new Map<string, string>();
        body.split(';').forEach((declaration) => {
          const colon = declaration.indexOf(':');
          if (colon === -1) return;
          declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim().replace(/\s+/g, ' '));
        });
        prelude.split(',').forEach((selector) => {
          rules.push({ media, selector: selector.trim().replace(/\s+/g, ' '), declarations });
        });
      }
      position = close;
    }
  };

  readBlocks(text, null);
  return rules;
}

const rules = parseCss(css);

/** 某个选择器（在某个媒体查询里）的声明；同一个选择器出现多次时，后面的覆盖前面的 */
function declarationsOf(selector: string, media: string | null = null): Map<string, string> {
  const merged = new Map<string, string>();
  rules
    .filter((rule) => rule.selector === selector && rule.media === media)
    .forEach((rule) => rule.declarations.forEach((value, property) => merged.set(property, value)));
  return merged;
}

/** grid-template-columns 的各个列轨道；括号里的空白不切开（minmax(0, 1fr) 是一个轨道） */
function tracksOf(value: string | undefined): string[] {
  const result: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of value ?? '') {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ' ' && depth === 0) {
      if (current) result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) result.push(current);
  return result;
}

const TOOLBAR_COLUMNS = () => tracksOf(declarationsOf('.typora-toolbar').get('grid-template-columns'));

describe('toolbar layout in narrow windows', () => {
  it('reads the real stylesheet (an empty read would make every other check meaningless)', () => {
    expect(css.length).toBeGreaterThan(10000);
    expect(declarationsOf('.typora-toolbar').has('grid-template-columns')).toBe(true);
  });

  it('never squeezes the two button groups below their content, or the right one spills over the title', () => {
    // 列：品牌 | 左组按钮 | 标题 | 右组按钮
    expect(TOOLBAR_COLUMNS()[1]).toBe('max-content');
    expect(TOOLBAR_COLUMNS()[3]).toBe('max-content');
  });

  it('lets only the brand and title columns give way when there is not enough room', () => {
    expect(TOOLBAR_COLUMNS()[0]).toBe('auto');
    expect(TOOLBAR_COLUMNS()[2]).toBe('minmax(0, 1fr)');
  });

  it('keeps the brand column as wide as the sidebar when the window is wide enough', () => {
    const wide = tracksOf(declarationsOf('.typora-toolbar', '(min-width: 1360px)').get('grid-template-columns'));

    expect(wide).toEqual(['var(--sidebar-width)', 'max-content', 'minmax(0, 1fr)', 'max-content']);
  });

  it('clips the title column instead of letting a long file name paint over its neighbours', () => {
    const center = declarationsOf('.toolbar-center');
    expect(center.get('min-width')).toBe('0');
    expect(center.get('max-width')).toBe('100%');
    expect(center.get('overflow')).toBe('hidden');
    // 标题和路径不超过标题列的宽度，超出的部分用省略号
    expect(declarationsOf('.document-title').get('max-width')).toContain('100%');
    expect(declarationsOf('.document-title').get('text-overflow')).toBe('ellipsis');
    expect(declarationsOf('.document-path').get('max-width')).toContain('100%');
  });

  it('hides the app name and the help label (but not the help icon) in narrow windows to keep the groups apart', () => {
    const narrow = '(min-width: 721px) and (max-width: 1100px)';

    expect(declarationsOf('.window-brand', narrow).get('display')).toBe('none');
    expect(declarationsOf('.toolbar-help-btn span:not(.anticon)', narrow).get('display')).toBe('none');
    // 图标本身也是个 span（span.anticon）：直接写 .toolbar-help-btn span 会把它一起藏掉，按钮就成了空的
    expect(declarationsOf('.toolbar-help-btn span', narrow).has('display')).toBe(false);
  });

  it('leaves the phone layout (up to 720px) to its own rules', () => {
    expect(tracksOf(declarationsOf('.typora-toolbar', '(max-width: 720px)').get('grid-template-columns'))).toEqual(['1fr', 'auto']);
  });
});
