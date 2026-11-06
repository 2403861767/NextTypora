// Minimal CDP driver for the packaged NextTypora build.
// The V103-17 retest harness that used to live under test/*-verify/evidence/scripts was
// gitignored and died with 799a03f, so this is a fresh, smaller rebuild: just what the
// 10 retest items need.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CDP_TIMEOUT = 30000; // a covered window stops updating rAF; never hang forever

export async function httpJson(port, path = '/json') {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!res.ok) throw new Error(`CDP http ${res.status} for ${path}`);
  return res.json();
}

/**
 * The app opens a data: URL splash BrowserWindow BEFORE the real window, and closes it once
 * the renderer is ready. Attaching to the splash means every later Runtime.evaluate hangs
 * until the 30 s timeout, because the target is gone. Only the renderer target counts.
 */
export async function waitForTarget(port, { timeout = 90000 } = {}) {
  const deadline = Date.now() + timeout;
  let lastSeen = [];
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const targets = await httpJson(port);
      lastSeen = targets.map((t) => `${t.type}:${t.url.slice(0, 60)}`);
      const page = targets.find(
        (t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.startsWith('data:') && /index\.html|localhost:5173/.test(t.url),
      );
      if (page) return page;
    } catch (err) {
      lastErr = err;
    }
    await sleep(500);
  }
  throw new Error(`no renderer CDP target on ${port} (saw ${JSON.stringify(lastSeen)}): ${lastErr?.message ?? 'timeout'}`);
}

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error)})`));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  static async open(port, { timeout = 60000 } = {}) {
    const target = await waitForTarget(port, { timeout });
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP websocket error')), { once: true });
    });
    const cdp = new Cdp(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.id;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, CDP_TIMEOUT);
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(payload);
    });
  }

  /** Evaluate an expression in the page. Top-level await is allowed. */
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      allowUnsafeEvalBlocklistBypass: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    }
    return result.result.value;
  }

  async waitFor(expression, { timeout = 20000, interval = 200, label = expression } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      last = await this.eval(expression);
      if (last) return last;
      await sleep(interval);
    }
    throw new Error(`waitFor timed out: ${label} (last=${JSON.stringify(last)})`);
  }

  /**
   * antd menus/modals animate; a click during the animation hits the mask (= cancel).
   * Best-effort only: a window that is not actually rendering (occluded, or driven from
   * another app in the foreground) freezes rAF, so getAnimations() never drains. Waiting
   * is worth it when it works, but it must never fail the scenario.
   */
  async settleAnimations({ timeout = 5000 } = {}) {
    try {
      await this.waitFor(
        'document.getAnimations().filter((a) => a.playState === "running").length === 0',
        { timeout, label: 'animations settled' },
      );
    } catch {
      await sleep(900); // stalled animations: give the DOM a beat and carry on
      return false;
    }
    await sleep(120);
    return true;
  }

  async rect(selector) {
    return this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, visible: el.offsetParent !== null || getComputedStyle(el).position === 'fixed' };
    })()`);
  }

  /** Real mouse click through the renderer (antd needs mousedown/up, not just .click()). */
  async mouseClick(x, y, { clickCount = 1 } = {}) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type, x, y, button: 'left', clickCount, buttons: type === 'mousePressed' ? 1 : 0,
      });
    }
  }

  /**
   * In-app clicking goes through the DOM, not through Input.dispatchMouseEvent coordinates:
   * a coordinate click on a file-tree row silently did nothing even though elementFromPoint
   * at that exact centre returned the row itself. Native dialogs still get real OS input.
   */
  async domClickByText(selector, needle, { nth = -1 } = {}) {
    const res = await this.eval(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .filter((e) => e.offsetParent !== null && (e.textContent || '').includes(${JSON.stringify(needle)}));
      if (!els.length) return null;
      const el = ${nth} < 0 ? els[els.length - 1] : els[${nth}];
      el.scrollIntoView({ block: 'center' });
      el.click();
      return { text: (el.textContent || '').trim().slice(0, 60), className: el.className, count: els.length };
    })()`);
    if (!res) throw new Error(`no visible ${selector} containing ${JSON.stringify(needle)}`);
    return res;
  }

  /** antd Dropdown trigger={['contextMenu']} listens for a bubbling contextmenu event. */
  async domContextMenuByText(selector, needle) {
    const res = await this.eval(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .filter((e) => e.offsetParent !== null && (e.textContent || '').includes(${JSON.stringify(needle)}));
      const el = els[els.length - 1];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: window, button: 2, buttons: 2,
        clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
      }));
      return { text: (el.textContent || '').trim().slice(0, 60) };
    })()`);
    if (!res) throw new Error(`no visible ${selector} containing ${JSON.stringify(needle)}`);
    return res;
  }

  /** Right-click, for the file tree's antd contextMenu Dropdown. */
  async rightClick(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1, buttons: 2 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1, buttons: 0 });
  }

  async rightClickByText(selector, needle) {
    const box = await this.eval(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .filter((e) => e.offsetParent !== null && (e.textContent || '').includes(${JSON.stringify(needle)}));
      const el = els[els.length - 1];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || '').trim().slice(0, 60) };
    })()`);
    if (!box) throw new Error(`no visible ${selector} containing ${JSON.stringify(needle)}`);
    await this.rightClick(box.x, box.y);
    return box;
  }

  async clickSelector(selector, { nth = 0 } = {}) {
    const box = await this.eval(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.offsetParent !== null);
      const el = els[${nth}];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || '').trim().slice(0, 40) };
    })()`);
    if (!box) throw new Error(`no visible element for ${selector} [${nth}]`);
    await this.mouseClick(box.x, box.y);
    return box;
  }

  /** Click whichever visible element matches selector and whose text contains needle. */
  async clickByText(selector, needle) {
    const box = await this.eval(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .filter((e) => e.offsetParent !== null && (e.textContent || '').includes(${JSON.stringify(needle)}));
      const el = els[els.length - 1];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || '').trim().slice(0, 60) };
    })()`);
    if (!box) throw new Error(`no visible ${selector} containing ${JSON.stringify(needle)}`);
    await this.mouseClick(box.x, box.y);
    return box;
  }

  async insertText(text) {
    await this.send('Input.insertText', { text });
  }

  /** key: { key, code, keyCode, modifiers } - modifiers: alt 1, ctrl 2, meta 4, shift 8 */
  async key(desc) {
    const base = { key: desc.key, code: desc.code, windowsVirtualKeyCode: desc.keyCode, nativeVirtualKeyCode: desc.keyCode, modifiers: desc.modifiers ?? 0 };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    if (desc.text) await this.send('Input.dispatchKeyEvent', { type: 'char', text: desc.text, ...base });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  close() {
    try { this.ws.close(); } catch { /* already gone */ }
  }
}

/** Spawn the installed exe with an args array - never through cmd.exe with a quoted --user-data-dir. */
export function launch(exe, args, { env = {} } = {}) {
  const child = spawn(exe, args, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...env },
  });
  child.unref();
  return child;
}

export { sleep };
