// Item 1 (the part the app controls) + the ticket's pre-install identity check.
//
// The shell will not route .md/.markdown to NextTypora on this machine (UserChoice = Typora,
// and .markdown resolves to OpenWith.exe), so instead we run EXACTLY the command the installer
// registered - NextTypora.exe "%1" - which is what Explorer would run if it did win.
//
// This run deliberately uses the REAL user-data dir, because the ticket's precondition is
// "does a new %APPDATA%\NextTypora directory appear?". settings.json is backed up and restored
// by the caller.

import path from 'node:path';
import { startApp, os, sleep } from './lib/app.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const EXE = 'D:\\software\\nextTypora\\NextTypora.exe';
const FILE = path.join(HERE, 'assoc-check.markdown');

const out = { item: 'assoc-command + identity pin', steps: [] };
const step = (name, detail) => { out.steps.push({ name, detail }); console.log(`[${name}] ${JSON.stringify(detail)}`); };

const { cdp, pid } = await startApp({ exe: EXE, userDataDir: null, port: 9333, extraArgs: [FILE] });
step('launched', { pid, args: ['--remote-debugging-port=9333', FILE] });

try {
  await os.front(pid);
  // The note opens asynchronously: the backend has to boot (embedded JRE) before the read lands.
  const shown = await cdp.waitFor(
    `(() => {
       const t = document.body.innerText || '';
       return t.includes('assoc-check-v10317') ? t.slice(0, 200) : null;
     })()`,
    { timeout: 90000, interval: 500, label: 'opened file visible in the editor' },
  );
  step('file-opened-via-registered-command', { excerpt: shown.replace(/\s+/g, ' ').slice(0, 120) });

  const tabs = await cdp.eval(`[...document.querySelectorAll('.editor-tab-title, .editor-tab')].map((e) => e.textContent.trim()).slice(0, 5)`);
  step('tabs', tabs);

  const version = await cdp.eval(`(async () => { try { return await window.nextTyproa.getAppVersion?.(); } catch { return null; } })()`);
  const settings = await cdp.eval(`(async () => { const s = await window.nextTyproa.getAppSettings(); return { lastWorkspace: s.lastWorkspace ?? null, openTabs: (s.openTabs || []).length }; })()`);
  step('app-settings-seen', { version, ...settings });

  const cfg = await cdp.eval(`(async () => { const c = await window.nextTyproa.getBackendConfig(); return { port: c.port, tokenLength: (c.token || '').length }; })()`);
  step('backend-config', cfg);
} finally {
  // Quit through the title-bar button (the packaged build has no menu accelerators).
  try {
    await cdp.clickSelector('.window-close-btn');
  } catch (err) {
    step('close-button-missing', { error: String(err.message) });
    await os.keys('alt+f4');
  }
  await sleep(4000);
  cdp.close();
}

console.log('RESULT ' + JSON.stringify(out));
