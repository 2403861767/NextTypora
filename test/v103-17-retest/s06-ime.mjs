// Item 4: real Chinese IME input with candidate selection.
//
// The historical substitute for this step was CDP Input.insertText, which bypasses
// composition entirely - exactly what needed testing. So this script records
// compositionstart/update/end in the page and types pinyin with hardware scan codes:
// if no composition events fire, the step did NOT test what it claims to.

import path from 'node:path';
import fs from 'node:fs';
import { Cdp, osClickElement, os, sleep } from './lib/app.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const VAULT = path.join(HERE, 'vault');
const NOTE = path.join(VAULT, '打包版新笔记.md');
const pid = Number(fs.readFileSync(path.join(HERE, 'app.pid'), 'utf8').trim());

const out = { steps: [] };
const step = (name, detail) => { out.steps.push({ name, detail }); console.log(`[${name}] ${JSON.stringify(detail)}`); };

const cdp = await Cdp.open(9333);
try {
  await os.front(pid);
  await sleep(400);
  await cdp.key({ key: 'Escape', code: 'Escape', keyCode: 27 });
  await sleep(300);
  await cdp.domClickByText('.sidebar-tab', 'Files', { nth: 0 });
  await sleep(600);

  step('note-before', { bytes: fs.statSync(NOTE).size, text: fs.readFileSync(NOTE, 'utf8') });

  await cdp.domClickByText('.tree-file', '打包版新笔记.md');
  await cdp.waitFor(`(() => !!document.querySelector('.ProseMirror'))()`, { timeout: 30000, label: 'note opened' });
  await sleep(600);

  // Record what the real input stack delivers.
  await cdp.eval(`(() => {
    window.__comp = [];
    window.__keysIme = [];
    const pm = document.querySelector('.ProseMirror');
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) {
      pm.addEventListener(type, (e) => window.__comp.push({ type, data: e.data }), true);
    }
    pm.addEventListener('keydown', (e) => window.__keysIme.push({ code: e.code, key: e.key, isComposing: e.isComposing }), true);
    return true;
  })()`);

  // Click into the editor for real so ProseMirror owns the caret, then go to the end.
  await osClickElement(cdp, '.ProseMirror', '');
  await sleep(500);
  const focused = await cdp.eval(`document.activeElement.className.includes('ProseMirror')`);
  await os.keys('ctrl+end', pid);
  await sleep(300);
  await os.keys('enter', pid);
  await sleep(300);
  step('editor-focused', { focused });

  // Type pinyin for 你好 and commit the first candidate with space.
  await os.text('nihao');
  await sleep(1200);
  const duringComposition = await cdp.eval(`({
    comp: window.__comp.slice(),
    pmTail: document.querySelector('.ProseMirror').innerText.slice(-40),
  })`);
  step('after-pinyin', duringComposition);

  await os.keys('space', pid);
  await sleep(1200);
  const afterCommit = await cdp.eval(`({
    comp: window.__comp.slice(),
    keys: window.__keysIme.slice(-8),
    pmTail: document.querySelector('.ProseMirror').innerText.slice(-40),
  })`);
  step('after-commit', afterCommit);

  const committed = String(afterCommit.pmTail || '');
  step('verdict', {
    compositionEventsFired: afterCommit.comp.length > 0,
    compositionTypes: [...new Set(afterCommit.comp.map((c) => c.type))],
    hasChineseInEditor: /[一-鿿]/.test(committed.replace(/[新笔记打包版]/g, '')) || /你好/.test(committed),
    latinLeftover: /nihao/i.test(committed),
    pmTail: committed,
  });

  // let autosave run, then read the file
  await sleep(2500);
  const after = fs.readFileSync(NOTE, 'utf8');
  step('note-after', { bytes: Buffer.byteLength(after), text: after });
} finally {
  fs.writeFileSync(path.join(HERE, 'evidence-s06.json'), JSON.stringify(out, null, 2));
  cdp.close();
}
console.log('DONE');
