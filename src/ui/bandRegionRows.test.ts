import { describe, expect, it } from 'vitest';
import { BAND_PARAMS, bandRows, bandTable, cellOf, type BandColumn } from '../core/analysis/bandParams';
import { analyzeAll, DEFAULT_SETTINGS, type PatternMetrics, type TaggedPattern } from '../core/analysis/metrics';
import { analyzeTilted, tiltEach } from '../core/analysis/tilt';
import { groupPatterns } from '../state/selectors';
import { bandItems } from '../test/bandFixture';
import { bandCsv, bandTsv, cellDisplay } from './bandView';
import { compareDiffs, compareTsv, diffDisplay, diffOf } from './bandCompareView';
import { buildRows, HORIZON_WORDS, rowCell, TILT_WORDS } from './table';
import { HORIZON_LEVEL_KEY } from '../state/metricKeys';
import { statText } from './bandHistFigure';

// The band rows of the angular-region estimate and the Horizon level, against the metrics table's own cells.
const items = bandItems();
const ctx = { gainUnit: 'dBi' as const, settings: DEFAULT_SETTINGS };
const all = [{ name: '1800–1900 MHz', minMHz: 1800, maxMHz: 1900 }];
const NONE = { electricalDeg: 0, mechanicalDeg: 0 };
const TILT = { electricalDeg: 2, mechanicalDeg: 3 };
const rows = bandRows({ angularRegions: true, horizonLevel: true });

/** Original and simulated metrics as App makes them: the estimate with Summation, the simulation `tilt` with the cut at the horizon. */
function run(tilt: typeof NONE, hCut: 'beam' | 'horizon', list: TaggedPattern[] = items) {
  const original = analyzeAll(list, DEFAULT_SETTINGS, { areMethod: 'summation' });
  const simulated = analyzeTilted(tiltEach(list, () => tilt, 'summation', hCut), DEFAULT_SETTINGS, () => tilt, 'summation');
  return { original, simulated };
}

const table = (list: TaggedPattern[], m: { original: Map<string, PatternMetrics>; simulated: Map<string, PatternMetrics> }, tilted: boolean) =>
  buildRows(groupPatterns(list), m.original, 'dBi', m.simulated, () => tilted, () => true);

describe('one file: the band cell is the metrics table cell (with the unit)', () => {
  const KEYS = [
    ['areSector', 'areSector', ' %'],
    ['areSpatial', 'areSpatial', ' %'],
    ['areLower', 'areLower', ' %'],
  ] as const;
  for (const [label, tilt, hCut] of [
    ['horizon cut, no tilt', NONE, 'horizon'],
    ['electrical + mechanical tilt at the horizon', TILT, 'horizon'],
    ['mechanical tilt through the beam peak', { electricalDeg: 0, mechanicalDeg: 4 }, 'beam'],
  ] as const) {
    it(label, () => {
      const m = run(tilt, hCut);
      const words = tilt === NONE ? HORIZON_WORDS : TILT_WORDS;
      const metricRows = table(items, m, tilt !== NONE);
      for (const item of items.slice(0, 4)) {
        const one = [item];
        const original = bandTable(one, m.original, all, ctx, rows)[0];
        const simulated = bandTable(one, m.simulated, all, ctx, rows)[0];
        const r = metricRows.find((x) => x.id === item.pattern.id)!;
        for (const [band, col, unit] of KEYS) {
          const shown = cellDisplay(cellOf(original, band), cellOf(simulated, band), words).text;
          const t = rowCell(r, col, words).text;
          // A pair is written "a → b" in both; the band cell carries the unit after each value.
          expect(shown).toBe(t.split(' → ').map((v) => v + unit).join(' → '));
        }
        const level = rowCell(r, HORIZON_LEVEL_KEY, words).text;
        // Through the beam peak there is no Horizon level: a dash in both (and the row is not shown then).
        expect(cellDisplay(cellOf(original, 'horizonLevel'), cellOf(simulated, 'horizonLevel'), words).text).toBe(hCut === 'beam' ? level : `${level} dB`);
        if (hCut === 'beam') expect(level).toBe('—');
      }
    }, 30_000);
  }
});

describe('the Horizon level is a single value, of the horizon cut', () => {
  const m = run(NONE, 'horizon');
  const original = bandTable(items, m.original, all, ctx, rows);
  const simulated = bandTable(items, m.simulated, all, ctx, rows);

  it('the cell shows the horizon-cut statistic alone, never "— → …"', () => {
    const d = cellDisplay(cellOf(original[0], 'horizonLevel'), cellOf(simulated[0], 'horizonLevel'), HORIZON_WORDS);
    expect(cellOf(original[0], 'horizonLevel').text).toBe('—');
    expect(d.text).toBe(cellOf(simulated[0], 'horizonLevel').text);
    expect(d.text).not.toContain('→');
  });

  it('band CSV: one line of the horizon cut (no "original" line); angular rows name the method; State words of the mode', () => {
    const csv = (tiltActive: boolean) => bandCsv([{ label: 'Array Y1', columns: original, tilted: simulated }], DEFAULT_SETTINGS, true, tiltActive, undefined, { rows, method: 'summation' }).split('\r\n');
    const lines = csv(false);
    const of = (label: string) => lines.filter((l) => l.includes(`,${label},`)).map((l) => l.split(',')[1]);
    expect(of('Horizon level')).toEqual(['horizon cut']);
    expect(csv(true).filter((l) => l.includes(',Horizon level,')).map((l) => l.split(',')[1])).toEqual(['tilted [H cut at the horizon]']);
    expect(of('Sector efficiency est. [Summation]')).toEqual(['original', 'simulated']);
    expect(lines.join('\n')).not.toMatch(/tilted/);
    expect(lines).toHaveLength(2 * BAND_PARAMS.length + 1 + 2 * 3 + 2);
    // No comment preamble: the first line is the header.
    expect(lines[0].startsWith('Antenna,State,Sub-band')).toBe(true);
    // The lower region ratio has four decimals in its numeric columns.
    const lower = lines.find((l) => l.includes(',Lower region ratio est. [Summation],') && l.split(',')[1] === 'simulated')!.split(',');
    expect(lower[6]).toBe('%');
    expect(lower[11]).toMatch(/^\d+\.\d{4}$/);
  });

  it('copied table: the rows, labels and cells as shown', () => {
    const tsv = bandTsv(original, simulated, DEFAULT_SETTINGS, true, false, { rows, method: 'weighted' }).split('\r\n');
    const first = tsv.map((l) => l.split('\t')[0]);
    expect(first.indexOf('Horizon level')).toBe(first.indexOf('Azimuth beamwidth') + 1);
    expect(first.slice(-4, -1)).toEqual(['Sector efficiency est. [Weighted]', 'Spatial efficiency est. [Weighted]', 'Lower region ratio est. [Weighted]']);
    expect(tsv.find((l) => l.startsWith('Horizon level\t'))!.split('\t')[1]).toBe(cellOf(simulated[0], 'horizonLevel').text);
  });

  it('without the extra rows the CSV and copy are as before', () => {
    const plainCols = bandTable(items, m.original, all, ctx);
    expect(bandTsv(plainCols, null, DEFAULT_SETTINGS).split('\r\n')).toHaveLength(BAND_PARAMS.length + 2);
    expect(bandCsv([{ label: 'A', columns: plainCols }], DEFAULT_SETTINGS)).toBe(bandCsv([{ label: 'A', columns: plainCols }], DEFAULT_SETTINGS, false, true, undefined, { rows: BAND_PARAMS }));
  });

  it('the histogram statistic of the lower region has its decimals', () => {
    expect(statText(cellOf(simulated[0], 'areLower').stat, '%', 4)).toMatch(/^mean \d+\.\d{1,4} %/);
  });
});

describe('two antennas: A | B | B − A', () => {
  // B: the same files with one more degree of electrical tilt, taken as another antenna.
  const bItems: TaggedPattern[] = items.map((i) => ({ ...i, pattern: { ...i.pattern, id: `b-${i.pattern.id}` }, tags: { ...i.tags, array: 'Y2' } }));
  const ma = run(NONE, 'horizon');
  const mb = run(NONE, 'horizon', bItems);
  const tiltedB = analyzeTilted(tiltEach(bItems, () => ({ electricalDeg: 1, mechanicalDeg: 0 }), 'summation', 'horizon'), DEFAULT_SETTINGS, () => ({ electricalDeg: 1, mechanicalDeg: 0 }), 'summation');
  const sheet = (label: string, o: Map<string, PatternMetrics>, s: Map<string, PatternMetrics>, list: TaggedPattern[]) => ({
    label,
    columns: bandTable(list, o, all, ctx, rows),
    tilted: bandTable(list, s, all, ctx, rows),
  });
  const a = sheet('Y1', ma.original, ma.simulated, items);
  const b = sheet('Y2', mb.original, tiltedB, bItems);
  const diffs = compareDiffs(a, b, rows);
  const stat = (c: BandColumn, key: 'areSector' | 'horizonLevel') => {
    const st = cellOf(c, key).stat;
    return st?.kind === 'double' ? st.mean : NaN;
  };

  it('percentage rows: a difference in percentage points of the means', () => {
    const d = diffOf(diffs[0], 'areSector');
    expect(d.tilted!.numbers.mean).toBeCloseTo(stat(b.tilted[0], 'areSector') - stat(a.tilted[0], 'areSector'), 9);
    expect(d.tilted!.unit).toBe('%');
    expect(d.original.text).toBe('0.0 % (tol 0.0 %)');
    expect(diffDisplay(d.original, d.tilted).text).toMatch(/^0\.0 % \(tol 0\.0 %\) → [+-]\d+\.\d % \(tol [+-]?\d+\.\d %\)$/);
  });

  it('Horizon level: one dB difference, of the horizon cuts', () => {
    const d = diffOf(diffs[0], 'horizonLevel');
    expect(d.tilted).toBeUndefined();
    expect(d.original.unit).toBe('dB');
    expect(d.original.numbers.mean).toBeCloseTo(stat(b.tilted[0], 'horizonLevel') - stat(a.tilted[0], 'horizonLevel'), 9);
    expect(diffDisplay(d.original, d.tilted).text).not.toContain('→');
  });

  it('copied comparison and CSV difference lines carry the rows', () => {
    const tsv = compareTsv(a, b, DEFAULT_SETTINGS, true, true, { rows, method: 'summation' }).split('\r\n');
    const line = tsv.find((l) => l.startsWith('Horizon level\t'))!.split('\t');
    expect(line).toHaveLength(4);
    expect(line[3]).toBe(diffOf(diffs[0], 'horizonLevel').original.text.replace(/^([+-])/, "'$1"));
    const csv = bandCsv([a, b], DEFAULT_SETTINGS, true, true, { a, b }, { rows, method: 'summation' }).split('\r\n');
    const diffLines = csv.filter((l) => l.startsWith('difference,'));
    expect(diffLines.filter((l) => l.includes(',Horizon level,'))).toHaveLength(1);
    expect(diffLines.filter((l) => l.includes(',Spatial efficiency est. [Summation],'))).toHaveLength(2);
    expect(diffLines.find((l) => l.includes(',Spatial efficiency est. [Summation],'))!.split(',')[7]).toBe('%');
  });
});
