// Item 1, the half the app controls: the command the installer registered for .md/.markdown
// is  NextTypora.exe "%1"  - so run exactly that and confirm the file opens.
// (Which handler Windows actually picks is a separate question, answered by AssocQueryString.)

import path from 'node:path';
import fs from 'node:fs';
import { startApp, os, sleep } from './lib/app.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const EXE = String.raw`D:\software\nextTypora\NextTypora.exe`;
const USERDATA = path.join(HERE, 'userdata-argv');
const FILE = path.join(HERE, 'assoc-check.markdown');

const stale = Number(fs.readFileSync(path.join(HERE, 'app.pid'), 'utf8').trim());
if ((await os.alive(stale)) === 'yes') {
  await os.front(stale).catch(() => {});
  await os.keys('alt+f4', stale).catch(() => {});
  await sleep(6000);
  console.log('stale instance alive:', await os.alive(stale));
}

const { cdp, pid } = await startApp({ exe: EXE, userDataDir: USERDATA, port: 9335, extraArgs: [FILE] });
console.log('launched with the file as argv, pid', pid);
await os.front(pid);

const shown = await cdp.waitFor(`(() => {
  const pm = document.querySelector('.ProseMirror');
  if (!pm) return null;
  const t = pm.innerText || '';
  return t.includes('assoc-check-v10317') ? t.slice(0, 120) : null;
})()`, { timeout: 90000, interval: 500, label: 'file opened from argv' }).catch((e) => `TIMEOUT: ${e.message}`);
const chip = await cdp.eval(`document.querySelector('.statusbar-doc-chip') && document.querySelector('.statusbar-doc-chip').textContent`);
console.log('RESULT', JSON.stringify({ docChip: chip, excerpt: String(shown).replace(/\s+/g, ' ').slice(0, 120) }));

await os.keys('alt+f4', pid);
await sleep(5000);
console.log('closed:', await os.alive(pid));
try { cdp.close(); } catch {}
