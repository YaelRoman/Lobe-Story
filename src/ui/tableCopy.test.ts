import { describe, expect, it } from 'vitest';
import { cellText, formulaSafe, rowToTsv, toCsv, toTsv, tsvText, type MetricsRow } from './table';
import { METRIC_COLUMNS } from './table';
import type { MetricResult } from '../core/types';

const ok = (value: number | null): MetricResult => (value === null ? { value: null, reason: 'x' } : { value });
const rowOf = (over: Partial<MetricsRow> = {}): MetricsRow => ({
  id: 'a',
  file: 'a.msi',
  source: 'a.msi',
  group: '2°T group',
  freq: 1800,
  gain: 15.234,
  cells: Object.fromEntries(METRIC_COLUMNS.map((c, i) => [c.key, ok(i % 5 === 0 ? null : i + 0.25)])) as MetricsRow['cells'],
  ...over,
});
const cols = METRIC_COLUMNS.slice(0, 3);

describe('table text for a spreadsheet', () => {
  it('has a header row and one tab-separated line per row, in the order given, with the shown cell text', () => {
    const rows = [rowOf({ id: 'b', file: 'b.msi' }), rowOf()];
    const lines = toTsv(rows, cols, 'dBd', 30).trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('File\tGroup\tMHz\tGain (dBd)\tH-HPBW (°)\tV-HPBW (°)\tH-BW 10 dB (°)');
    expect(lines[1].split('\t')).toEqual(['b.msi', '2°T group', '1800', '15.23', '—', '1.3', '2.3']);
  });

  it('shows original → tilted where a cell has one, and — for a missing gain', () => {
    const r = rowOf({ gain: null, tilted: { hHpbw: ok(70) } });
    expect(cellText(r, 'hHpbw')).toBe('— → 70.0');
    expect(rowToTsv(r, cols).split('\t').slice(3)).toEqual(['—', '— → 70.0', '1.3', '2.3']);
  });

  it('guards user text against formulas as the CSV does, and keeps tabs and line breaks out of the cells', () => {
    expect(tsvText('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(tsvText('@x')).toBe("'@x");
    expect(tsvText('+1')).toBe("'+1");
    expect(tsvText('-2')).toBe("'-2");
    expect(tsvText('a\tb\r\nc')).toBe('a b c');
    expect(tsvText('\t=1')).toBe("' =1");
    expect(tsvText('plain')).toBe('plain');
    expect(formulaSafe('=a')).toBe("'=a");
    const r = rowOf({ file: '=HYPERLINK("x")', group: '@g' });
    const [file, group] = rowToTsv(r, cols).split('\t');
    expect(file).toBe('\'=HYPERLINK("x")');
    expect(group).toBe("'@g");
    // The same guard as the CSV export.
    expect(toCsv([r], 'dBd', 30)).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
