// Item 7, done right: type, then Alt+F4 inside the 800 ms autosave debounce.
//
// First attempt was invalid: the machine's active input language is Chinese, so a letter
// keystroke opens an IME composition and the Alt+F4 that follows goes to the IME, not the
// window - the app looked like it refused to quit when it had never been asked. So switch
// the window to US English for the edit, and put the language back afterwards.

import path from 'node:path';
import fs from 'node:fs';
import { startApp, Cdp, osClickElement, os, sleep } from './lib/app.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const VAULT = path.join(HERE, 'vault');
const NOTE = path.join(VAULT, '日记', '2026-09-23.md');
const EXE = String.raw`D:\software\nextTypora\NextTypora.exe`;
const USERDATA = path.join(HERE, 'userdata');

const out = { steps: [] };
const step = (name, detail) => { out.steps.push({ name, detail }); console.log(`[${name}] ${JSON.stringify(detail)}`); };

// the previous repro left an instance running
const stale = Number(fs.readFileSync(path.join(HERE, 'app.pid'), 'utf8').trim());
if ((await os.alive(stale)) === 'yes') {
  const c = await Cdp.open(9333).catch(() => null);
  if (c) { try { await c.eval(`document.querySelector('.window-close-btn').click()`); } catch {} c.close(); }
  await sleep(5000);
  step('closed-stale-instance', { pid: stale, alive: await os.alive(stale) });
}

const { cdp, pid } = await startApp({ exe: EXE, userDataDir: USERDATA, port: 9333 });
fs.writeFileSync(path.join(HERE, 'app.pid'), String(pid));
await os.front(pid);
await sleep(1200);
await cdp.waitFor(`(() => document.querySelectorAll('.tree-file').length > 0 ? true : null)()`, { timeout: 40000, label: 'tree' });

const before = fs.readFileSync(NOTE, 'utf8');
step('before', { pid, bytes: Buffer.byteLength(before), text: before });

await cdp.domClickByText('.tree-file', '2026-09-23.md');
await cdp.waitFor(`(() => { const pm = document.querySelector('.ProseMirror'); return pm && pm.innerText.trim() ? true : null; })()`, { timeout: 30000, label: 'note open' });
await sleep(800);
await osClickElement(cdp, '.ProseMirror', '');
await sleep(400);
await os.keys('ctrl+end', pid);
await sleep(250);

// English layout, so the letter commits immediately with no composition in the way.
await os.ime('00000409');
await sleep(900);
await cdp.eval(`(() => { window.__ev = []; window.addEventListener('beforeunload', () => window.__ev.push('beforeunload'), true); const pm = document.querySelector('.ProseMirror'); pm.addEventListener('compositionstart', () => window.__ev.push('compositionstart'), true); return true; })()`);

await os.keys('z,alt+f4', pid);
step('typed-and-quit', { note: 'single osinput call: z then alt+f4 ~60ms later' });

const exitedAt = await (async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    if ((await os.alive(pid)) === 'no') return Date.now() - t0;
    await sleep(800);
  }
  return null;
})();
step('process-exit', { exitedAfterMs: exitedAt, exited: exitedAt !== null });
try { cdp.close(); } catch {}

await sleep(1500);
const after = fs.readFileSync(NOTE, 'utf8');
step('on-disk-after-quit', {
  bytes: Buffer.byteLength(after),
  text: after,
  changed: after !== before,
  keptTheEdit: after.includes('z'),
});

// Reopen and confirm the edit is there.
if (exitedAt !== null) {
  const again = await startApp({ exe: EXE, userDataDir: USERDATA, port: 9333 });
  fs.writeFileSync(path.join(HERE, 'app.pid'), String(again.pid));
  await os.front(again.pid);
  const restored = await again.cdp.waitFor(`(() => {
    const pm = document.querySelector('.ProseMirror');
    return pm && pm.innerText.trim() ? pm.innerText.slice(0, 120) : null;
  })()`, { timeout: 60000, label: 'restored editor' }).catch((e) => `TIMEOUT ${e.message}`);
  const chip = await again.cdp.eval(`document.querySelector('.statusbar-doc-chip') && document.querySelector('.statusbar-doc-chip').textContent`).catch(() => null);
  step('after-relaunch', { restoredText: String(restored).replace(/\s+/g, ' '), docChip: chip, hasEdit: String(restored).includes('z') });
  again.cdp.close();
}

// put the input language back the way the user had it
await os.front(Number(fs.readFileSync(path.join(HERE, 'app.pid'), 'utf8').trim())).catch(() => {});
await os.ime('00000804').catch(() => {});
step('input-language-restored', { klid: '00000804' });

fs.writeFileSync(path.join(HERE, 'evidence-s08b.json'), JSON.stringify(out, null, 2));
console.log('DONE');
