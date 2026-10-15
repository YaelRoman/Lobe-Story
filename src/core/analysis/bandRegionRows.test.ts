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
import { bandDiff } from './bandCompare';
import { arithmeticMean, doubleSided, powerMeanDb } from './bandStats';
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
    expect(bandParamTitle(param('horizonLevel'), s)).toMatch(/below the 3D peak.*linear values as for roll-off/);
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
  it('one sample per horizon cut (the table column), none of a file cut; mean over linear values as roll-off', () => {
    const m = horizonMetrics();
    const levels = items.map((i) => m.get(i.pattern.id)!.hCutPeakDb!);
    expect(levels.every((v) => v >= 0)).toBe(true);
    const c = bandCell(HORIZON_LEVEL_PARAM, items, m, ctx);
    expect(c.state).toBe('ok');
    expect(c.values).toEqual(levels);
    expect(c.stat?.kind === 'double' && c.stat.mean).toBeCloseTo(powerMeanDb(levels), 12);
    expect(c.title).toMatch(/linear values and converted back to dB/);
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
  it('a percentage row: percentage points, with the unit %', () => {
    const m = areMetrics();
    const a = bandCell(param('areSector'), items, m, ctx);
    const b = bandCell(param('areSector'), items, shifted(m, 2.5), ctx);
    const d = bandDiff(a, b);
    expect(d.unit).toBe('%');
    expect(d.numbers.mean).toBeCloseTo(2.5, 9);
    expect(d.text).toBe('+2.5 % (tol 0.0 %)');
    expect(d.title).toMatch(/B − A of the mean \(percentage points\)/);
  }, HEAVY_TEST_MS);
  it('the lower region ratio: three decimals, more when a difference would read 0.000', () => {
    const m = areMetrics();
    const a = bandCell(param('areLower'), items, m, ctx);
    const d = bandDiff(a, bandCell(param('areLower'), items, shifted(m, 0.4), ctx));
    expect(d.text).toBe('+0.0004 % (tol 0.000 %)');
  }, HEAVY_TEST_MS);
  it('the Horizon level: a dB difference', () => {
    const m = horizonMetrics();
    const a = bandCell(HORIZON_LEVEL_PARAM, items, m, ctx);
    const d = bandDiff(a, bandCell(HORIZON_LEVEL_PARAM, items, shifted(m, 1), ctx));
    expect(d.unit).toBe('dB');
    expect(d.text).toMatch(/^\+\d\.\d dB \(tol [+-]?\d\.\d dB\)$/);
  });
});
