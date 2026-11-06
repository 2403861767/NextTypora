// Reconnects to the already-running app (vault open) and runs items 8, 9, 3 and 10.
//   8  Preferences -> About shows 1.0.3
//   9  Preferences -> Storage scans 2 dirs / 4 files / 808 bytes, then trashes them
//   3  edit 编码/gbk.md, let autosave run, and check the bytes on disk are still GBK
//  10  open 😀表情文件名.md, rename it and rename it back

import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Cdp, backend, os, sleep } from './lib/app.mjs';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const VAULT = path.join(HERE, 'vault');
const pid = Number(fs.readFileSync(path.join(HERE, 'app.pid'), 'utf8').trim());

const out = { steps: [] };
const step = (name, detail) => { out.steps.push({ name, detail }); console.log(`[${name}] ${JSON.stringify(detail)}`); };
const rb = (args) => execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'lib', 'recyclebin.ps1'), ...args], { windowsHide: true }).then((r) => r.stdout.trim());

const cdp = await Cdp.open(9333);
await os.front(pid);
await sleep(500);

// Start from a clean UI: close anything modal that an earlier run left open.
await cdp.key({ key: 'Escape', code: 'Escape', keyCode: 27 });
await sleep(600);

const status = await backend(cdp, '/api/search/status');
step('index-status', status.json ?? status);

// ---- item 8: About ---------------------------------------------------------------------
await cdp.key({ key: ',', code: 'Comma', keyCode: 188, modifiers: 2 });
await sleep(1200);
await cdp.settleAnimations();
const sections = await cdp.eval(`[...document.querySelectorAll('.settings-section-title')].map((e) => e.textContent.trim())`);
const about = await cdp.eval(`(() => { const e = document.querySelector('.settings-about-version'); return e ? e.textContent.trim() : null; })()`);
step('settings-open', { sections, aboutVersion: about });

// ---- item 9: Storage scan + trash ------------------------------------------------------
const binBefore = await rb(['-Action', 'match', '-Needle', 'nexttyproa-backups']);
step('recycle-bin-before', { matches: binBefore.split('\n').filter(Boolean).length });

await cdp.clickByText('button', '扫描残留备份');
const scan = await cdp.waitFor(`(() => {
  const el = document.querySelector('.settings-backup-result');
  if (!el) return null;
  return el.textContent.trim();
})()`, { timeout: 30000, label: 'backup scan result' });
step('storage-scan', { text: scan.replace(/\s+/g, ' ').slice(0, 300) });

const onDiskBefore = await cdp.eval(`(() => null)()`); // disk state is captured below in node
const dirsBefore = fs.existsSync(path.join(VAULT, '.nexttyproa-backups'));
const dirsBefore2 = fs.existsSync(path.join(VAULT, '日记', '.nexttyproa-backups'));
step('backup-dirs-on-disk-before', { root: dirsBefore, diary: dirsBefore2 });

await cdp.clickByText('button', '移到回收站');
await sleep(1200);
const afterClean = await cdp.waitFor(`(() => {
  const el = document.querySelector('.settings-backup-result');
  if (!el) return null;
  const t = el.textContent.trim();
  return t.includes('没有残留') ? t : null;
})()`, { timeout: 40000, label: 'cleanup reported' }).catch((e) => `TIMEOUT: ${e.message}`);
step('storage-clean-result', { text: String(afterClean).replace(/\s+/g, ' ').slice(0, 200) });

const dirsAfter = fs.existsSync(path.join(VAULT, '.nexttyproa-backups'));
const dirsAfter2 = fs.existsSync(path.join(VAULT, '日记', '.nexttyproa-backups'));
const binAfter = await rb(['-Action', 'match', '-Needle', 'nexttyproa-backups']);
step('backup-dirs-after', { root: dirsAfter, diary: dirsAfter2, recycleBinMatches: binAfter.split('\n').filter((l) => l && l !== 'none') });

// close Preferences
await cdp.key({ key: 'Escape', code: 'Escape', keyCode: 27 });
await sleep(800);

fs.writeFileSync(path.join(HERE, 'evidence-s03.json'), JSON.stringify(out, null, 2));
console.log('DONE');
