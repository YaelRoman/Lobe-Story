import { describe, expect, it } from 'vitest';
import { isTextEntry, isUndoShortcut, neighbourOrder, undoShortcutLabel } from './undoKeys';

describe('isTextEntry', () => {
  it.each(['text', 'number', 'search', 'email', 'url', 'password', 'tel', 'TEXT', ''])('treats <input type="%s"> as a text field', (type) => {
    expect(isTextEntry({ tagName: 'INPUT', type })).toBe(true);
  });

  it.each(['checkbox', 'radio', 'range', 'button', 'submit', 'file', 'color'])('does not treat <input type="%s"> as a text field', (type) => {
    expect(isTextEntry({ tagName: 'INPUT', type })).toBe(false);
  });

  it('treats textareas and editable content as text fields, and nothing else', () => {
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEntry({ tagName: 'textarea' })).toBe(true);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    for (const tagName of ['SELECT', 'BUTTON', 'SUMMARY', 'DIV', 'BODY']) expect(isTextEntry({ tagName })).toBe(false);
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry({})).toBe(false);
  });
});

describe('isUndoShortcut', () => {
  const key = (over: object) => ({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: 'z', code: 'KeyZ', ...over });

  it('accepts Ctrl+Z and Cmd+Z by character or by physical key', () => {
    expect(isUndoShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isUndoShortcut(key({ metaKey: true, key: 'Z' }))).toBe(true);
    expect(isUndoShortcut(key({ ctrlKey: true, key: 'я', code: 'KeyZ' }))).toBe(true);
    expect(isUndoShortcut(key({ ctrlKey: true, key: 'z', code: 'KeyY' }))).toBe(true);
    expect(isUndoShortcut(key({ ctrlKey: true, key: undefined, code: 'KeyZ' }))).toBe(true);
  });

  it('rejects other keys and other modifier combinations', () => {
    expect(isUndoShortcut(key({}))).toBe(false);
    expect(isUndoShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isUndoShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isUndoShortcut(key({ ctrlKey: true, key: 'y', code: 'KeyY' }))).toBe(false);
    expect(isUndoShortcut(key({ ctrlKey: true, key: undefined, code: undefined }))).toBe(false);
  });
});

describe('undoShortcutLabel', () => {
  it('uses the command key on Apple platforms', () => {
    expect(undoShortcutLabel('MacIntel')).toBe('⌘Z');
    expect(undoShortcutLabel('macOS')).toBe('⌘Z');
    expect(undoShortcutLabel('Win32')).toBe('Ctrl+Z');
    expect(undoShortcutLabel('Linux x86_64')).toBe('Ctrl+Z');
    expect(undoShortcutLabel('')).toBe('Ctrl+Z');
  });
});

describe('neighbourOrder', () => {
  it('lists the following items first, then the preceding ones, nearest first', () => {
    expect(neighbourOrder(['a', 'b', 'c', 'd'], 'b')).toEqual(['c', 'd', 'a']);
    expect(neighbourOrder(['a', 'b', 'c'], 'c')).toEqual(['b', 'a']);
    expect(neighbourOrder(['a'], 'a')).toEqual([]);
    expect(neighbourOrder(['a', 'b'], 'x')).toEqual([]);
  });
});
