import { describe, expect, it } from 'vitest';
import { FILE_LEGEND_LIMIT, middleEllipsis, showFileLegend, splitTail, traceNote } from './legend';

describe('middleEllipsis', () => {
  it('leaves short text alone', () => {
    expect(middleEllipsis('1800 MHz · A', 30)).toBe('1800 MHz · A');
  });
  it('keeps the start and the end (the distinguishing part) within the limit', () => {
    const t = middleEllipsis('1800 MHz · _1800_X_CO_P45_08T_VeryLongAntennaModelName_Variant12.MSI', 30);
    expect(t).toHaveLength(30);
    expect(t.startsWith('1800 MHz')).toBe(true);
    expect(t.endsWith('Variant12.MSI')).toBe(true);
    expect(t).toContain('…');
  });
  it('copes with tiny limits', () => {
    expect(middleEllipsis('abcdef', 1)).toBe('…');
    expect(middleEllipsis('abcdef', 0)).toBe('');
  });
});

describe('showFileLegend', () => {
  it('lists traces in the legend only up to the limit', () => {
    expect(FILE_LEGEND_LIMIT).toBe(4);
    expect(showFileLegend(0)).toBe(false);
    expect(showFileLegend(1)).toBe(true);
    expect(showFileLegend(4)).toBe(true);
    expect(showFileLegend(5)).toBe(false);
  });
});

describe('traceNote', () => {
  const base = { traces: 24, byGroup: true, originals: false, referenceLabel: null };

  it('says "dashed = original" only while dashed originals are drawn', () => {
    expect(traceNote(base)).not.toContain('dashed');
    expect(traceNote({ ...base, originals: true })).toContain('(dashed = original)');
  });

  it('names the thick dashed reference line when one is pinned, with or without originals', () => {
    expect(traceNote({ ...base, referenceLabel: 'ANT-1' })).toBe(
      '24 traces: colours as in the file panel; more than 10 files: one colour per group, a shade per file; hover a trace for its name. The thick dashed line in the text colour is the reference: ANT-1.',
    );
    expect(traceNote({ ...base, byGroup: false, originals: true, referenceLabel: 'ANT-1' })).toContain('(dashed = original); hover a trace for its name. The thick dashed line');
  });
});

describe('splitTail', () => {
  it('keeps the last characters whole and gives the start to the style to cut off', () => {
    expect(splitTail('example_1710_P45_02T.msi')).toEqual({ head: 'example_1710_P', tail: '45_02T.msi' });
    const { head, tail } = splitTail('ANT-1_2100_X_CO_P45_08T_Y2.MSI');
    expect(head + tail).toBe('ANT-1_2100_X_CO_P45_08T_Y2.MSI');
    expect(tail).toHaveLength(10);
    expect(splitTail('example_1710_P45_02T.msi', 12)).toEqual({ head: 'example_1710', tail: '_P45_02T.msi' });
  });

  it('does not split a name that is short or only a little longer than the tail', () => {
    expect(splitTail('a.msi')).toEqual({ head: 'a.msi', tail: '' });
    expect(splitTail('12345678901234')).toEqual({ head: '12345678901234', tail: '' });
    expect(splitTail('123456789012345')).toEqual({ head: '12345', tail: '6789012345' });
    expect(splitTail('abc', 0)).toEqual({ head: 'abc', tail: '' });
  });
});
