// Items 3 and 10 against the running app.
//   3  edit 编码/gbk.md, let autosave run, verify the bytes on disk are still GBK
//  10  rename 😀表情文件名.md via the tree context menu and rename it back

import path from 'node:path';
import fs from 'node:fs';
import { Cdp, expandAll, treeSnapshotExpr, osClickElement, os, sleep } from './lib/app.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const VAULT = path.join(HERE, 'vault');
const GBK = path.join(VAULT, '编码', 'gbk.md');
const EMOJI = path.join(VAULT, '😀表情文件名.md');
const pid = Number(fs.readFileSync(path.join(HERE, 'app.pid'), 'utf8').trim());

const out = { steps: [] };
const step = (name, detail) => { out.steps.push({ name, detail }); console.log(`[${name}] ${JSON.stringify(detail)}`); };

function decodeTry(buf) {
  const res = {};
  try { res.utf8Strict = new TextDecoder('utf-8', { fatal: true }).decode(buf).slice(0, 80); }
  catch (e) { res.utf8Strict = `THROWS: ${e.message}`; }
  try { res.gbk = new TextDecoder('gbk').decode(buf).slice(0, 80); } catch (e) { res.gbk = `THROWS: ${e.message}`; }
  return res;
}

const cdp = await Cdp.open(9333);
let clipBackup = ''; // hoisted: the finally block must be able to restore the user's clipboard
try {
  await os.front(pid);
  await sleep(400);
  await cdp.key({ key: 'Escape', code: 'Escape', keyCode: 27 });
  await sleep(400);
  await expandAll(cdp);
  await sleep(500);

  // ---- item 3: GBK round trip ----------------------------------------------------------
  const beforeBuf = fs.readFileSync(GBK);
  step('gbk-before', { bytes: beforeBuf.length, ...decodeTry(beforeBuf) });

  await cdp.domClickByText('.tree-file', 'gbk.md');
  await cdp.waitFor(`(() => {
    const pm = document.querySelector('.ProseMirror');
    return pm && pm.innerText.trim().length > 0 ? pm.innerText.slice(0, 60) : null;
  })()`, { timeout: 30000, label: 'gbk.md opened' });
  const shown = await cdp.eval(`document.querySelector('.ProseMirror').innerText.slice(0, 120)`);
  step('gbk-opened', { shown: shown.replace(/\s+/g, ' ') });

  // put the caret at the very end of the document, then type
  await cdp.eval(`(() => {
    const pm = document.querySelector('.ProseMirror');
    pm.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(pm);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  })()`);
  await sleep(300);
  // Input.insertText does not reach ProseMirror here, so paste for real: clipboard + a
  // hardware Ctrl+V into the focused editor. That also exercises the real input path.
  clipBackup = await os.clipGet().catch(() => '');
  await os.clipSet('追加一个汉字');
  await os.front(pid);
  await sleep(300);
  await os.keys('ctrl+v', pid);
  await sleep(800);
  const editorNow = await cdp.eval(`document.querySelector('.ProseMirror').innerText.slice(0, 160)`);
  const dirty = await cdp.eval(`!!document.querySelector('.editor-tab-dirty')`);
  step('typed', { pasted: '追加一个汉字', landedInEditor: editorNow.includes('追加一个汉字'), dirtyMarker: dirty, editorNow: editorNow.replace(/\s+/g, ' ') });

  // autosave is debounced 800 ms; wait for the bytes on disk to actually change
  const changed = await (async () => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const now = fs.readFileSync(GBK);
      if (now.length !== beforeBuf.length || !now.equals(beforeBuf)) return now;
      await sleep(400);
    }
    return null;
  })();
  if (!changed) {
    step('gbk-after', { error: 'file never changed on disk within 25 s' });
  } else {
    step('gbk-after', { bytes: changed.length, ...decodeTry(changed) });
    const gbkText = new TextDecoder('gbk').decode(changed);
    step('gbk-verdict', {
      stillGbk: gbkText.includes('追加一个汉字'),
      utf8WouldThrow: String(decodeTry(changed).utf8Strict).startsWith('THROWS'),
      hasBom: changed[0] === 0xef && changed[1] === 0xbb && changed[2] === 0xbf,
    });
  }

  // ---- item 10: emoji filename rename round trip ---------------------------------------
  const emojiExistsBefore = fs.existsSync(EMOJI);
  await osClickElement(cdp, '.tree-file', '表情文件名', { button: 'right' });
  await sleep(900);
  const menuItems = await cdp.eval(`[...document.querySelectorAll('.ant-dropdown-menu-item')].filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim())`);
  step('context-menu', { emojiExistsBefore, menuItems });

  await cdp.domClickByText('.ant-dropdown-menu-item', '重命名');
  await sleep(900);
  await cdp.settleAnimations();
  const dialogTitle = await cdp.eval(`(() => {
    const d = [...document.querySelectorAll('.ant-modal')].filter((e) => e.offsetParent !== null)[0];
    return d ? d.textContent.trim().slice(0, 80) : null;
  })()`);
  step('rename-dialog', { title: dialogTitle });

  const NEW_NAME = '😀表情文件名-已改名.md';
  await cdp.eval(`(() => {
    const input = [...document.querySelectorAll('.ant-modal input')].filter((e) => e.offsetParent !== null)[0];
    input.focus();
    input.setSelectionRange(0, input.value.length);
    return input.value;
  })()`);
  await sleep(200);
  await cdp.insertText(NEW_NAME);
  await sleep(300);
  const inputValue = await cdp.eval(`[...document.querySelectorAll('.ant-modal input')].filter((e) => e.offsetParent !== null)[0].value`);
  step('rename-input', { value: inputValue });

  await cdp.domClickByText('.ant-modal .ant-btn-primary', '重命名');
  await sleep(1500);
  const renamedPath = path.join(VAULT, NEW_NAME);
  const afterRename = { oldGone: !fs.existsSync(EMOJI), newExists: fs.existsSync(renamedPath) };
  const treeAfter = await cdp.eval(treeSnapshotExpr());
  step('after-rename', { ...afterRename, inTree: treeAfter.files.filter((f) => f.includes('表情')) });

  // rename back
  await osClickElement(cdp, '.tree-file', '表情文件名', { button: 'right' });
  await sleep(900);
  await cdp.domClickByText('.ant-dropdown-menu-item', '重命名');
  await sleep(900);
  await cdp.eval(`(() => {
    const input = [...document.querySelectorAll('.ant-modal input')].filter((e) => e.offsetParent !== null)[0];
    input.focus();
    input.setSelectionRange(0, input.value.length);
    return true;
  })()`);
  await cdp.insertText('😀表情文件名.md');
  await sleep(300);
  await cdp.domClickByText('.ant-modal .ant-btn-primary', '重命名');
  await sleep(1500);
  const treeBack = await cdp.eval(treeSnapshotExpr());
  step('after-rename-back', {
    originalExists: fs.existsSync(EMOJI),
    renamedGone: !fs.existsSync(renamedPath),
    inTree: treeBack.files.filter((f) => f.includes('表情')),
    fileCount: treeBack.fileCount,
  });
} finally {
  try { if (typeof clipBackup === 'string' && clipBackup) await os.clipSet(clipBackup); } catch {}
  fs.writeFileSync(path.join(HERE, 'evidence-s04.json'), JSON.stringify(out, null, 2));
  cdp.close();
}
console.log('DONE');
