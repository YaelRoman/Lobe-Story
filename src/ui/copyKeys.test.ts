import { describe, expect, it } from 'vitest';
import { copyShortcut } from './copyKeys';

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
