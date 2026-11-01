import katex from 'katex';

/**
 * 把导出 HTML 里的 LaTeX 公式渲染成 MathML。
 *
 * 为什么在渲染进程做、而不是后端：flexmark-all 0.64.8 的全部扩展里没有任何数学扩展，
 * Java 侧也没有 LaTeX→MathML 的转换器。而 KaTeX 已经是前端依赖，编辑器里的公式本来就是
 * 它渲染的——在这里复用同一个 KaTeX，所见即所得才由同一个实现保证。
 * 见 docs/adr/0003-export-fidelity-in-renderer.md。
 *
 * 为什么输出 MathML：导出产物必须自包含且不引用 CDN（本地优先，`ExportServiceTest` 锁定了
 * 这一点）。MathML 不需要 CSS、JS 或字体，Chromium 原生支持，所以 HTML 导出和走
 * `printToPDF` 的 PDF 导出都能正确显示。
 */

/** 块级 $$...$$ 与行内 $...$。行内不允许跨行，也不允许紧挨着数字（避免误吃 "$5 和 $10"）。 */
const BLOCK_MATH = /\$\$([\s\S]+?)\$\$/;
const INLINE_MATH = /\$(?!\s)((?:[^$\n\\]|\\.)+?)(?<!\s)\$(?!\d)/;

/** 这些元素里的 $ 是正文或代码，不是公式。 */
const SKIPPED_ANCESTORS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'MATH', 'TEXTAREA']);

function hasSkippedAncestor(node: Node): boolean {
  for (let current = node.parentElement; current; current = current.parentElement) {
    if (SKIPPED_ANCESTORS.has(current.tagName)) return true;
  }
  return false;
}

function renderToMathml(tex: string, displayMode: boolean): string | null {
  try {
    return katex.renderToString(tex.trim(), {
      displayMode,
      output: 'mathml',
      throwOnError: false,
    });
  } catch {
    // KaTeX 已经配了 throwOnError: false，走到这里说明是意料外的问题：
    // 保留原文，不让一条坏公式毁掉整次导出。
    return null;
  }
}

/** 把一个文本节点里的公式替换成 MathML 元素，返回是否改动过。 */
function replaceInTextNode(textNode: Text, doc: Document): boolean {
  const original = textNode.nodeValue ?? '';
  if (!original.includes('$')) return false;

  const fragment = doc.createDocumentFragment();
  let rest = original;
  let changed = false;

  while (rest.length > 0) {
    const block = BLOCK_MATH.exec(rest);
    const inline = INLINE_MATH.exec(rest);
    // 块级优先：$$x$$ 不应该被行内规则先吃掉一个 $
    const match = block && (!inline || block.index <= inline.index) ? block : inline;
    if (!match) break;

    const html = renderToMathml(match[1], match === block);
    if (html === null) {
      // 渲染不了就连同分隔符一起原样留下，继续找后面的
      fragment.appendChild(doc.createTextNode(rest.slice(0, match.index + match[0].length)));
      rest = rest.slice(match.index + match[0].length);
      continue;
    }

    if (match.index > 0) {
      fragment.appendChild(doc.createTextNode(rest.slice(0, match.index)));
    }
    const holder = doc.createElement(match === block ? 'div' : 'span');
    holder.className = match === block ? 'export-math export-math--block' : 'export-math';
    holder.innerHTML = html;
    fragment.appendChild(holder);
    rest = rest.slice(match.index + match[0].length);
    changed = true;
  }

  if (!changed) return false;
  if (rest.length > 0) fragment.appendChild(doc.createTextNode(rest));
  textNode.parentNode?.replaceChild(fragment, textNode);
  return true;
}

export function renderMathInExportedHtml(html: string): string {
  if (!html || !html.includes('$')) return html;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);

  const targets: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if ((text.nodeValue ?? '').includes('$') && !hasSkippedAncestor(text)) {
      targets.push(text);
    }
  }
  if (targets.length === 0) return html;

  let changed = false;
  for (const target of targets) {
    if (replaceInTextNode(target, doc)) changed = true;
  }
  if (!changed) return html;

  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
