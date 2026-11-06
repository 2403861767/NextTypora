// NextTypora-specific helpers on top of cdp.mjs: launching the installed build,
// driving the native dialogs, and reading the file tree.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { Cdp, launch, sleep } from './cdp.mjs';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const OSINPUT = path.join(HERE, 'osinput.ps1');
const UIA = path.join(HERE, 'uia.ps1');

async function ps(script, args) {
  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  );
  if (stderr && stderr.trim()) throw new Error(`${path.basename(script)} stderr: ${stderr.trim()}`);
  return stdout.trim();
}

export const os = {
  windows: (pid) => ps(OSINPUT, ['-Action', 'windows', '-ProcessId', String(pid)]),
  alive: (pid) => ps(OSINPUT, ['-Action', 'alive', '-ProcessId', String(pid)]),
  screen: () => ps(OSINPUT, ['-Action', 'screen']),
  place: (pid, x, y, w, h) => ps(OSINPUT, ['-Action', 'place', '-ProcessId', String(pid), '-X', String(x), '-Y', String(y), '-ToX', String(w), '-ToY', String(h)]),
  front: (pid, topmost = true) => ps(OSINPUT, ['-Action', 'front', '-ProcessId', String(pid), ...(topmost ? ['-Topmost'] : [])]),
  // Pass a pid whenever the keystroke is destructive (alt+f4): osinput refuses to type
  // into a foreground window that is not the app's.
  keys: (chords, pid = 0) => ps(OSINPUT, ['-Action', 'keys', '-Keys', chords, ...(pid ? ['-ProcessId', String(pid)] : [])]),
  text: (t) => ps(OSINPUT, ['-Action', 'text', '-Text', t]),
  click: (x, y, double = false, button = 'left') => ps(OSINPUT, ['-Action', 'click', '-X', String(Math.round(x)), '-Y', String(Math.round(y)), '-Button', button, ...(double ? ['-Double'] : [])]),
  move: (x, y) => ps(OSINPUT, ['-Action', 'move', '-X', String(Math.round(x)), '-Y', String(Math.round(y))]),
  drag: (fx, fy, tx, ty) => ps(OSINPUT, ['-Action', 'drag', '-FromX', String(Math.round(fx)), '-FromY', String(Math.round(fy)), '-ToX', String(Math.round(tx)), '-ToY', String(Math.round(ty))]),
  ime: (klid) => ps(OSINPUT, ['-Action', 'ime', '-Klid', klid]),
  clipGet: () => ps(OSINPUT, ['-Action', 'clipget']),
  clipSet: (t) => ps(OSINPUT, ['-Action', 'clipset', '-Text', t]),
};

export const uia = {
  state: (hwnd = 0) => ps(UIA, ['-Action', 'state', ...(hwnd ? ['-Hwnd', String(hwnd)] : [])]),
  dump: (hwnd = 0) => ps(UIA, ['-Action', 'dump', ...(hwnd ? ['-Hwnd', String(hwnd)] : [])]),
  click: (automationId, hwnd = 0) => ps(UIA, ['-Action', 'click', '-AutomationId', String(automationId), ...(hwnd ? ['-Hwnd', String(hwnd)] : [])]),
  setEdit: (value, hwnd = 0) => ps(UIA, ['-Action', 'setedit', '-Value', value, ...(hwnd ? ['-Hwnd', String(hwnd)] : [])]),
};

/** Wait for the app's own #32770 common dialog; returns { hwnd, title, rect }. */
export async function waitDialog(pid, seconds = 25) {
  const line = await ps(OSINPUT, ['-Action', 'waitdialog', '-ProcessId', String(pid), '-Seconds', String(seconds)]);
  const [hwnd, title, rect] = line.split('|');
  return { hwnd: Number(hwnd), title, rect };
}

export async function waitNoDialog(pid, seconds = 20) {
  return ps(OSINPUT, ['-Action', 'nodialog', '-ProcessId', String(pid), '-Seconds', String(seconds)]);
}

export async function startApp({ exe, userDataDir, port = 9333, extraArgs = [] }) {
  const args = [`--remote-debugging-port=${port}`];
  if (userDataDir) args.push(`--user-data-dir=${userDataDir}`);
  args.push(...extraArgs);
  const child = launch(exe, args);
  const cdp = await Cdp.open(port, { timeout: 90000 });
  // The app boots its own backend on a random port; wait for the renderer to be usable.
  await cdp.waitFor('!!document.querySelector(".app-shell, #root > *")', { timeout: 60000, label: 'renderer mounted' });
  return { cdp, pid: child.pid, child };
}

/** Window bounds in screen px, plus the CSS->screen scale, so OS clicks can be aimed. */
export async function windowGeometry(cdp) {
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  const { bounds } = await cdp.send('Browser.getWindowBounds', { windowId });
  const page = await cdp.eval(`({ dpr: window.devicePixelRatio, iw: window.innerWidth, ih: window.innerHeight, ox: window.screenX, oy: window.screenY })`);
  return { windowId, bounds, ...page };
}

/**
 * CSS px inside the page -> PHYSICAL screen px, which is what the DPI-aware osinput.ps1
 * wants. window.screenX/Y are logical CSS px of the screen space, so both the origin and
 * the offset scale by devicePixelRatio. The window is frameless (titleBarStyle: 'hidden'),
 * so the viewport origin is the window origin.
 */
export async function toScreen(cdp, x, y) {
  const g = await cdp.eval(`({ ox: window.screenX, oy: window.screenY, dpr: window.devicePixelRatio })`);
  return { x: Math.round((g.ox + x) * g.dpr), y: Math.round((g.oy + y) * g.dpr), geometry: g };
}

/** Centre of a visible element matching selector+text, in physical screen px. */
export async function elementScreenPoint(cdp, selector, needle) {
  const box = await cdp.eval(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter((e) => e.offsetParent !== null && (e.textContent || '').includes(${JSON.stringify(needle)}));
    const el = els[els.length - 1];
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!box) throw new Error(`no visible ${selector} containing ${JSON.stringify(needle)}`);
  const pt = await toScreen(cdp, box.x, box.y);
  return { ...pt, css: box };
}

/** A real OS click (left or right) on an in-app element - needed for antd context menus. */
export async function osClickElement(cdp, selector, needle, { button = 'left', double = false } = {}) {
  const pt = await elementScreenPoint(cdp, selector, needle);
  await os.click(pt.x, pt.y, double, button);
  return pt;
}

export async function setWindowBounds(cdp, bounds) {
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds });
  await sleep(400);
}

/**
 * Drive the real folder picker: Alt+D puts the caret in the address bar, paste the path,
 * Enter navigates, then the Select Folder button (AutomationId 1, a Pane with class Button)
 * is clicked for real. Pasting into the folder-name box is unreliable; this path is not.
 */
export async function chooseFolderInNativeDialog(pid, folder) {
  const dlg = await waitDialog(pid, 30);
  await sleep(500);
  await os.keys('alt+d');
  await sleep(400);
  await os.clipSet(folder);
  await os.keys('ctrl+v');
  await sleep(350);
  await os.keys('enter');
  await sleep(1100);
  const clicked = await uia.click(1, dlg.hwnd);
  await waitNoDialog(pid, 20);
  return { dialog: dlg, clicked };
}

/** Drive the real save-as dialog: put the full path in the file-name box, then Save. */
export async function saveInNativeDialog(pid, fullPath) {
  const dlg = await waitDialog(pid, 30);
  await sleep(600);
  const how = await uia.setEdit(fullPath, dlg.hwnd);
  if (!how.includes(path.basename(fullPath))) {
    throw new Error(`file-name box does not hold the target name after setting it: ${how}`);
  }
  await sleep(400);
  const clicked = await uia.click(1, dlg.hwnd);
  await waitNoDialog(pid, 25);
  return { dialog: dlg, clicked, how };
}

export async function openWorkspace(cdp, pid, folder) {
  await os.front(pid);
  await cdp.clickSelector('button.toolbar-icon-btn[title^="打开文件夹"]');
  const dialog = await chooseFolderInNativeDialog(pid, folder);
  await os.front(pid);
  await cdp.waitFor(
    'document.querySelectorAll(\'[aria-label="文件树根目录"] .tree-file, [aria-label="文件树根目录"] .tree-folder-btn\').length > 0',
    { timeout: 30000, label: 'file tree populated' },
  );
  return dialog;
}

/** Click every collapsed folder until none is left, so the tree shows all files. */
export async function expandAll(cdp, { rounds = 8 } = {}) {
  for (let i = 0; i < rounds; i++) {
    const clicked = await cdp.eval(`(() => {
      const collapsed = [...document.querySelectorAll('[aria-label="文件树根目录"] .tree-folder-btn')]
        .filter((b) => !b.querySelector('.tree-caret.expanded'));
      collapsed.forEach((b) => b.click());
      return collapsed.length;
    })()`);
    await sleep(350);
    if (!clicked) return i;
  }
  return rounds;
}

/** Every row the file tree shows. */
export function treeSnapshotExpr() {
  return `(() => {
    const root = document.querySelector('[aria-label="文件树根目录"]');
    if (!root) return null;
    const files = [...root.querySelectorAll('.tree-file-label')].map((e) => e.textContent.trim());
    const folders = [...root.querySelectorAll('.tree-folder-label')].map((e) => e.textContent.trim());
    return { files, folders, fileCount: files.length, folderCount: folders.length };
  })()`;
}

/** Query the app's OWN backend (same port and token the renderer uses). */
export async function backend(cdp, apiPath, init = 'undefined') {
  return cdp.eval(`(async () => {
    const cfg = await window.nextTyproa.getBackendConfig();
    const res = await fetch('http://127.0.0.1:' + cfg.port + ${JSON.stringify(apiPath)}, Object.assign(
      { headers: { 'X-Auth-Token': cfg.token, 'Content-Type': 'application/json' } },
      ${init} || {},
    ));
    const text = await res.text();
    try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, text }; }
  })()`);
}

export { sleep, Cdp };
