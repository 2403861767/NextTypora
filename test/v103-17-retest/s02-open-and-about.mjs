// Items 2 and 8: open the vault through the REAL native folder dialog, verify the tree,
// then read the version out of Preferences -> About.
// Leaves the app running for the later scripts (they reconnect over CDP port 9333).

import path from 'node:path';
import fs from 'node:fs';
import { startApp, chooseFolderInNativeDialog, expandAll, treeSnapshotExpr, backend, os, uia, sleep } from './lib/app.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const EXE = 'D:\\software\\nextTypora\\NextTypora.exe';
const VAULT = path.join(HERE, 'vault');
const USERDATA = path.join(HERE, 'userdata');

const out = { steps: [] };
const step = (name, detail) => { out.steps.push({ name, detail }); console.log(`[${name}] ${JSON.stringify(detail)}`); };

const { cdp, pid } = await startApp({ exe: EXE, userDataDir: USERDATA, port: 9333 });
step('launched', { pid, userDataDir: USERDATA });
fs.writeFileSync(path.join(HERE, 'app.pid'), String(pid));

await os.front(pid);
await sleep(600);

// --- item 2: the real Windows folder picker -------------------------------------------
await cdp.clickSelector('button.toolbar-icon-btn[title^="打开文件夹"]');
const picked = await chooseFolderInNativeDialog(pid, VAULT);
step('native-folder-dialog', picked);
await sleep(1200);
await os.front(pid);

await cdp.waitFor(
  'document.querySelectorAll(\'[aria-label="文件树根目录"] .tree-file, [aria-label="文件树根目录"] .tree-folder-btn\').length > 0',
  { timeout: 40000, label: 'tree populated' },
);
const rounds = await expandAll(cdp);
await sleep(600);
const tree = await cdp.eval(treeSnapshotExpr());
step('tree-after-expand', { expandRounds: rounds, fileCount: tree.fileCount, folderCount: tree.folderCount, files: tree.files, folders: tree.folders });

const index = await backend(cdp, '/api/search/stats');
step('backend-index-stats', index);

const treeApi = await backend(cdp, '/api/tree');
step('backend-tree-status', { status: treeApi.status, hasJson: !!treeApi.json });

// --- item 8: Preferences -> About ------------------------------------------------------
await os.front(pid);
await cdp.key({ key: ',', code: 'Comma', keyCode: 188, modifiers: 2 });
await sleep(900);
await cdp.settleAnimations();
const sections = await cdp.eval(`[...document.querySelectorAll('.settings-section-title')].map((e) => e.textContent.trim())`);
step('settings-sections', sections);

const about = await cdp.eval(`(() => {
  const el = document.querySelector('.settings-about-version');
  return el ? el.textContent.trim() : null;
})()`);
step('about-version', { text: about });

fs.writeFileSync(path.join(HERE, 'evidence-s02.json'), JSON.stringify(out, null, 2));
console.log('DONE');
