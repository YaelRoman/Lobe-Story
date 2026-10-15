import { describe, expect, it } from 'vitest';
import {
  ANGULAR_REGION_PARAMS,
  BAND_PARAMS,
  bandCell,
  bandParamLabel,
  bandParamTitle,
  bandRows,
  bandTable,
  cellOf,
  cellText,
  collectSamples,
  HORIZON_LEVEL_PARAM,
  pairDecimals,
  type BandCell,
  type BandParam,
} from './bandParams';
import { bandDiff, spokenDiff } from './bandCompare';
import { arithmeticMean, doubleSided, meanOf, powerLevelMeanDb, powerMeanDb } from './bandStats';
import { analyzeAll, DEFAULT_SETTINGS, type PatternMetrics, type TaggedPattern } from './metrics';
import { analyzeTilted, tiltEach } from './tilt';
import { bandItems } from '../../test/bandFixture';

// Twelve files with the angular-region estimate (Summation): the values the metrics table shows, read by the band rows.
const HEAVY_TEST_MS = 30_000;
const items = bandItems();
const ctx = { gainUnit: 'dBi' as const, settings: DEFAULT_SETTINGS };
const band = [{ name: '1800–1900 MHz', minMHz: 1800, maxMHz: 1900 }];
const param = (key: string): BandParam => [...ANGULAR_REGION_PARAMS, HORIZON_LEVEL_PARAM].find((p) => p.key === key)!;
const NONE = { electricalDeg: 0, mechanicalDeg: 0 };

let withAre: Map<string, PatternMetrics> | undefined;
const areMetrics = () => (withAre ??= analyzeAll(items, DEFAULT_SETTINGS, { areMethod: 'summation' }));
let horizon: Map<string, PatternMetrics> | undefined;
const horizonMetrics = () => (horizon ??= analyzeTilted(tiltEach(items, () => NONE, 'summation', 'horizon'), DEFAULT_SETTINGS, () => NONE));

describe('which rows the band table has', () => {
  it('the Annex C list alone by default; the Horizon level after the azimuth beamwidth; the angular regions last', () => {
    expect(bandRows({ angularRegions: false, horizonLevel: false })).toBe(BAND_PARAMS);
    const both = bandRows({ angularRegions: true, horizonLevel: true }).map((p) => p.key);
    expect(both.slice(5, 8)).toEqual(['hHpbw', 'horizonLevel', 'vHpbw']);
    expect(both.slice(-3)).toEqual(['areSector', 'areSpatial', 'areLower']);
    expect(both).toHaveLength(BAND_PARAMS.length + 4);
    expect(bandRows({ angularRegions: true, horizonLevel: false }).map((p) => p.key)).not.toContain('horizonLevel');
    expect(bandRows({ angularRegions: false, horizonLevel: true }).map((p) => p.key)).not.toContain('areSector');
  });

  it('a table made with the rows has their cells; one made without them has none (and asking for one is an error)', () => {
    const plain = bandTable(items, analyzeAll(items), band, ctx)[0];
    expect(plain.cells.areSector).toBeUndefined();
    expect(() => cellOf(plain, 'horizonLevel')).toThrow(/without the row horizonLevel/);
  });

  it('labels and titles: the estimate names its 3D method and says it is not BASTA-compliant; the wording of the table', () => {
    const s = DEFAULT_SETTINGS;
    expect(bandParamLabel(param('areSector'), s, 'summation')).toBe('Sector efficiency est. [Summation]');
    expect(bandParamLabel(param('areLower'), s, 'weighted')).toBe('Lower region ratio est. [Weighted]');
    expect(bandParamLabel(param('horizonLevel'), s, 'summation')).toBe('Horizon level');
    expect(bandParamTitle(param('areSpatial'), s, 'weighted')).toMatch(/3D method: Weighted\); not BASTA-compliant/);
    expect(bandParamTitle(param('areSpatial'), s, 'weighted')).toMatch(/arithmetic mean/);
    expect(bandParamTitle(param('horizonLevel'), s)).toMatch(/below the 3D peak.*mean is that of the linear power at the horizon/);
    expect(bandParamTitle(param('horizonLevel'), s)).not.toMatch(/\(BASTA \)/);
  });
});

describe('angular-region rows', () => {
  it('read the values the metrics hold (no estimate is made again), and are empty where none was computed', () => {
    const m = areMetrics();
    const s = collectSamples('areSector', items, m, 'dBi');
    expect(s.values).toEqual(items.map((i) => m.get(i.pattern.id)!.are.sector.value));
    expect(s.values.every((v) => typeof v === 'number' && v > 0 && v < 100)).toBe(true);
    const none = bandCell(param('areSector'), items, analyzeAll(items), ctx);
    expect(none.state).toBe('empty');
    expect(none.missing).toBe(12);
  }, HEAVY_TEST_MS);

  it('double-sided over the percentages with an arithmetic mean (BASTA 12.4.2 for %)', () => {
    const m = areMetrics();
    for (const key of ['areSector', 'areSpatial', 'areLower']) {
      const c = bandCell(param(key), items, m, ctx);
      const values = items.map((i) => m.get(i.pattern.id)!.are[key === 'areSector' ? 'sector' : key === 'areSpatial' ? 'spatial' : 'lower'].value!);
      expect(c.state).toBe('ok');
      expect(c.unit).toBe('%');
      expect(c.stat?.kind).toBe('double');
      if (c.stat?.kind !== 'double') continue;
      expect(c.stat.mean).toBeCloseTo(arithmeticMean(values), 12);
      expect(c.stat).toEqual(doubleSided(values, 'arithmetic'));
    }
  }, HEAVY_TEST_MS);

  it('the lower region ratio keeps three decimals (four in the tooltip numbers), as the metrics table', () => {
    const c = bandCell(param('areLower'), items, areMetrics(), ctx);
    expect(c.decimals).toBe(3);
    expect(c.text).toMatch(/^\d+\.\d{3} % ± \d+\.\d{3} %$/);
    expect(c.title).toMatch(/min \d+\.\d{4} · max \d+\.\d{4}/);
    expect(bandCell(param('areSector'), items, areMetrics(), ctx).text).toMatch(/^\d+\.\d % ± \d+\.\d %$/);
  }, HEAVY_TEST_MS);

  it('a file whose beam is not Type A gives no value and is counted as without one', () => {
    const m = new Map(areMetrics());
    const first = items[0].pattern.id;
    m.set(first, { ...m.get(first)!, are: { sector: { value: null, reason: 'Not a Type A' }, spatial: { value: null, reason: 'x' }, lower: { value: null, reason: 'x' } } });
    const c = bandCell(param('areSpatial'), items, m, ctx);
    expect(c.n).toBe(11);
    expect(c.missing).toBe(1);
  }, HEAVY_TEST_MS);
});

describe('the Horizon level row', () => {
  it('the mean of levels below the peak is the level of the mean linear power, not pulled to the deepest values', () => {
    // 1, 1, 16, 16 dB below the peak: the mean power at the horizon is 10^(−0.1)/2 + 10^(−1.6)/2 → 3.87 dB below.
    expect(powerLevelMeanDb([1, 1, 16, 16])).toBeCloseTo(-10 * Math.log10((10 ** -0.1 + 10 ** -1.6) / 2), 12);
    expect(powerLevelMeanDb([1, 1, 16, 16])).toBeCloseTo(3.875, 3);
    expect(meanOf([1, 1, 16, 16], 'powerLevel')).toBeCloseTo(3.875, 3);
    // The power mean of the other sign (roll-off's) would say 13.1 dB; roll-off keeps it.
    expect(powerMeanDb([1, 1, 16, 16])).toBeCloseTo(13.12, 2);
    expect(BAND_PARAMS.find((p) => p.key === 'rollOff')!.mean).toBe('power');
    // The cell: the tolerance is still that of the dB percentiles, and the mean lies between them.
    const four = [1, 1, 16, 16, 1, 1, 16, 16, 1, 16].map((v, k) => ({ id: `x${k}`, v }));
    const m = new Map(four.map(({ id, v }) => [id, { hCutPeakDb: v } as unknown as PatternMetrics]));
    const its = four.map(({ id }) => ({ pattern: { id, frequencyMHz: 1800 }, tags: {} }) as unknown as TaggedPattern);
    const c = bandCell(HORIZON_LEVEL_PARAM, its, m, ctx);
    const st = c.stat!;
    if (st.kind !== 'double') throw new Error('double-sided');
    expect(st.mean).toBeCloseTo(powerLevelMeanDb(four.map((f) => f.v)), 12);
    expect(st.mean).toBeGreaterThanOrEqual(st.lower);
    expect(st.mean).toBeLessThanOrEqual(st.upper);
    expect(st.tolerance).toBeCloseTo((st.upper - st.lower) / 2, 12);
    expect(c.title).toMatch(/linear power at the horizon/);
  });

  it('one sample per horizon cut (the table column), none of a file cut; mean of the linear power at the horizon', () => {
    const m = horizonMetrics();
    const levels = items.map((i) => m.get(i.pattern.id)!.hCutPeakDb!);
    expect(levels.every((v) => v >= 0)).toBe(true);
    const c = bandCell(HORIZON_LEVEL_PARAM, items, m, ctx);
    expect(c.state).toBe('ok');
    expect(c.values).toEqual(levels);
    expect(c.stat?.kind === 'double' && c.stat.mean).toBeCloseTo(powerLevelMeanDb(levels), 12);
    expect(c.title).toMatch(/linear power at the horizon/);
    const fileCut = bandCell(HORIZON_LEVEL_PARAM, items, analyzeAll(items), ctx);
    expect(fileCut.state).toBe('empty');
    expect(fileCut.missing).toBe(12);
  });
});

describe('one file: the band statistic is the file\'s table value', () => {
  // Fewer than ten values: the range is shown, which for one file is that file's value, with the table's decimals.
  const one = (m: Map<string, PatternMetrics>, key: string, item: TaggedPattern): BandCell => bandCell(param(key), [item], m, ctx);
  it('angular regions and Horizon level', () => {
    const m = areMetrics();
    for (const item of items) {
      const are = m.get(item.pattern.id)!.are;
      expect(one(m, 'areSector', item).text).toBe(`${are.sector.value!.toFixed(1)} %`);
      expect(one(m, 'areSpatial', item).text).toBe(`${are.spatial.value!.toFixed(1)} %`);
      expect(one(m, 'areLower', item).text).toBe(`${are.lower.value!.toFixed(3)} %`);
    }
    const h = horizonMetrics();
    for (const item of items) expect(one(h, 'horizonLevel', item).text).toBe(`${h.get(item.pattern.id)!.hCutPeakDb!.toFixed(1)} dB`);
  }, HEAVY_TEST_MS);
});

describe('sub-bands', () => {
  it('each sub-band summarises its own files only', () => {
    const m = areMetrics();
    const split = [
      { name: 'low', minMHz: 1800, maxMHz: 1850 },
      { name: 'high', minMHz: 1900, maxMHz: 1900 },
    ];
    const rows = bandRows({ angularRegions: true, horizonLevel: false });
    const [low, high] = bandTable(items, m, split, ctx, rows);
    const values = (f: number[]) => items.filter((i) => f.includes(i.pattern.frequencyMHz)).map((i) => m.get(i.pattern.id)!.are.sector.value!);
    expect(cellOf(low, 'areSector').values).toEqual(values([1800, 1850]));
    expect(cellOf(low, 'areSector').n).toBe(8);
    expect(cellOf(high, 'areSector').values).toEqual(values([1900]));
    expect(cellOf(high, 'areSector').state).toBe('few');
  }, HEAVY_TEST_MS);
});

describe('pairs of a row with its own decimals', () => {
  /** The lower-region cell of one file whose ratio is `v`. */
  const lower = (v: number): BandCell =>
    bandCell(param('areLower'), [items[0]], new Map([[items[0].pattern.id, { are: { lower: { value: v } } } as unknown as PatternMetrics]]), ctx);
  it('as many decimals as a value that is not zero needs to show a digit', () => {
    const a = lower(0.0009);
    const b = lower(0.0002);
    expect(a.text).toBe('0.001 %');
    expect(b.text).toBe('0.000 %');
    expect(pairDecimals(a, b)).toBe(4);
    expect(cellText(a, 4)).toBe('0.0009 %');
    expect(cellText(b, 4)).toBe('0.0002 %');
    expect(pairDecimals(lower(0.25), lower(0.12))).toBe(3);
  });
  it('two values that differ are compared at finer precision before they are shown as one (up to the CSV decimals)', () => {
    // 0.0007 and 0.0012 both read 0.001 with three decimals.
    const a = lower(0.0007);
    const b = lower(0.0012);
    expect(a.text).toBe(b.text);
    expect(pairDecimals(a, b)).toBe(4);
    expect(pairDecimals(a, lower(0.0007))).toBe(3);
    // Equal at four decimals: shown once.
    expect(pairDecimals(lower(0.00071), lower(0.00072))).toBe(3);
  });
  it('a tolerance that is not zero does not read 0.000', () => {
    const its = Array.from({ length: 10 }, (_, k) => ({ pattern: { id: `y${k}`, frequencyMHz: 1800 }, tags: {} }) as unknown as TaggedPattern);
    const m = new Map(its.map((it, k) => [it.pattern.id, { are: { lower: { value: 0.0007 + 0.00005 * k } } } as unknown as PatternMetrics]));
    const c = bandCell(param('areLower'), its, m, ctx);
    expect(c.text).toMatch(/^0\.001 % ± 0\.000[1-9]\d* %$/);
  });
  it('other rows keep their decimals', () => {
    const c = bandCell(BAND_PARAMS.find((p) => p.key === 'hHpbw')!, items, analyzeAll(items), ctx);
    expect(pairDecimals(c, c)).toBe(1);
  });
});

describe('B − A of the new rows', () => {
  const shifted = (m: Map<string, PatternMetrics>, by: number): Map<string, PatternMetrics> =>
    new Map(
      [...m].map(([id, x]) => [
        id,
        {
          ...x,
          are: { sector: { value: x.are.sector.value! + by }, spatial: { value: x.are.spatial.value! + by }, lower: { value: x.are.lower.value! + by / 1000 } },
          ...(x.hCutPeakDb === undefined ? {} : { hCutPeakDb: x.hCutPeakDb + by }),
        },
      ]),
    );
  it('a percentage row: percentage points, written pp', () => {
    const m = areMetrics();
    const a = bandCell(param('areSector'), items, m, ctx);
    const b = bandCell(param('areSector'), items, shifted(m, 2.5), ctx);
    const d = bandDiff(a, b);
    expect(d.unit).toBe('pp');
    expect(d.numbers.mean).toBeCloseTo(2.5, 9);
    expect(d.text).toBe('+2.5 pp (tol 0.0 pp)');
    expect(spokenDiff(d.text)).toBe('+2.5 percentage points (tol 0.0 percentage points)');
    expect(d.title).toMatch(/B − A of the mean \(pp: percentage points\)/);
  }, HEAVY_TEST_MS);
  it('the lower region ratio: three decimals, more when a difference would read 0.000', () => {
    const m = areMetrics();
    const a = bandCell(param('areLower'), items, m, ctx);
    const d = bandDiff(a, bandCell(param('areLower'), items, shifted(m, 0.4), ctx));
    expect(d.text).toBe('+0.0004 pp (tol 0.000 pp)');
  }, HEAVY_TEST_MS);
  it('the Horizon level: a dB difference of the two corrected means', () => {
    const m = horizonMetrics();
    const a = bandCell(HORIZON_LEVEL_PARAM, items, m, ctx);
    const d = bandDiff(a, bandCell(HORIZON_LEVEL_PARAM, items, shifted(m, 1), ctx));
    expect(d.unit).toBe('dB');
    expect(d.text).toMatch(/^\+\d\.\d dB \(tol [+-]?\d\.\d dB\)$/);
    const mean = (x: BandCell) => (x.stat?.kind === 'double' ? x.stat.mean : NaN);
    const b = bandCell(HORIZON_LEVEL_PARAM, items, shifted(m, 1), ctx);
    expect(d.numbers.mean).toBeCloseTo(mean(b) - mean(a), 12);
    expect(mean(a)).toBeCloseTo(powerLevelMeanDb(items.map((i) => m.get(i.pattern.id)!.hCutPeakDb!)), 12);
  });
});
