import { describe, expect, it } from 'vitest';
import { copyShortcut, onCopyMark } from './copyKeys';

const key = (over: Partial<Parameters<typeof copyShortcut>[0]> = {}) => ({ key: 'c', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...over });

describe('copyShortcut', () => {
  it('is Ctrl or Cmd + C with nothing selected', () => {
    expect(copyShortcut(key(), { isCollapsed: true })).toBe(true);
    expect(copyShortcut(key({ ctrlKey: false, metaKey: true, key: 'C' }), null)).toBe(true);
  });
  it('leaves the browser alone with a selection, other keys or extra modifiers', () => {
    expect(copyShortcut(key(), { isCollapsed: false })).toBe(false);
    expect(copyShortcut(key({ key: 'v' }), null)).toBe(false);
    expect(copyShortcut(key({ ctrlKey: false }), null)).toBe(false);
    expect(copyShortcut(key({ shiftKey: true }), null)).toBe(false);
  });
});

describe('onCopyMark', () => {
  const rect = { left: 100, right: 160, top: 10, bottom: 44 };
  it('is the small mark at the left edge of a wide enough cell that was already focused', () => {
    expect(onCopyMark(106, 27, rect, true)).toBe(true);
    expect(onCopyMark(106, 27, rect, false)).toBe(false);
    expect(onCopyMark(130, 27, rect, true)).toBe(false);
    expect(onCopyMark(106, 12, rect, true)).toBe(false);
    expect(onCopyMark(105, 27, { left: 100, right: 130, top: 10, bottom: 44 }, true)).toBe(false);
  });
});
