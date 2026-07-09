import { describe, expect, it } from 'vitest';
import { detectShortcutConflicts, findShortcutAction, resolveShortcutBindings } from './shortcuts';

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
