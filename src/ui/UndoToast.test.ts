// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
});
