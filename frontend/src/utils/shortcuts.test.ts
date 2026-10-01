import { describe, expect, it } from 'vitest';
import { detectShortcutConflicts, findShortcutAction, resolveShortcutBindings, shortcutFromKeyboardEvent } from './shortcuts';

function keyboardEvent(init: KeyboardEventInit, target?: Element): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });

  if (!target) return event;

  let captured: KeyboardEvent | undefined;
  target.addEventListener('keydown', ((current: Event) => {
    captured = current as KeyboardEvent;
  }) as EventListener, { once: true });
  target.dispatchEvent(event);
  return captured ?? event;
}

describe('shortcut utilities', () => {
  it('keeps Ctrl+B reserved for the editor instead of toggling the sidebar', () => {
    const bindings = resolveShortcutBindings();

    expect(findShortcutAction(bindings, keyboardEvent({ key: 'b', ctrlKey: true }))).toBeUndefined();
  });

  it('uses Ctrl+Shift+L for sidebar visibility', () => {
    const bindings = resolveShortcutBindings();

    expect(findShortcutAction(bindings, keyboardEvent({ key: 'l', ctrlKey: true, shiftKey: true }))).toBe('toggle-sidebar');
  });

  it('supports Typora-style source mode shortcut and legacy backtick alias', () => {
    const bindings = resolveShortcutBindings();

    expect(findShortcutAction(bindings, keyboardEvent({ key: '/', ctrlKey: true }))).toBe('toggle-source');
    expect(findShortcutAction(bindings, keyboardEvent({ key: '`', ctrlKey: true }))).toBe('toggle-source');
  });

  it('splits current document find and replace actions', () => {
    const bindings = resolveShortcutBindings();

    expect(findShortcutAction(bindings, keyboardEvent({ key: 'f', ctrlKey: true }))).toBe('find-current-document');
    expect(findShortcutAction(bindings, keyboardEvent({ key: 'h', ctrlKey: true }))).toBe('replace-current-document');
  });

  it('resolves immersive writing mode shortcuts', () => {
    const bindings = resolveShortcutBindings();

    expect(findShortcutAction(bindings, keyboardEvent({ key: 'f', ctrlKey: true, altKey: true }))).toBe('toggle-focus-mode');
    expect(findShortcutAction(bindings, keyboardEvent({ key: 't', ctrlKey: true, shiftKey: true }))).toBe('toggle-typewriter-mode');
    expect(findShortcutAction(bindings, keyboardEvent({ key: 'F11' }))).toBe('toggle-distraction-free');
  });

  it('lets CodeMirror source editor keep its own search shortcuts', () => {
    const bindings = resolveShortcutBindings();
    const sourceShell = document.createElement('div');
    sourceShell.className = 'source-editor-shell';
    const sourceInput = document.createElement('textarea');
    sourceShell.append(sourceInput);
    document.body.append(sourceShell);

    expect(findShortcutAction(bindings, keyboardEvent({ key: 'f', ctrlKey: true }, sourceInput))).toBeUndefined();

    sourceShell.remove();
  });

  it('allows only explicit global passthrough actions inside form fields', () => {
    const bindings = resolveShortcutBindings();
    const input = document.createElement('input');
    document.body.append(input);

    expect(findShortcutAction(bindings, keyboardEvent({ key: 'n', ctrlKey: true }, input))).toBeUndefined();
    expect(findShortcutAction(bindings, keyboardEvent({ key: 's', ctrlKey: true }, input))).toBe('save');
    expect(findShortcutAction(bindings, keyboardEvent({ key: ',', ctrlKey: true }, input))).toBe('open-settings');

    input.remove();
  });

  it('reports app shortcuts that collide with editor-reserved keys', () => {
    const bindings = resolveShortcutBindings({
      'open-file': ['Ctrl+B'],
    });

    expect(detectShortcutConflicts(bindings)).toEqual([
      { key: 'Ctrl+B', actionIds: ['open-file', 'bold'] },
    ]);
  });
});

// BUG_BACKLOG_REAL_WORLD.md RW-P3-003：Shift 会改变 event.key（美式键盘上 Shift+1 得到 '!'），
// 而快捷键按 event.key 匹配，所以默认的 Ctrl+Shift+1 / Ctrl+Shift+3 永远匹配不上真实键盘产生的事件
describe('shortcuts typed with Shift on a real keyboard', () => {
  const withCtrlShift = { ctrlKey: true, shiftKey: true };

  it('opens the outline and file sidebars with the events a US keyboard sends', () => {
    const bindings = resolveShortcutBindings();

    expect(findShortcutAction(bindings, keyboardEvent({ key: '!', code: 'Digit1', ...withCtrlShift }))).toBe('open-outline-sidebar');
    expect(findShortcutAction(bindings, keyboardEvent({ key: '#', code: 'Digit3', ...withCtrlShift }))).toBe('open-file-sidebar');
  });

  it('does not depend on the symbol Shift+digit prints on other layouts', () => {
    const bindings = resolveShortcutBindings();

    // 英式键盘 Shift+3 是 £，德语键盘是 §
    expect(findShortcutAction(bindings, keyboardEvent({ key: '£', code: 'Digit3', ...withCtrlShift }))).toBe('open-file-sidebar');
    expect(findShortcutAction(bindings, keyboardEvent({ key: '§', code: 'Digit3', ...withCtrlShift }))).toBe('open-file-sidebar');
    // 法语 AZERTY：Shift+数字行得到的就是数字本身
    expect(findShortcutAction(bindings, keyboardEvent({ key: '1', code: 'Digit1', ...withCtrlShift }))).toBe('open-outline-sidebar');
  });

  it('records the physical digit key when a shortcut is set in the preferences', () => {
    expect(shortcutFromKeyboardEvent({
      key: '!', code: 'Digit1', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true,
    })).toBe('Ctrl+Shift+1');
    expect(shortcutFromKeyboardEvent({
      key: '1', code: 'Digit1', ctrlKey: true, metaKey: true, altKey: false, shiftKey: false,
    })).toBe('Ctrl+Meta+1');
  });

  it('still honours a shortcut recorded before as Ctrl+Shift+! and lets it win over the default', () => {
    // 老版本里默认的 Ctrl+Shift+1 按不出来，用户只能在偏好设置里重新录制：美式键盘上存下来的是 Ctrl+Shift+!
    const bindings = resolveShortcutBindings({ 'export-pdf': ['Ctrl+Shift+!'] });

    expect(findShortcutAction(bindings, keyboardEvent({ key: '!', code: 'Digit1', ...withCtrlShift }))).toBe('export-pdf');
    // 没有自定义时，同一个按键打开大纲
    expect(findShortcutAction(resolveShortcutBindings(), keyboardEvent({ key: '!', code: 'Digit1', ...withCtrlShift }))).toBe('open-outline-sidebar');
  });

  it('leaves everything else alone', () => {
    const bindings = resolveShortcutBindings();

    // 没有 code 的事件（现有用例的写法）仍按 key 匹配；Meta+Ctrl+1 是 macOS 的默认写法
    expect(findShortcutAction(bindings, keyboardEvent({ key: '1', ...withCtrlShift }))).toBe('open-outline-sidebar');
    expect(findShortcutAction(bindings, keyboardEvent({ key: '1', code: 'Digit1', ctrlKey: true, metaKey: true }))).toBe('open-outline-sidebar');
    // 没有绑定的数字键组合不触发任何操作
    expect(findShortcutAction(bindings, keyboardEvent({ key: '1', code: 'Digit1', ctrlKey: true }))).toBeUndefined();
    expect(findShortcutAction(bindings, keyboardEvent({ key: '@', code: 'Digit2', ...withCtrlShift }))).toBeUndefined();
    // 字母键仍按 key 匹配
    expect(findShortcutAction(bindings, keyboardEvent({ key: 'L', code: 'KeyL', ...withCtrlShift }))).toBe('toggle-sidebar');
  });
});
