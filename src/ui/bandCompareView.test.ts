import { describe, expect, it } from 'vitest';
import { bandDiff, type BandDiff } from '../core/analysis/bandCompare';
import { BAND_PARAMS, bandTable, type BandColumn } from '../core/analysis/bandParams';
import { analyzeAll, DEFAULT_SETTINGS, type PatternMetrics } from '../core/analysis/metrics';
import { bandItems } from '../test/bandFixture';
import { anySubstituted, compareDiffs, compareNote, compareTsv, diffDisplay, SUBSTITUTED_LEGEND } from './bandCompareView';
import { bandCsv, cellDisplay, type BandSheet } from './bandView';

const items = bandItems();
const metrics = analyzeAll(items, DEFAULT_SETTINGS);
// Antenna B: the same files, each azimuth beamwidth 2° wider.
const widerMetrics = new Map<string, PatternMetrics>(
  [...metrics].map(([id, m]) => [id, { ...m, h: { ...m.h, hpbw: { value: m.h.hpbw.value === null ? null : m.h.hpbw.value + 2 } } }]),
);
const ctx = { gainUnit: 'dBi' as const, settings: DEFAULT_SETTINGS };
const bands = [
  { name: '1800–1900 MHz', minMHz: 1800, maxMHz: 1900 },
  { name: '2600 MHz', minMHz: 2600, maxMHz: 2600 },
];
const a: BandSheet = { label: 'Array Y1', columns: bandTable(items, metrics, bands, ctx) };
const b: BandSheet = { label: 'Array Y2', columns: bandTable(items, widerMetrics, bands, ctx) };
const row = (lines: string[], label: string) => lines.find((l) => l.startsWith(label + '\t'))!.split('\t');

describe('diffDisplay', () => {
  const ok = bandDiff(a.columns[0].cells.hHpbw, b.columns[0].cells.hHpbw);
  it('shows one difference, dimmed where it is no difference', () => {
    expect(diffDisplay(ok)).toEqual({ text: ok.text, title: ok.title, muted: false });
    expect(diffDisplay(bandDiff(a.columns[1].cells.hHpbw, b.columns[1].cells.hHpbw)).muted).toBe(true);
  });
  it('shows original → tilted where the two differences read differently, as the band cells do', () => {
    const other: BandDiff = { ...ok, text: '+3.0° (tol 0.0°)', title: 'T' };
    const d = diffDisplay(ok, other);
    expect(d.text).toBe(`${ok.text} → +3.0° (tol 0.0°)`);
    expect(d.title).toContain('\ntilted: T');
    expect(diffDisplay(ok, ok).text).toBe(ok.text);
  });
});

describe('compareDiffs', () => {
  it('gives each sub-band and parameter its difference, and the tilted one under a simulation', () => {
    const plain = compareDiffs(a, b);
    expect(plain).toHaveLength(2);
    expect(plain[0].hHpbw.original.text).toBe('+2.0° (tol 0.0°)');
    expect(plain[0].hHpbw.tilted).toBeUndefined();
    expect(plain[0].vHpbw.original.text).toBe('0.0° (tol 0.0°)');
    const sim = compareDiffs({ ...a, tilted: b.columns }, { ...b, tilted: b.columns });
    expect(sim[0].hHpbw.tilted!.text).toBe('0.0° (tol 0.0°)');
  });
  it('names the antennas in the reasons', () => {
    expect(compareDiffs(a, b)[1].hHpbw.original.title).toContain('A (Array Y1) has no values in this sub-band');
  });
});

describe('compareTsv (Copy table while comparing)', () => {
  const lines = compareTsv(a, b, DEFAULT_SETTINGS).trimEnd().split('\r\n');
  it('has three columns per sub-band, A, B and B − A, named in one header line', () => {
    expect(lines).toHaveLength(BAND_PARAMS.length + 1);
    expect(lines[0].split('\t')).toEqual([
      'Parameter',
      '1800–1900 MHz A: Array Y1 (12 files)',
      '1800–1900 MHz B: Array Y2 (12 files)',
      '1800–1900 MHz B − A',
      '2600 MHz A: Array Y1 (0 files)',
      '2600 MHz B: Array Y2 (0 files)',
      '2600 MHz B − A',
    ]);
  });
  it('copies the cells as shown', () => {
    const az = row(lines, 'Azimuth beamwidth');
    expect(az).toEqual([
      'Azimuth beamwidth',
      cellDisplay(a.columns[0].cells.hHpbw).text,
      cellDisplay(b.columns[0].cells.hHpbw).text,
      '+2.0° (tol 0.0°)',
      '—',
      '—',
      '—',
    ]);
  });
  it('guards the user text of the header and copies a computed difference as it reads, as the band table does', () => {
    const odd = compareTsv({ ...a, label: '=x' }, { ...b, columns: b.columns.map((c: BandColumn) => ({ ...c, subBand: { ...c.subBand, name: '-odd' } })) }, DEFAULT_SETTINGS).split('\r\n');
    expect(odd[0].split('\t')[1]).toBe('1800–1900 MHz A: =x (12 files)');
    // The sub-band names are A's (the two sheets have the same sub-bands).
    expect(row(odd, 'Azimuth beamwidth')[3]).toBe('+2.0° (tol 0.0°)');
  });
  it('says in the first header cell which cut the tilted values are of, as the band table copy does', () => {
    const sim = compareTsv({ ...a, tilted: a.columns }, { ...b, tilted: b.columns }, DEFAULT_SETTINGS, true, true).split('\r\n');
    expect(sim[0].split('\t')[0]).toBe('Parameter [tilted: H cut at the horizon]');
  });
});

describe('bandCsv while comparing', () => {
  const single = bandCsv([a, b], DEFAULT_SETTINGS).trimEnd().split('\r\n');
  const csv = bandCsv([a, b], DEFAULT_SETTINGS, false, true, { a, b });
  const lines = csv.trimEnd().split('\r\n');
  it('adds a Row column and keeps every antenna line as it is without the comparison', () => {
    expect(lines[0]).toBe(`Row,${single[0]}`);
    for (let i = 1; i < single.length; i++) expect(lines[i]).toBe(`statistic,${single[i]}`);
  });
  it('appends one difference line per sub-band and parameter, with B − A of each numeric column where both antennas have it', () => {
    const diffs = lines.slice(single.length);
    expect(diffs).toHaveLength(bands.length * BAND_PARAMS.length);
    const az = diffs.find((l) => l.includes(',Azimuth beamwidth,'))!.split(',');
    expect(az.slice(0, 10)).toEqual(['difference', 'Array Y2 − Array Y1', '1800–1900 MHz', '1800', '1900', 'Azimuth beamwidth', '°', 'double-sided', '', '+2.0° (tol 0.0°)']);
    // Value, Tolerance, Lower, Upper, Percentile, Min, Max, Mean, Counted as 22 dB, Adjusted.
    expect(az.slice(10)).toEqual(['2.00', '0.00', '2.00', '2.00', '', '2.00', '2.00', '2.00', '', '']);
    const gain = diffs.find((l) => l.includes('Gain, all tilts'))!;
    expect(gain).toContain(',dB,double-sided,,');
    const tilts = diffs.find((l) => l.includes('Electrical tilt range'))!;
    expect(tilts).toContain('absolute,,"lowest 0°, highest 0°",,,,,,0.00,0.00,,,');
    const none = diffs.find((l) => l.startsWith('difference,Array Y2 − Array Y1,2600 MHz') && l.includes('Azimuth beamwidth'))!;
    expect(none.endsWith(',—,,,,,,,,,,')).toBe(true);
  });
  it('names the tilts of a gain-at-tilt difference in its Parameter', () => {
    const line = lines.find((l) => l.startsWith('difference') && l.includes('Gain, lowest tilt'))!;
    expect(line).toContain('"Gain, lowest tilt (2°)"');
  });
  it('has a State column with a difference line per state under a simulation', () => {
    const sim = bandCsv([{ ...a, tilted: a.columns }, { ...b, tilted: b.columns }], DEFAULT_SETTINGS, false, true, { a: { ...a, tilted: a.columns }, b: { ...b, tilted: b.columns } }).trimEnd().split('\r\n');
    expect(sim[0].startsWith('Row,Antenna,State,Sub-band')).toBe(true);
    const diffs = sim.filter((l) => l.startsWith('difference,'));
    expect(diffs).toHaveLength(2 * bands.length * BAND_PARAMS.length);
    expect(diffs[0].split(',')[2]).toBe('original');
    expect(diffs[1].split(',')[2]).toBe('tilted');
  });
});

describe('legend and note', () => {
  it('has a legend for differences partly of 22 dB substitutes, shown only when one is', () => {
    expect(SUBSTITUTED_LEGEND).toBe('† partly of "not available" values counted as 22 dB (BASTA 12.5.3)');
    expect(anySubstituted(compareDiffs(a, b))).toBe(false);
    const withSub = compareDiffs(a, { ...b, columns: b.columns.map((c) => ({ ...c, cells: { ...c.cells, usls: { ...c.cells.usls, substituted: 2 } } })) });
    expect(anySubstituted(withSub)).toBe(withSub.some((c) => c.usls.original.substituted));
  });
  it('says what is compared, and where the automatic sub-bands come from', () => {
    expect(compareNote('Array Y1', 'Array Y2', true)).toBe(
      'Comparing A = Array Y1 with B = Array Y2: B − A per sub-band, a signed difference (no better or worse). Automatic sub-bands are made over the files of both antennas.',
    );
    expect(compareNote('Array Y1', 'Array Y2', false)).not.toContain('Automatic');
  });
});
