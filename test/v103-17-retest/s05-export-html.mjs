// Item 6: open 数学公式.md, export to HTML through the REAL save-as dialog, and check the
// product: formulas rendered (MathML, no CDN), and every non-formula '$' kept verbatim.

import path from 'node:path';
import fs from 'node:fs';
import { Cdp, osClickElement, saveInNativeDialog, os, sleep } from './lib/app.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const OUT_HTML = path.join(HERE, 'export-math.html');
const pid = Number(fs.readFileSync(path.join(HERE, 'app.pid'), 'utf8').trim());

const out = { steps: [] };
const step = (name, detail) => { out.steps.push({ name, detail }); console.log(`[${name}] ${JSON.stringify(detail)}`); };

const cdp = await Cdp.open(9333);
try {
  await os.front(pid);
  await sleep(400);
  if (fs.existsSync(OUT_HTML)) fs.unlinkSync(OUT_HTML);

  // The shortcut probing left the sidebar on the Search tab; put it back on Files.
  await cdp.key({ key: 'Escape', code: 'Escape', keyCode: 27 });
  await sleep(400);
  await cdp.domClickByText('.sidebar-tab', 'Files', { nth: 0 });
  await sleep(700);
  await cdp.domClickByText('.tree-file', '数学公式.md');
  await cdp.waitFor(`(() => {
    const pm = document.querySelector('.ProseMirror');
    return pm && pm.innerText.includes('质能方程') ? true : null;
  })()`, { timeout: 30000, label: '数学公式.md opened' });
  const katexInEditor = await cdp.eval(`document.querySelectorAll('.ProseMirror .katex').length`);
  step('opened', { katexNodesInEditor: katexInEditor });

  // The toolbar's own export button - the path the ticket describes. NOT the Ctrl+Shift+E
  // keystroke: on this machine something outside the app consumes Ctrl+Shift+E before the
  // renderer sees the 'e' (every other Ctrl+Shift combo arrives, under both input languages),
  // so the keyboard route cannot be exercised here.
  await os.front(pid);
  await cdp.key({ key: 'Escape', code: 'Escape', keyCode: 27 });
  await sleep(500);
  await cdp.eval(`document.querySelector('button.toolbar-icon-btn[title="导出为 HTML"]').click()`);

  const saved = await saveInNativeDialog(pid, OUT_HTML);
  step('native-save-dialog', saved);

  await os.front(pid);
  const toast = await cdp.waitFor(`(() => {
    const t = [...document.querySelectorAll('.ant-message-notice-content')].map((e) => e.textContent.trim());
    return t.length ? t : null;
  })()`, { timeout: 15000, label: 'export toast' }).catch((e) => `no toast: ${e.message}`);
  step('export-toast', { toast });

  const exists = fs.existsSync(OUT_HTML);
  step('file-written', { exists, bytes: exists ? fs.statSync(OUT_HTML).size : 0, path: OUT_HTML });

  if (exists) {
    const html = fs.readFileSync(OUT_HTML, 'utf8');
    const mathCount = (html.match(/<math/g) || []).length;
    const keptDollars = {
      'echo $PATH': html.includes('echo $PATH'),
      '$HOME/bin': html.includes('$HOME/bin'),
      'price $19': html.includes('$19'),
      'price $25': html.includes('$25'),
      '$foo': html.includes('$foo'),
      'export PRICE=$100': html.includes('export PRICE=$100'),
      '$USER owes $PRICE': html.includes('$USER owes $PRICE'),
      'table code $y$': html.includes('$y$'),
    };
    const cdn = /https?:\/\/(cdn|unpkg|jsdelivr|cdnjs)/i.test(html);
    const leftoverFormulaDollars = {
      'E = mc^2 as text': html.includes('$E = mc^2$'),
      'block integral as text': html.includes('\\int_{0}^{\\infty}'),
    };
    step('export-content', {
      mathElements: mathCount,
      hasKatexCss: /katex/i.test(html),
      referencesCdn: cdn,
      keptDollars,
      leftoverFormulaDollars,
      head: html.slice(0, 160).replace(/\s+/g, ' '),
    });
  }
} finally {
  fs.writeFileSync(path.join(HERE, 'evidence-s05.json'), JSON.stringify(out, null, 2));
  cdp.close();
}
console.log('DONE');
