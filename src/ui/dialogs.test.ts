import { beforeEach, describe, expect, it } from 'vitest';
import {
  cancelDialog,
  choiceDialog,
  confirmDialog,
  promptDialog,
  saveProjectDialog,
  settleDialog,
  validateDialogInput,
} from './dialogs';
import { initialState, useStore } from '../state/store';

beforeEach(() => {
  cancelDialog();
  useStore.setState(initialState());
});

describe('dialog helpers', () => {
  it('confirm resolves true on settle and false on cancel', async () => {
    const p = confirmDialog('Sure?', 'Yes');
    expect(useStore.getState().dialog).toEqual({ kind: 'confirm', message: 'Sure?', confirmLabel: 'Yes' });
    settleDialog(true);
    expect(await p).toBe(true);
    expect(useStore.getState().dialog).toBeNull();
    const q = confirmDialog('Again?');
    cancelDialog();
    expect(await q).toBe(false);
  });

  it('choice resolves the picked value, or null when cancelled', async () => {
    const p = choiceDialog('Which?', [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ]);
    expect(useStore.getState().dialog).toMatchObject({ kind: 'choice', message: 'Which?' });
    settleDialog('b');
    expect(await p).toBe('b');
    const q = choiceDialog('Which?', [{ value: 'a', label: 'A' }]);
    cancelDialog();
    expect(await q).toBeNull();
  });

  it('prompt validates and resolves the text or null', async () => {
    const p = promptDialog('N?', '3', (t) => (t === '3' ? null : 'bad'));
    expect(useStore.getState().dialog).toEqual({ kind: 'prompt', message: 'N?', initial: '3', confirmLabel: 'OK' });
    expect(validateDialogInput('3')).toBeNull();
    expect(validateDialogInput('x')).toBe('bad');
    settleDialog('3');
    expect(await p).toBe('3');
    expect(validateDialogInput('x')).toBeNull();
    const q = promptDialog('Name?');
    cancelDialog();
    expect(await q).toBeNull();
  });

  it('save-project resolves its options or null', async () => {
    const p = saveProjectDialog();
    expect(useStore.getState().dialog).toEqual({ kind: 'save-project' });
    settleDialog({ includeFiles: false });
    expect(await p).toEqual({ includeFiles: false });
  });

  it('a second dialog cancels the first', async () => {
    const a = confirmDialog('A');
    const b = confirmDialog('B');
    expect(await a).toBe(false);
    expect(useStore.getState().dialog).toMatchObject({ message: 'B' });
    settleDialog(true);
    expect(await b).toBe(true);
  });
});
