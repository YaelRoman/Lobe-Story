import { describe, expect, it } from 'vitest';
import { escapeClearsHighlight } from './useEscapeClear';

const base = { key: 'Escape', defaultPrevented: false, inOwnWidget: false, overlayOpen: false };

describe('escapeClearsHighlight', () => {
  it('clears on a plain Esc', () => expect(escapeClearsHighlight(base)).toBe(true));
  it('ignores other keys', () => expect(escapeClearsHighlight({ ...base, key: 'Enter' })).toBe(false));
  it('leaves Esc to editors, menus and dialogs', () => {
    expect(escapeClearsHighlight({ ...base, inOwnWidget: true })).toBe(false);
    expect(escapeClearsHighlight({ ...base, overlayOpen: true })).toBe(false);
    expect(escapeClearsHighlight({ ...base, defaultPrevented: true })).toBe(false);
  });
});
