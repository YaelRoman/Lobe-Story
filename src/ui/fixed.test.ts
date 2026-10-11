import { describe, expect, it } from 'vitest';
import { fixed } from './fixed';
import { buildRows, toCsv, toTsv, cellText, gainText, markReference, METRIC_COLUMNS } from './table';
import { analyzeAll } from '../core/analysis/metrics';
import { groupPatterns } from '../state/selectors';
import { patternFrom, quadBeam, vBeamWithLobes } from '../test/synthetic';

describe('fixed', () => {
  it('rounds first, then drops the sign of a zero', () => {
    expect(fixed(-0.004, 2)).toBe('0.00');
    expect(fixed(-0.04, 1)).toBe('0.0');
    expect(fixed(-0, 2)).toBe('0.00');
    expect(fixed(-0.05, 1)).toBe('-0.1');
    expect(fixed(-1.234, 2)).toBe('-1.23');
    expect(fixed(2.5, 1)).toBe('2.5');
  });
});

describe('no negative zero in the table texts', () => {
  const mk = (id: string, gain: number) => patternFrom(quadBeam(60), vBeamWithLobes, { id, fileName: `${id}.msi`, gain: { value: gain, unit: 'dBi' } });
  const tagged = [mk('a', 10), mk('b', 10.001)].map((pattern) => ({ pattern, tags: {} }));
  const rows = markReference(buildRows(groupPatterns(tagged), analyzeAll(tagged), 'dBi'), 'a', true);
  const tiny = rows.map((r) => ({ ...r, gain: -0.0004, cells: { ...r.cells, hHpbw: { value: -0.003 }, tilt: { value: -0.04 } } }));

  it('CSV, TSV and cells never show -0.00 or -0.0', () => {
    const columns = METRIC_COLUMNS;
    const csv = toCsv(tiny, 'dBi', 30, undefined, 20, 3, 'a');
    const tsv = toTsv(tiny, columns, 'dBi', 30, 20, 3, 'a');
    for (const text of [csv, tsv, gainText(tiny[0]), cellText(tiny[0], 'hHpbw'), cellText(tiny[0], 'tilt')]) {
      expect(text).not.toMatch(/-0\.0+(?![0-9])/);
    }
    expect(cellText({ ...tiny[0], isDelta: false }, 'tilt')).toBe('0.0');
    expect(gainText({ ...tiny[0], isDelta: false })).toBe('0.00');
  });
});
