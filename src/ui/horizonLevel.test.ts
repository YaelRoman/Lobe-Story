import { describe, expect, it } from 'vitest';
import {
  buildRows, cellText, chartColumns, columnLabel, columnTitle, csvColumns, HORIZON_LEVEL_COLUMN, markReference, metricValue, needsAngularRegions, rowCell, rowToTsv,
  shownChartMetric, sortIfShown, sortRows, sortValue, toCsv, toTsv, visibleColumns, withHorizonLevel, METRIC_COLUMNS,
} from './table';
import { GLOSSARY, helpAbout } from './glossary';
import { DEFAULT_TABLE_GROUPS } from '../state/store';
import { sanitizeMetric } from '../state/project';
import { groupPatterns } from '../state/selectors';
import { analyzeAll, DEFAULT_SETTINGS, type TaggedPattern } from '../core/analysis/metrics';
import { analyzeTilted, tiltEach, type HCutMode } from '../core/analysis/tilt';
import { patternFrom, quadBeam, vBeamWithLobes } from '../test/synthetic';

// Two files: one with 6° of built-in tilt (its horizon cut is 7.5 dB below the 3D peak), one with the beam at the horizon (0 dB).
const a: TaggedPattern = { pattern: patternFrom(quadBeam(65), vBeamWithLobes, { id: 'a', fileName: 'a.msi' }), tags: { tiltDeg: 6 } };
const b: TaggedPattern = { pattern: patternFrom(quadBeam(60), quadBeam(8, 0, 30), { id: 'b', fileName: 'b.msi' }), tags: { tiltDeg: 0 } };
const items = [a, b];
const original = analyzeAll(items);
const NONE = { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0 };

function rowsFor(hCut: HCutMode, mechanicalDeg = 0) {
  const effective = () => ({ ...NONE, mechanicalDeg });
  const active = hCut === 'horizon' || mechanicalDeg !== 0;
  const metrics = active ? analyzeTilted(tiltEach(items, effective, 'summation', hCut), DEFAULT_SETTINGS, effective) : original;
  const rows = buildRows(groupPatterns(items), original, 'dBd', active ? metrics : undefined, () => mechanicalDeg !== 0, () => hCut === 'horizon');
  // File a first, then b (the groups come in tilt order).
  return { metrics, effective, rows: [...rows].sort((p, q) => p.id.localeCompare(q.id)) };
}

describe('the Horizon level column', () => {
  it('is how far the maximum of each row\'s horizon cut lies below the pattern\'s 3D peak', () => {
    const { rows, metrics } = rowsFor('horizon');
    expect(rows.map((r) => r.hLevel?.value)).toEqual([metrics.get('a')!.hCutPeakDb, metrics.get('b')!.hCutPeakDb]);
    expect(rows[0].hLevel!.value).toBeCloseTo(7.5, 6);
    expect(rows[1].hLevel!.value).toBeCloseTo(0, 9);
    // One value per row, not an `original → tilted` pair: a file cut has no horizon level.
    expect(rowCell(rows[0], 'hLevel')).toEqual({ text: '7.5' });
    expect(cellText(rows[1], 'hLevel')).toBe('0.0');
    expect(rows[0].tilted).not.toHaveProperty('hLevel');
    expect(rows[0].cells).not.toHaveProperty('hLevel');
    // Under a tilt it follows the cut.
    const tilted = rowsFor('horizon', 4);
    expect(tilted.rows[0].hLevel!.value).toBeCloseTo(tilted.metrics.get('a')!.hCutPeakDb!, 12);
    expect(tilted.rows[0].hLevel!.value!).toBeGreaterThan(7.5);
  });

  it('does not exist through the beam peak: no value on the rows, no column, the same lists and exports as before', () => {
    for (const mech of [0, 4]) {
      const { rows, effective } = rowsFor('beam', mech);
      expect(rows.every((r) => !('hLevel' in r))).toBe(true);
      const shown = visibleColumns(DEFAULT_TABLE_GROUPS);
      expect(withHorizonLevel(shown, false)).toBe(shown);
      const csv = csvColumns(DEFAULT_TABLE_GROUPS);
      expect(withHorizonLevel(csv, false)).toBe(csv);
      const text = toCsv(rows, 'dBd', 30, mech ? effective : undefined);
      expect(text).not.toContain('Horizon level');
      expect(toCsv(rows, 'dBd', 30, mech ? effective : undefined, 20, 3, undefined, false, withHorizonLevel(csv, false))).toBe(text);
      expect(toTsv(rows, withHorizonLevel(shown, false), 'dBd', 30)).toBe(toTsv(rows, shown, 'dBd', 30));
    }
    // A cell asked for all the same says why it is empty.
    const cell = rowCell(rowsFor('beam').rows[0], 'hLevel');
    expect(cell.text).toBe('—');
    expect(cell.title).toMatch(/horizon cut/);
    expect(METRIC_COLUMNS.some((c) => (c.key as string) === 'hLevel')).toBe(false);
  });

  it('stands right after the horizontal beamwidth while the Beam group is shown, and always in the CSV', () => {
    const shown = withHorizonLevel(visibleColumns(DEFAULT_TABLE_GROUPS), true);
    expect(shown.map((c) => c.key).slice(0, 3)).toEqual(['hHpbw', 'hLevel', 'vHpbw']);
    expect(shown).toHaveLength(visibleColumns(DEFAULT_TABLE_GROUPS).length + 1);
    expect(HORIZON_LEVEL_COLUMN).toEqual({ key: 'hLevel', label: 'Horizon level', unit: 'dB', group: 'beam' });
    expect(columnLabel(HORIZON_LEVEL_COLUMN, 30)).toBe('Horizon level');
    const noBeam = visibleColumns({ ...DEFAULT_TABLE_GROUPS, beam: false });
    expect(withHorizonLevel(noBeam, true)).toBe(noBeam);
    expect(withHorizonLevel(csvColumns({ ...DEFAULT_TABLE_GROUPS, beam: false }), true).map((c) => c.key)).toContain('hLevel');
  });

  it('CSV: one column "Horizon level [horizon cut] [Summation] (dB)" with two decimals, comma-free, between the tilted H beamwidth and the V beamwidth', () => {
    const { rows, effective } = rowsFor('horizon');
    const columns = withHorizonLevel(csvColumns(DEFAULT_TABLE_GROUPS), true);
    const lines = toCsv(rows, 'dBd', 30, effective, 20, 3, undefined, false, columns, 'summation', true).split('\r\n').map((l) => l.split(','));
    const at = lines[0].indexOf('Horizon level [horizon cut] [Summation] (dB)');
    expect(lines[0].slice(at - 1, at + 2)).toEqual(['H-HPBW tilted [horizon cut] [Summation] (°)', 'Horizon level [horizon cut] [Summation] (dB)', 'V-HPBW original (°)']);
    expect(lines[0].filter((h) => h.startsWith('Horizon level'))).toHaveLength(1);
    expect(lines[0].join(',')).not.toContain('"');
    expect(lines[1][at]).toBe('7.50');
    expect(lines[2][at]).toBe('0.00');
    // Every line has as many fields as the header.
    expect(lines[1]).toHaveLength(lines[0].length);
    // The horizon level relates an exported level to its cut: F/B below the 3D peak less the level is F/B of the cut itself.
    const fb = lines[0].indexOf('F/B 180° tilted [horizon cut] [Summation] (dB)');
    expect(Number(lines[1][fb]) - Number(lines[1][at])).toBeCloseTo(Number(lines[1][fb - 1]), 1);
  });

  it('Copy table and Copy row: the value as shown, under "Horizon level [Summation] (dB)" (the header names the 3D method the level is read with)', () => {
    const { rows } = rowsFor('horizon');
    const columns = withHorizonLevel(visibleColumns(DEFAULT_TABLE_GROUPS), true);
    const tsv = toTsv(rows, columns, 'dBd', 30, 20, 3, undefined, false, 'summation', true).split('\r\n').map((l) => l.split('\t'));
    const at = tsv[0].indexOf('Horizon level [Summation] (dB)');
    expect(at).toBe(tsv[0].indexOf('H-HPBW [tilted: horizon cut] [Summation] (°)') + 1);
    expect(tsv[1][at]).toBe('7.5');
    expect(tsv[2][at]).toBe('0.0');
    expect(rowToTsv(rows[0], columns).split('\t')[at]).toBe('7.5');
  });

  it('Δ vs reference: the difference of the two horizon levels, in the table, the CSV and the copied table', () => {
    const { rows } = rowsFor('horizon');
    const delta = markReference(rows, 'b', true);
    const [other, ref] = [delta.find((r) => r.id === 'a')!, delta.find((r) => r.id === 'b')!];
    expect(other.hLevel!.value).toBeCloseTo(7.5, 6);
    expect(cellText(other, 'hLevel')).toBe('+7.5');
    // The reference row keeps its own value.
    expect(cellText(ref, 'hLevel')).toBe('0.0');
    const columns = withHorizonLevel(csvColumns(DEFAULT_TABLE_GROUPS), true);
    const csv = toCsv(delta, 'dBd', 30, undefined, 20, 3, 'b.msi', true, columns, 'summation', true).split('\r\n');
    expect(csv[0]).toContain('"Horizon level Δ vs b.msi, tilted values [horizon cut] [Summation] (dB)"');
    const tsv = toTsv(delta, withHorizonLevel(visibleColumns(DEFAULT_TABLE_GROUPS), true), 'dBd', 30, 20, 3, 'b.msi', true, 'summation', true).split('\r\n')[0].split('\t');
    expect(tsv).toContain('Horizon level Δ vs b.msi, tilted values [horizon cut] [Summation] (dB)');
    // Without the difference view the rows are returned with their levels.
    expect(markReference(rows, 'b', false).find((r) => r.id === 'a')!.hLevel).toEqual(rows[0].hLevel);
  });

  it('sorts like any other column, and the sort is dropped when the column goes', () => {
    const { rows } = rowsFor('horizon');
    expect(sortValue(rows[0], 'hLevel')).toBeCloseTo(7.5, 6);
    expect(sortRows(rows, { key: 'hLevel', dir: 'asc' }).map((r) => r.id)).toEqual(['b', 'a']);
    expect(sortRows(rows, { key: 'hLevel', dir: 'desc' }).map((r) => r.id)).toEqual(['a', 'b']);
    const sort = { key: 'hLevel' as const, dir: 'asc' as const };
    expect(sortIfShown(sort, withHorizonLevel(visibleColumns(DEFAULT_TABLE_GROUPS), true))).toBe(sort);
    expect(sortIfShown(sort, withHorizonLevel(visibleColumns(DEFAULT_TABLE_GROUPS), false))).toBeNull();
    expect(sortValue(rowsFor('beam').rows[0], 'hLevel')).toBeNull();
  });

  it('tooltip: one plain sentence on what it is, and what a low cut means for the widths and the squint', () => {
    const title = columnTitle('hLevel', { sectorEdgeDeg: 60, siteSectors: 3 })!;
    expect(title).toContain('how far the strongest point of the horizon cut is below the strongest point of the whole pattern (the 3D peak)');
    expect(title).toContain('0 dB');
    for (const text of ['H-HPBW', 'H-BW 10 dB', 'Squint', 'sidelobe', 'null', 'not the main beam']) expect(title).toContain(text);
    // The widths are not blanked: the level is what tells a main-beam width from a sidelobe width.
    const { rows } = rowsFor('horizon', 6);
    expect(rows[0].hLevel!.value!).toBeGreaterThan(10);
    expect(rows[0].tilted!.hHpbw!.value).not.toBeNull();
  });

  it('glossary and Help explain it', () => {
    const entry = GLOSSARY.find((g) => g.term === 'Horizon level')!;
    for (const text of ['below the strongest point of the whole pattern', '3D peak', 'sidelobe', 'null', 'not the main beam']) expect(entry.text).toContain(text);
    expect(helpAbout('horizontal-cut')).toContain('Horizon level');
  });
});

describe('the Horizon level in the frequency chart', () => {
  it('is offered in the Metric menu only at the horizon, in the Beam group after the beamwidths', () => {
    expect(chartColumns(false)).toBe(METRIC_COLUMNS);
    const keys = chartColumns(true).map((c) => c.key);
    expect(keys).toHaveLength(METRIC_COLUMNS.length + 1);
    expect(keys.slice(0, 2)).toEqual(['hHpbw', 'hLevel']);
    expect(chartColumns(true).find((c) => c.key === 'hLevel')!.group).toBe('beam');
  });

  it('plots each file\'s level, and falls back to the beamwidth chart while the cut is not the one at the horizon', () => {
    const { metrics } = rowsFor('horizon');
    expect(metricValue(metrics.get('a')!, 'hLevel').value).toBeCloseTo(7.5, 6);
    expect(metricValue(original.get('a')!, 'hLevel').value).toBeNull();
    expect(metricValue(metrics.get('a')!, 'fb180')).toEqual(metrics.get('a')!.fb180);
    expect(shownChartMetric('hLevel', true)).toBe('hLevel');
    expect(shownChartMetric('hLevel', false)).toBe('hHpbw');
    expect(shownChartMetric('fb180', false)).toBe('fb180');
    expect(shownChartMetric('fb180', true)).toBe('fb180');
    // It is not an angular-region column: choosing it does not start the sphere integration.
    expect(needsAngularRegions(DEFAULT_TABLE_GROUPS, 'hLevel')).toBe(false);
  });

  it('is kept as the stored chart metric, like a table column', () => {
    expect(sanitizeMetric('hLevel', 'hHpbw')).toBe('hLevel');
    expect(sanitizeMetric('nonsense', 'hHpbw')).toBe('hHpbw');
    expect(sanitizeMetric('fb180', 'hHpbw')).toBe('fb180');
  });
});

describe('tooltips at a beamwidth level other than 3 dB', () => {
  const settings = { sectorEdgeDeg: 60, siteSectors: 3 };
  it('the Horizon level tooltip names the beamwidth column as its header does', () => {
    expect(columnTitle('hLevel', { ...settings, levelDb: 6 })).toContain('H-BW@6 dB, H-BW 10 dB and Squint on this row describe that region');
    expect(columnTitle('hLevel', { ...settings, levelDb: 6 })).not.toContain('H-HPBW');
    expect(columnTitle('hLevel', settings)).toContain('H-HPBW, H-BW 10 dB and Squint on this row describe that region');
  });

  it('the angular-region tooltips say their widths are the 3 dB ones whatever the level', () => {
    for (const key of ['areSector', 'areSpatial', 'areLower'] as const) {
      expect(columnTitle(key, { ...settings, levelDb: 6 })).toContain('V-HPBW and H-HPBW here are the 3 dB widths, whatever the beamwidth level');
      expect(columnTitle(key, settings)).not.toContain('whatever the beamwidth level');
    }
  });
});
