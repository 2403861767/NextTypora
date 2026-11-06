// Item 5: drag 附件/拖拽测试.png out of a real Explorer window and drop it on the editor.
//
// The historical substitute was a synthetic paste, which bypasses the drop event and the
// real file path - the two things that actually matter here. This uses a real OLE drag:
// mouse down on the Explorer row, move across the screen, release over the editor.

import path from 'node:path';
import fs from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Cdp, toScreen, os, sleep } from './lib/app.mjs';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const VAULT = path.join(HERE, 'vault');
const ATTACH = path.join(VAULT, '附件');
const NOTE_ASSETS = path.join(VAULT, '打包版新笔记.assets');
const pid = Number(fs.readFileSync(path.join(HERE, 'app.pid'), 'utf8').trim());

const out = { steps: [] };
const step = (name, detail) => { out.steps.push({ name, detail }); console.log(`[${name}] ${JSON.stringify(detail)}`); };
const psFile = (script, args) => execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'lib', script), ...args], { windowsHide: true }).then((r) => r.stdout.trim());

const cdp = await Cdp.open(9333);
try {
  const screen = await psFile('osinput.ps1', ['-Action', 'screen']);
  const [sw, sh] = screen.split('x').map(Number);
  step('screen', { physical: screen });

  // App on the right half, Explorer on the left. Browser.getWindowForTarget is not exposed
  // on Electron's page endpoint, so place the real window through SetWindowPos (physical px).
  await psFile('osinput.ps1', ['-Action', 'place', '-ProcessId', String(pid),
    '-X', String(Math.round(sw / 2)), '-Y', '0', '-ToX', String(Math.round(sw / 2)), '-ToY', String(sh - 80)]);
  await sleep(1200);
  step('app-window-placed', await cdp.eval(`({ screenX: window.screenX, screenY: window.screenY, inner: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio })`));

  // Make sure the target note is open and the editor is wide enough to aim at.
  await cdp.domClickByText('.sidebar-tab', 'Files', { nth: 0 });
  await sleep(500);
  await cdp.domClickByText('.tree-file', '打包版新笔记.md');
  await cdp.waitFor(`(() => !!document.querySelector('.ProseMirror'))()`, { timeout: 20000, label: 'note open' });
  await sleep(600);

  const assetsBefore = fs.existsSync(NOTE_ASSETS) ? fs.readdirSync(NOTE_ASSETS) : [];
  const mdBefore = fs.readFileSync(path.join(VAULT, '打包版新笔记.md'), 'utf8');
  step('before', { assetsBefore, mdBefore });

  // Open Explorer on the attachments folder and park it on the left half.
  spawn('explorer.exe', [ATTACH], { detached: true, stdio: 'ignore' }).unref();
  await sleep(3500);
  const expHwnd = await psFile('explorer.ps1', ['-Action', 'hwnd', '-Folder', ATTACH]);
  const expPid = await execFileAsync('powershell.exe', ['-NoProfile', '-Command',
    `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class P{[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);}'; $p=0; [void][P]::GetWindowThreadProcessId([IntPtr]${expHwnd}, [ref]$p); $p`],
    { windowsHide: true }).then((r) => r.stdout.trim());
  await psFile('osinput.ps1', ['-Action', 'place', '-ProcessId', expPid, '-X', '0', '-Y', '0', '-ToX', String(Math.round(sw / 2)), '-ToY', String(sh - 80)]);
  await sleep(1200);

  const found = await psFile('explorer.ps1', ['-Action', 'find', '-Folder', ATTACH, '-Item', '拖拽测试.png']);
  const [, rect] = found.split('|');
  const [ix, iy, iw, ih] = rect.split(',').map(Number);
  step('explorer-item', { hwnd: expHwnd, expPid, rect, centre: [ix + iw / 2, iy + ih / 2] });

  // Target: the middle of the editor, in physical screen px.
  const editorCss = await cdp.eval(`(() => {
    const pm = document.querySelector('.ProseMirror');
    const r = pm.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + Math.min(r.height - 20, 160) };
  })()`);
  const target = await toScreen(cdp, editorCss.x, editorCss.y);
  step('drop-target', { editorCss, target: { x: target.x, y: target.y } });

  await os.drag(ix + iw / 2, iy + ih / 2, target.x, target.y);
  await sleep(3500);

  const mdAfter = fs.readFileSync(path.join(VAULT, '打包版新笔记.md'), 'utf8');
  const assetsAfter = fs.existsSync(NOTE_ASSETS) ? fs.readdirSync(NOTE_ASSETS) : [];
  const imgsInEditor = await cdp.eval(`document.querySelectorAll('.ProseMirror img').length`);
  const toasts = await cdp.eval(`JSON.stringify([...document.querySelectorAll('.ant-message-notice-content')].map((e) => e.textContent.trim()))`);
  step('after-drop', {
    imagesInEditor: imgsInEditor,
    assetsAfter,
    assetsDirCreated: assetsAfter.length > assetsBefore.length,
    mdChanged: mdAfter !== mdBefore,
    mdAfter,
    toasts,
  });
} finally {
  fs.writeFileSync(path.join(HERE, 'evidence-s07.json'), JSON.stringify(out, null, 2));
  cdp.close();
}
console.log('DONE');
