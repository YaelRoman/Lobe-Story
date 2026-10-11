import { describe, expect, it } from 'vitest';
import { cellText, formulaSafe, markReference, rowCell, rowToTsv, signedOneDecimal, sortRows, toCsv, toTsv, tsvText, type MetricsRow } from './table';
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

describe('the difference from the reference', () => {
  const cellsWith = (v: (i: number) => number | null) =>
    Object.fromEntries(METRIC_COLUMNS.map((c, i) => [c.key, ok(v(i))])) as MetricsRow['cells'];
  const ref = rowOf({ id: 'ref', file: 'ref.msi', cells: cellsWith((i) => 10 + i) });
  const other = rowOf({ id: 'o', file: 'o.msi', cells: cellsWith((i) => (i === 3 ? null : 10 + i + 1.25)) });
  const tilted = rowOf({ id: 't', file: 't.msi', cells: cellsWith(() => 0), tilted: { hHpbw: ok(13), vHpbw: ok(null) } });
  const rows = [other, ref, tilted];

  it('marks the reference row and leaves the others as they are without the difference view', () => {
    const out = markReference(rows, 'ref', false);
    expect(out.map((r) => !!r.isReference)).toEqual([false, true, false]);
    expect(out[0]).toBe(other);
    expect(out[0].isDelta).toBeUndefined();
  });

  it('returns the rows untouched when there is no reference or it has no row', () => {
    expect(markReference(rows, null, true)).toBe(rows);
    expect(markReference(rows, 'ghost', true)).toBe(rows);
  });

  it('shows signed one-decimal differences, a dash where either side is missing, and the reference unchanged', () => {
    const out = markReference(rows, 'ref', true);
    const [o, r, t] = out;
    expect(r.isDelta).toBeUndefined();
    expect(cellText(r, 'hHpbw')).toBe('10.0');
    expect(o.isDelta).toBe(true);
    expect(cellText(o, 'hHpbw')).toBe('+1.3');
    expect(o.cells.hHpbw.value).toBeCloseTo(1.25, 9);
    expect(cellText(o, METRIC_COLUMNS[3].key)).toBe('—');
    expect(rowCell(o, METRIC_COLUMNS[3].key).title).toBeDefined();
    // The shown (tilted) value is the one compared: 13 - 10; a missing tilted value is a missing difference.
    expect(cellText(t, 'hHpbw')).toBe('+3.0');
    expect(cellText(t, 'vHpbw')).toBe('—');
    expect(cellText(t, 'hBw10')).toBe('-12.0');
    expect(t.tilted).toBeUndefined();
  });

  it('formats a difference: sign, one decimal, no negative zero', () => {
    expect(signedOneDecimal(1.25)).toBe('+1.3');
    expect(signedOneDecimal(-0.44)).toBe('-0.4');
    expect(signedOneDecimal(-0.04)).toBe('0.0');
    expect(signedOneDecimal(0)).toBe('0.0');
    expect(signedOneDecimal(null)).toBe('—');
  });

  it('pins the reference row first in the difference view, whatever the sort; the others sort by their differences', () => {
    const marked = markReference(rows, 'ref', true);
    expect(sortRows(marked, { key: 'hHpbw', dir: 'asc' }).map((r) => r.id)).toEqual(['ref', 'o', 't']);
    expect(sortRows(marked, { key: 'hHpbw', dir: 'desc' }).map((r) => r.id)).toEqual(['ref', 't', 'o']);
    expect(sortRows(marked, null).map((r) => r.id)).toEqual(['ref', 'o', 't']);
    expect(sortRows(marked, { key: 'file', dir: 'desc' }).map((r) => r.id)).toEqual(['ref', 't', 'o']);
  });

  it('sorts the reference like any row when the difference view is off', () => {
    const marked = markReference(rows, 'ref', false);
    expect(sortRows(marked, { key: 'hHpbw', dir: 'desc' }).map((r) => r.id)).toEqual(['t', 'o', 'ref']);
    expect(sortRows(marked, null)).toBe(marked);
  });

  it('differences the gain as well, and keeps the reference gain absolute', () => {
    const g = markReference([rowOf({ id: 'ref', gain: 15 }), rowOf({ id: 'o', gain: 16.5 }), rowOf({ id: 'n', gain: null })], 'ref', true);
    expect(g.map((r) => r.gain)).toEqual([15, 1.5, null]);
  });

  it('adds a Row column (reference / difference) after the file and group columns in the CSV and the TSV', () => {
    const out = sortRows(markReference(rows, 'ref', true), null);
    const cols = METRIC_COLUMNS.slice(0, 1);
    const tsv = toTsv(out, cols, 'dBd', 30, 20, 3, 'ref.msi').trimEnd().split('\r\n');
    expect(tsv[0].split('\t').slice(0, 4)).toEqual(['File', 'Group', 'Row', 'MHz']);
    expect(tsv.slice(1).map((l) => l.split('\t')[2])).toEqual(['reference', 'difference', 'difference']);
    expect(tsv[0].split('\t')[4]).toBe('Gain Δ vs ref.msi (dBd)');
    const csv = toCsv(out, 'dBd', 30, undefined, 20, 3, 'ref.msi').trimEnd().split('\r\n');
    const at = csv[0].split(',').indexOf('Group') + 1;
    expect(csv[0].split(',')[at]).toBe('Row');
    expect(csv.slice(1).map((l) => l.split(',')[at])).toEqual(['reference', 'difference', 'difference']);
    // Without the difference view there is no Row column.
    expect(toTsv(rows, cols, 'dBd', 30).split('\r\n')[0]).toBe('File\tGroup\tMHz\tGain (dBd)\tH-HPBW (°)');
    expect(toCsv(rows, 'dBd', 30).split('\r\n')[0]).not.toContain('Row');
  });

  it('says in the headers that the values are the tilted ones when a simulation is on', () => {
    const out = markReference(rows, 'ref', true);
    const tsv = toTsv(out, METRIC_COLUMNS.slice(0, 1), 'dBd', 30, 20, 3, 'ref.msi', true).split('\r\n')[0];
    expect(tsv).toContain('H-HPBW Δ vs ref.msi, tilted values (°)');
    expect(toCsv(out, 'dBd', 30, undefined, 20, 3, 'ref.msi', true).split('\r\n')[0]).toContain('H-HPBW Δ vs ref.msi, tilted values (°)');
    expect(toTsv(out, METRIC_COLUMNS.slice(0, 1), 'dBd', 30, 20, 3, 'ref.msi').split('\r\n')[0]).not.toContain('tilted');
  });

  it('puts "Δ vs <name>" in the CSV and TSV headers and the differences in their cells', () => {
    const out = markReference(rows, 'ref', true);
    const cols = METRIC_COLUMNS.slice(0, 2);
    const tsv = toTsv(out, cols, 'dBd', 30, 20, 3, 'ref.msi').trimEnd().split('\r\n');
    expect(tsv[0].split('\t').slice(5)).toEqual(['H-HPBW Δ vs ref.msi (°)', 'V-HPBW Δ vs ref.msi (°)']);
    expect(tsv[1].split('\t').slice(5)).toEqual(['+1.3', '+1.3']);
    expect(tsv[2].split('\t').slice(5)).toEqual(['10.0', '11.0']);
    const csv = toCsv(out, 'dBd', 30, (id) => ({ electricalDeg: id === 't' ? 1 : 0, mechanicalDeg: 0, azimuthDeg: 0 }), 20, 3, 'ref.msi').split('\r\n');
    expect(csv[0]).toContain('H-HPBW Δ vs ref.msi (°)');
    expect(csv[0]).not.toContain('original');
    const head = csv[0].split(',');
    expect(head[head.indexOf('Group') + 1]).toBe('Row');
    expect(csv[1].split(',')[head.indexOf('H-HPBW Δ vs ref.msi (°)')]).toBe('1.25');
    // The reference row keeps its shown value, as the cells do.
    expect(csv[2].split(',')[head.indexOf('H-HPBW Δ vs ref.msi (°)')]).toBe('10.00');
  });

  it('keeps a tab and a formula in the reference name out of the TSV header (no new cell, no leading =)', () => {
    const header = toTsv(markReference(rows, 'ref', true), METRIC_COLUMNS.slice(0, 2), 'dBd', 30, 20, 3, 'a\t=1').split('\r\n')[0].split('\t');
    expect(header).toHaveLength(2 + 1 + 2 + 2);
    expect(header.every((c) => !c.startsWith('='))).toBe(true);
    expect(header.slice(5)).toEqual(['H-HPBW Δ vs a =1 (°)', 'V-HPBW Δ vs a =1 (°)']);
  });

  it('keeps a formula-like reference name inside the header text (the cell does not start with it)', () => {
    const csv = toCsv(markReference(rows, 'ref', true), 'dBd', 30, undefined, 20, 3, '=x').split('\r\n')[0];
    expect(csv).toContain('Δ vs =x');
  });
});
