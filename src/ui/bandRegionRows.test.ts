import { describe, expect, it } from 'vitest';
import { ANGULAR_REGION_PARAMS, BAND_PARAMS, bandRows, bandTable, cellOf, type BandColumn } from '../core/analysis/bandParams';
import { analyzeAll, DEFAULT_SETTINGS, type PatternMetrics, type TaggedPattern } from '../core/analysis/metrics';
import { analyzeTilted, tiltEach } from '../core/analysis/tilt';
import { groupPatterns } from '../state/selectors';
import { bandItems } from '../test/bandFixture';
import { bandCsv, bandTsv, beyondAnnexNote, cellDisplay } from './bandView';
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

  it('percentage rows: a difference in percentage points (pp) of the means', () => {
    const d = diffOf(diffs[0], 'areSector');
    expect(d.tilted!.numbers.mean).toBeCloseTo(stat(b.tilted[0], 'areSector') - stat(a.tilted[0], 'areSector'), 9);
    expect(d.tilted!.unit).toBe('pp');
    expect(d.original.text).toBe('0.0 pp (tol 0.0 pp)');
    expect(diffDisplay(d.original, d.tilted).text).toMatch(/^0\.0 pp \(tol 0\.0 pp\) → [+-]\d+\.\d pp \(tol [+-]?\d+\.\d pp\)$/);
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
    expect(diffLines.find((l) => l.includes(',Spatial efficiency est. [Summation],'))!.split(',')[7]).toBe('pp');
  });
});

describe('the lower region ratio of the review (S1, C2)', () => {
  // Ten files whose lower ratio is about 0.0007 %, and the same moved to about 0.0012 % (as a tilt does on the example).
  const its: TaggedPattern[] = Array.from({ length: 10 }, (_, k) => ({ pattern: { id: `z${k}`, frequencyMHz: 1800 }, tags: {} }) as unknown as TaggedPattern);
  const at = (base: number) => new Map(its.map((it, k) => [it.pattern.id, { are: { lower: { value: base + 0.00002 * k } } } as unknown as PatternMetrics]));
  const lowerRows = ANGULAR_REGION_PARAMS.filter((p) => p.key === 'areLower');
  const a = bandTable(its, at(0.0007), all, ctx, lowerRows)[0];
  const b = bandTable(its, at(0.0012), all, ctx, lowerRows)[0];

  it('a pair that differs within the CSV decimals is shown as a pair, and the tolerance is not 0.000', () => {
    expect(cellOf(a, 'areLower').text).toMatch(/^0\.001 % ± 0\.0000?[1-9]\d* %$/);
    const shown = cellDisplay(cellOf(a, 'areLower'), cellOf(b, 'areLower')).text;
    expect(shown).toContain('→');
    expect(shown).toMatch(/^0\.0008 % ± .* → 0\.0013 % ± .*$/);
    // The same values stay one.
    expect(cellDisplay(cellOf(a, 'areLower'), cellOf(a, 'areLower')).text).not.toContain('→');
  });

  it('the difference CSV line writes a small B − A with a digit, not 0.0000', () => {
    const near = bandTable(its, at(0.000701), all, ctx, lowerRows)[0];
    const csv = bandCsv([{ label: 'A', columns: [a] }, { label: 'B', columns: [near] }], DEFAULT_SETTINGS, false, true, { a: { label: 'A', columns: [a] }, b: { label: 'B', columns: [near] } }, { rows: lowerRows, method: 'summation' }).split('\r\n');
    const line = csv.find((l) => l.startsWith('difference,') && l.includes(',Lower region ratio est. [Summation],'))!.split(',');
    // Row, Antenna, Sub-band, Min, Max, Parameter, Unit, Type, N, Statistic, Value …
    expect(line[6]).toBe('pp');
    expect(line[10]).toBe('0.000001');
  });
});

describe('the intro says which rows are not BASTA parameters', () => {
  it('names the rows shown', () => {
    expect(beyondAnnexNote(false, false)).toBeNull();
    expect(beyondAnnexNote(true, false)).toBe('The Horizon level row is not a BASTA parameter; it is summarised the same way.');
    expect(beyondAnnexNote(false, true)).toBe('The angular-region estimate rows are not BASTA parameters; they are summarised the same way.');
    expect(beyondAnnexNote(true, true)).toMatch(/^The Horizon level and angular-region estimate rows are not BASTA parameters/);
  });
});

describe('one file whose lower region ratio is equal at three decimals and differs at four (re-review S1′)', () => {
  // Tilted (the table shows a pair for the estimate only under a tilt).
  const m = run(TILT, 'horizon', [items[0]]);
  const id = items[0].pattern.id;
  const withLower = (map: Map<string, PatternMetrics>, value: number) => {
    const x = map.get(id)!;
    return new Map([[id, { ...x, are: { ...x.are, lower: { value } } }]]);
  };
  const pair = { original: withLower(m.original, 0.0007), simulated: withLower(m.simulated, 0.0012) };

  it('the table cell and the band cell both show the two values, with the same digits', () => {
    const r = table([items[0]], pair, true)[0];
    const t = rowCell(r, 'areLower').text;
    expect(t).toBe('0.0007 → 0.0012');
    const original = bandTable([items[0]], pair.original, all, ctx, rows)[0];
    const simulated = bandTable([items[0]], pair.simulated, all, ctx, rows)[0];
    expect(cellDisplay(cellOf(original, 'areLower'), cellOf(simulated, 'areLower')).text).toBe('0.0007 % → 0.0012 %');
  });

  it('values equal at four decimals stay one; other columns keep their decimals', () => {
    const same = { original: withLower(m.original, 0.00071), simulated: withLower(m.simulated, 0.00072) };
    expect(rowCell(table([items[0]], same, true)[0], 'areLower').text).toBe('0.001');
    const r = table([items[0]], m, true)[0];
    expect(rowCell(r, 'hHpbw').text).toMatch(/^\d+\.\d( → \d+\.\d)?$/);
    expect(rowCell(r, 'areSector').text).toMatch(/^\d+\.\d( → \d+\.\d)?$/);
  });
});
