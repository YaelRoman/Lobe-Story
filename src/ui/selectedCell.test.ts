import { afterEach, describe, expect, it } from 'vitest';
import { cellLine, CELL_LINE_HINT, currentSelectedCell, selectCell, subscribeSelectedCell } from './selectedCell';

describe('the selected cell of the metrics table', () => {
  afterEach(() => selectCell(null));

  it('is a slice of its own: listeners hear a new cell, and not the same cell again', () => {
    let calls = 0;
    const stop = subscribeSelectedCell(() => calls++);
    selectCell({ id: 'a.msi', col: 'hHpbw' });
    expect(currentSelectedCell()).toEqual({ id: 'a.msi', col: 'hHpbw' });
    selectCell({ id: 'a.msi', col: 'hHpbw' });
    expect(calls).toBe(1);
    selectCell({ id: 'a.msi', col: 'fb180' });
    selectCell(null);
    expect(calls).toBe(3);
    stop();
    selectCell({ id: 'b.msi', col: 'fb180' });
    expect(calls).toBe(3);
  });
});

describe('cellLine', () => {
  const base = { file: 'a.msi', header: 'F/B 180° (dB)', text: '28.6' };

  it('says the file, the column and the value, then what the column means', () => {
    expect(cellLine({ ...base, definition: 'Level of the azimuth cut at exactly 180°, in dB below the peak' })).toBe(
      'a.msi · F/B 180° (dB): 28.6. Level of the azimuth cut at exactly 180°, in dB below the peak.',
    );
    expect(cellLine(base)).toBe('a.msi · F/B 180° (dB): 28.6.');
  });

  it('puts the reason of a missing value first, each side of a pair on its own', () => {
    expect(cellLine({ ...base, text: '—', reason: 'Not a Type A (macro) beam: H-HPBW 30.0° is outside 50–130°', definition: 'Sector efficiency…' })).toBe(
      'a.msi · F/B 180° (dB): —. Why: Not a Type A (macro) beam: H-HPBW 30.0° is outside 50–130°. Sector efficiency….',
    );
    expect(cellLine({ ...base, text: '28.6 → —', reason: 'horizon cut: no lobe in the window' })).toBe('a.msi · F/B 180° (dB): 28.6 → —. Why: horizon cut: no lobe in the window.');
    expect(cellLine({ ...base, text: '—', reason: 'file cut: declared\nhorizon cut: x.' })).toBe('a.msi · F/B 180° (dB): —. Why: file cut: declared; horizon cut: x.');
  });

  it('a note that is not a reason for a missing value (two equal values) is said as a note', () => {
    expect(cellLine({ ...base, reason: 'file cut and horizon cut are equal', note: true })).toBe('a.msi · F/B 180° (dB): 28.6. file cut and horizon cut are equal.');
  });

  it('has a standing hint for when no cell is selected', () => {
    expect(CELL_LINE_HINT).toContain('Select a cell');
    expect(CELL_LINE_HINT).toContain('—');
  });
});
