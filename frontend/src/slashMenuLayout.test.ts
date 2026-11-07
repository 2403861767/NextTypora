import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// V104-06：窗口较矮、光标在笔记中下部时输入 /，斜杠菜单上下都放不下，Crepe 把它翻到上方，顶部被编辑区
// （.typora-editor，overflow: auto）裁掉，分组标签那一行看不见。菜单定位（floating-ui 的 flip + offset(10)）
// 不会缩短菜单，Crepe 也没开放这个菜单的定位选项，所以由样式保证：菜单高度不超过编辑区可见高度的一半，
// 光标在哪一行，上下总有一边放得下。
//
// jsdom 不排版，这里按下面这些在真实窗口里量出的尺寸计算；实际是否被裁要在真实浏览器里量（修复前后都量过，见提交说明）。

// vitest 把 .css 模块（包括 ?raw）替换成空串，所以直接读文件
const appCss = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const crepeCss = readFileSync(
  join(import.meta.dirname, '../node_modules/@milkdown/crepe/lib/theme/common/block-edit.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/** 编辑区上方（标题栏、标签栏）和下方（状态栏、边距）占掉的高度：视口 816 时编辑区从 102 到 774 */
const CHROME_ABOVE_AND_BELOW = 144;
/** 菜单里 .menu-groups 以外的部分（分组标签行加边框）：菜单 482 = 这部分 + Crepe 的 max-height 420 */
const MENU_FIXED_PART = 62;
/** SlashProvider 的 offset(10) */
const MENU_OFFSET = 10;
/** 光标所在行的高度，取宽一点 */
const CURSOR_LINE = 32;

const CREPE_SELECTOR = '.milkdown .milkdown-slash-menu .menu-groups';
const APP_SELECTOR = '.typora-editor .milkdown .milkdown-slash-menu .menu-groups';

/** 取某条规则（按选择器全文匹配，取第一处；这两个选择器在各自的样式表里都只出现一次）的某个声明 */
function declaration(source: string, selector: string, property: string): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const rule = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  if (!rule) return undefined;
  const value = new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+);?`).exec(rule[1]);
  return value?.[1].trim();
}

/** 计算一个只含 px、vh 和 calc/min/max/clamp 的长度在给定视口高度下的像素值 */
function lengthAt(value: string, viewportHeight: number): number {
  const expression = value
    .replace(/(\d+(?:\.\d+)?)vh/g, (_m, n: string) => `(${Number(n) * viewportHeight / 100})`)
    .replace(/(\d+(?:\.\d+)?)px/g, '$1')
    .replace(/calc\(/g, '(')
    .replace(/clamp\(/g, 'clamp(')
    .replace(/\bmin\(/g, 'Math.min(')
    .replace(/\bmax\(/g, 'Math.max(');
  if (!/^[\d\s.+\-*/(),]*$/.test(expression.replace(/Math\.(min|max)|clamp/g, ''))) {
    throw new Error(`unsupported length: ${value}`);
  }
  const clamp = (low: number, preferred: number, high: number) => Math.max(low, Math.min(preferred, high));
  return Number(new Function('clamp', `return ${expression};`)(clamp));
}

/** 实际生效的 .menu-groups max-height：我们的规则选择器更具体，存在就以它为准，否则是 Crepe 的 */
function effectiveMaxHeight(viewportHeight: number): number {
  const value = declaration(appCss, APP_SELECTOR, 'max-height') ?? declaration(crepeCss, CREPE_SELECTOR, 'max-height');
  if (!value) throw new Error('no max-height for the slash menu groups');
  return lengthAt(value, viewportHeight);
}

describe('slash menu in short windows', () => {
  it("reads the real stylesheets (an empty read would make every other check meaningless)", () => {
    expect(appCss.length).toBeGreaterThan(10000);
    expect(declaration(crepeCss, CREPE_SELECTOR, 'max-height')).toBe('420px');
  });

  // 1440×900 的默认窗口，视口约 816 高；再往下到 600，往上到 2K 屏
  it.each([600, 700, 816, 900, 1080, 1200, 1440])(
    'fits above or below the cursor wherever it is, in a %ipx tall window',
    (viewportHeight) => {
      const menu = MENU_FIXED_PART + effectiveMaxHeight(viewportHeight);
      const editor = viewportHeight - CHROME_ABOVE_AND_BELOW;
      // 光标行在编辑区正中时，上下两边剩下的空间最小
      const worstSide = (editor - CURSOR_LINE) / 2;
      expect(menu + MENU_OFFSET).toBeLessThanOrEqual(worstSide);
    },
  );

  it("is never taller than Crepe's own menu, and still shows a couple of items", () => {
    for (const viewportHeight of [400, 600, 816, 1080, 1440, 2160]) {
      expect(effectiveMaxHeight(viewportHeight)).toBeLessThanOrEqual(420);
      expect(effectiveMaxHeight(viewportHeight)).toBeGreaterThanOrEqual(120);
    }
  });
});
