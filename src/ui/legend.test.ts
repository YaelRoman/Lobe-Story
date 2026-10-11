import { describe, expect, it } from 'vitest';
import { FILE_LEGEND_LIMIT, middleEllipsis, showFileLegend } from './legend';

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
