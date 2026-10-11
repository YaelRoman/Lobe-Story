// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { escapeClearsHighlight, onEscapeKey } from './useEscapeClear';
import { hoverStore, setHoverId } from './hoverPreview';
import { initialState, useStore } from '../state/store';

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

describe('Esc ends the preview', () => {
  const press = (key: string) => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    onEscapeKey(e);
  };
  beforeEach(() => {
    useStore.setState(initialState());
    setHoverId(null);
  });

  it('clears the hover id together with the highlight', () => {
    useStore.setState({ highlighted: 'a' });
    setHoverId('b');
    press('Escape');
    expect(useStore.getState().highlighted).toBeNull();
    expect(hoverStore.getState().id).toBeNull();
  });

  it('leaves the preview alone for other keys and for an Esc that belongs to a dialog', () => {
    setHoverId('b');
    press('Enter');
    expect(hoverStore.getState().id).toBe('b');
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    press('Escape');
    expect(hoverStore.getState().id).toBe('b');
    dialog.remove();
  });
});
