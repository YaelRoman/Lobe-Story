// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useStore } from '../state/store';
import { NOTHING_TO_UNDO, UndoToast } from './UndoToast';
import { planetText } from '../test/planetText';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const enc = new TextEncoder();
const file = (path: string, freq: number) => ({ path, bytes: enc.encode(planetText({ headers: ['NAME X', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] })).buffer as ArrayBuffer });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useStore.setState(initialState());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(createElement(UndoToast)));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const ctrlZ = (target: EventTarget = document.body) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
  });

describe('Ctrl/Cmd+Z', () => {
  it('undoes after the toast has faded, because the snapshot is kept', () => {
    const st = useStore.getState;
    act(() => st().addFiles([file('a.MSI', 1800), file('b.MSI', 1900)]));
    act(() => st().removeFile('a.MSI'));
    expect(host.querySelector('[data-testid="undo-toast"]')).not.toBeNull();
    act(() => st().fadeUndo());
    expect(host.querySelector('[data-testid="undo-toast"]')).toBeNull();
    ctrlZ();
    expect(st().files).toHaveLength(2);
    expect(st().copyNote).toBeNull();
  });

  it('says "Nothing to undo" when there is nothing, and leaves a text field to its own undo', () => {
    const st = useStore.getState;
    ctrlZ();
    expect(st().copyNote).toBe(NOTHING_TO_UNDO);
    act(() => st().setCopyNote(null));
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    ctrlZ(input);
    expect(st().copyNote).toBeNull();
    input.remove();
  });

  it('says "Nothing to undo" once a later edit has withdrawn the undo', () => {
    const st = useStore.getState;
    act(() => st().addFiles([file('a.MSI', 1800), file('b.MSI', 1900)]));
    act(() => st().removeFile('a.MSI'));
    act(() => st().fadeUndo());
    act(() => st().rename('b.MSI', 'Beta'));
    ctrlZ();
    expect(st().files).toHaveLength(1);
    expect(st().copyNote).toBe(NOTHING_TO_UNDO);
  });

  it('leaves Ctrl/Cmd+Z alone inside an open dialog or a dialog-role panel', () => {
    const st = useStore.getState;
    act(() => st().addFiles([file('a.MSI', 1800), file('b.MSI', 1900)]));
    act(() => st().removeFile('a.MSI'));
    const modal = document.createElement('dialog');
    modal.setAttribute('open', '');
    const inModal = document.createElement('button');
    modal.appendChild(inModal);
    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    const inPanel = document.createElement('button');
    panel.appendChild(inPanel);
    document.body.append(modal, panel);
    ctrlZ(inModal);
    ctrlZ(inPanel);
    expect(st().files).toHaveLength(1);
    expect(st().copyNote).toBeNull();
    ctrlZ();
    expect(st().files).toHaveLength(2);
    modal.remove();
    panel.remove();
  });

  it('the cross only hides the offer; Ctrl/Cmd+Z still undoes until the next change', () => {
    const st = useStore.getState;
    act(() => st().addFiles([file('a.MSI', 1800), file('b.MSI', 1900)]));
    act(() => st().removeFile('a.MSI'));
    const cross = host.querySelector<HTMLButtonElement>('button[aria-label="Hide undo offer"]');
    expect(cross?.title).toBe('Hide (Ctrl/Cmd+Z still undoes)');
    act(() => cross!.click());
    expect(host.querySelector('[data-testid="undo-toast"]')).toBeNull();
    ctrlZ();
    expect(st().files).toHaveLength(2);
  });
});

describe('the offer on a phone, and a long file name in it', () => {
  const st = useStore.getState;
  const toast = () => host.querySelector<HTMLElement>('[data-testid="undo-toast"]');
  const undoButton = () => Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Undo'));
  /** The page as laid out for a phone (the stylesheet's width), or not. */
  const layout = (phone: boolean) => vi.stubGlobal('matchMedia', () => ({ matches: phone, addEventListener: () => {}, removeEventListener: () => {} }));
  afterEach(() => vi.unstubAllGlobals());

  it('names the keyboard shortcut on the button on a wide screen', () => {
    layout(false);
    act(() => st().addFiles([file('a.MSI', 1800), file('b.MSI', 1900)]));
    act(() => st().removeFile('a.MSI'));
    expect(undoButton()?.textContent).toMatch(/^Undo · (Ctrl\+Z|⌘Z)$/);
  });

  it('says just "Undo" on a phone: there is no such key, and the room goes to the file name', () => {
    layout(true);
    act(() => st().addFiles([file('a.MSI', 1800), file('b.MSI', 1900)]));
    act(() => st().removeFile('a.MSI'));
    expect(undoButton()?.textContent).toBe('Undo');
  });

  it('a removed file is named with its end kept whole (cut in the middle when the offer is narrow), the full text in the page', () => {
    layout(true);
    act(() => st().addFiles([file('example_1710_P45_02T.msi', 1710), file('b.MSI', 1900)]));
    act(() => st().removeFile('example_1710_P45_02T.msi'));
    const label = toast()!.querySelector('.undo-label')!;
    expect(label.textContent).toBe('Removed example_1710_P45_02T.msi.');
    expect(label.querySelector('.mid-head')?.textContent).toBe('example_1710_');
    expect(label.querySelector('.mid-tail')?.textContent).toBe('P45_02T.msi');
  });

  it('what follows the name stays whole too', () => {
    layout(true);
    act(() => st().addFiles([file('example_1710_P45_02T.msi', 1710), file('b.MSI', 1900)]));
    act(() => st().duplicate('example_1710_P45_02T.msi'));
    act(() => st().removeFile('example_1710_P45_02T.msi'));
    const label = toast()!.querySelector('.undo-label')!;
    expect(label.textContent).toBe('Removed example_1710_P45_02T.msi and its copies.');
    expect(label.querySelector('.mid-tail')?.textContent).toBe('P45_02T.msi');
  });

  it('an offer without a name in it is plain text', () => {
    layout(false);
    act(() => st().addFiles([file('a.MSI', 1800), file('b.MSI', 1900)]));
    act(() => st().clear());
    const label = toast()!.querySelector('.undo-label')!;
    expect(label.textContent).toBe('Cleared 2 files.');
    expect(label.querySelector('.mid-head')).toBeNull();
  });
});
