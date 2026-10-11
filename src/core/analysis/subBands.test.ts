import { describe, expect, it } from 'vitest';
import {
  autoSubBands,
  buildDatasets,
  datasetKeyOf,
  inSubBand,
  MAX_SUB_BANDS,
  sanitizeSubBands,
  SUB_BAND_NAME_MAX,
  SUB_BAND_PRESETS,
  subBandName,
  subBandsFor,
} from './subBands';
import type { TaggedPattern } from './metrics';
import { patternFrom, quadBeam } from '../../test/synthetic';

describe('subBandName', () => {
  it('prints a range or a single frequency', () => {
    expect(subBandName(1710, 1880)).toBe('1710–1880 MHz');
    expect(subBandName(3500, 3500)).toBe('3500 MHz');
    expect(subBandName(1749.9, 1784.94)).toBe('1749.9–1784.9 MHz');
  });
});

describe('autoSubBands', () => {
  it('clusters distinct frequencies by gap', () => {
    const b = autoSubBands([1880, 1710, 1733, 1805, 1710, 2110, 2170, 880, 960, 3500]);
    expect(b.map((x) => x.name)).toEqual(['880–960 MHz', '1710–1880 MHz', '2110–2170 MHz', '3500 MHz']);
    expect(b.map((x) => [x.minMHz, x.maxMHz])).toEqual([[880, 960], [1710, 1880], [2110, 2170], [3500, 3500]]);
    expect(autoSubBands([1800, 1900, 2000, 2100.5]).map((x) => x.name)).toEqual(['1800–2000 MHz', '2100.5 MHz']);
    expect(autoSubBands([1800, 1900, 2000], 50)).toHaveLength(3);
  });

  it('ignores invalid frequencies', () => {
    expect(autoSubBands([NaN, 0, -5])).toEqual([]);
    expect(autoSubBands([])).toEqual([]);
  });
});

describe('inSubBand', () => {
  it('has a half-MHz tolerance', () => {
    const b = { name: 'B', minMHz: 1710, maxMHz: 1880 };
    expect(inSubBand(1709.5, b)).toBe(true);
    expect(inSubBand(1709.4, b)).toBe(false);
    expect(inSubBand(1880.5, b)).toBe(true);
    expect(inSubBand(1880.6, b)).toBe(false);
    expect(inSubBand(1800, b)).toBe(true);
  });
});

describe('sanitizeSubBands', () => {
  it('rejects non-arrays', () => {
    expect(sanitizeSubBands('x')).toEqual([]);
  });

  it('cleans entries', () => {
    const raw = [
      { name: '  B3  ', minMHz: 1710, maxMHz: 1880 },
      { minMHz: 2170, maxMHz: 1920 },
      { name: 5, minMHz: 700, maxMHz: 800 },
      { minMHz: 0, maxMHz: 10 },
      { minMHz: 'a', maxMHz: 2 },
      null,
      { name: 'x', minMHz: 1, maxMHz: 200000 },
    ];
    expect(sanitizeSubBands(raw)).toEqual([
      { name: 'B3', minMHz: 1710, maxMHz: 1880 },
      { name: '1920–2170 MHz', minMHz: 1920, maxMHz: 2170 },
      { name: '700–800 MHz', minMHz: 700, maxMHz: 800 },
    ]);
  });

  it('limits count, name length and keys', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ name: `n${i}`, minMHz: 100 + i, maxMHz: 200 + i }));
    expect(sanitizeSubBands(many)).toHaveLength(MAX_SUB_BANDS);
    const long = sanitizeSubBands([{ name: 'a'.repeat(60), minMHz: 1, maxMHz: 2 }]);
    expect(long[0].name).toHaveLength(SUB_BAND_NAME_MAX);
    expect(sanitizeSubBands([{ name: 'k', minMHz: 1, maxMHz: 2, bogus: 1 }])).toEqual([
      { name: 'k', minMHz: 1, maxMHz: 2 },
    ]);
  });
});

describe('SUB_BAND_PRESETS', () => {
  it('is a sorted, well-formed list', () => {
    expect(SUB_BAND_PRESETS).toHaveLength(25);
    for (const p of SUB_BAND_PRESETS) {
      expect(p.minMHz).toBeLessThan(p.maxMHz);
      expect(p.name).toBe(subBandName(p.minMHz, p.maxMHz));
    }
    const sorted = [...SUB_BAND_PRESETS].sort((a, b) => a.minMHz - b.minMHz || a.maxMHz - b.maxMHz);
    expect(SUB_BAND_PRESETS).toEqual(sorted);
    expect(SUB_BAND_PRESETS.some((p) => p.minMHz === 1710 && p.maxMHz === 1880)).toBe(true);
    expect(SUB_BAND_PRESETS.some((p) => p.minMHz === 880 && p.maxMHz === 960)).toBe(true);
    const first = SUB_BAND_PRESETS.slice(0, 12);
    expect(sanitizeSubBands(first)).toEqual(first);
  });
});

const tp = (id: string, tags: TaggedPattern['tags'], extra: Partial<TaggedPattern> = {}, freq = 1800): TaggedPattern => ({
  pattern: patternFrom(quadBeam(65), quadBeam(8, 6), { id, frequencyMHz: freq }),
  tags,
  ...extra,
});

describe('buildDatasets', () => {
  const groups = [{ id: 'g1', name: 'Site A' }];
  const items = [
    tp('a', { array: 'Y1' }),
    tp('b', { array: 'Y1' }),
    tp('c', { array: 'R1' }),
    tp('d', {}),
    tp('e', { array: 'Y1' }, { scope: 'g1' }),
    tp('f', { array: 'Y1' }, { copyOf: 'a' }),
    tp('g', { array: 'Y1' }, {}, 0),
    tp('h', { array: 'R1' }, { scope: 'zz' }),
  ];

  it('groups by custom group and array tag', () => {
    const ds = buildDatasets(items, groups);
    expect(ds.map((d) => d.label)).toEqual(['Site A · Array Y1', 'Array R1', 'Array Y1', 'No array tag']);
    expect(ds.map((d) => d.items.map((i) => i.pattern.id))).toEqual([['e'], ['c', 'h'], ['a', 'b'], ['d']]);
  });

  it('labels a lone dataset "All files" and handles no items', () => {
    const ds = buildDatasets([items[3]], groups);
    expect(ds.map((d) => d.label)).toEqual(['All files']);
    expect(buildDatasets([], groups)).toEqual([]);
  });
});

describe('subBandsFor', () => {
  const items = [tp('a', {}, {}, 1800), tp('b', {}, {}, 1900)];
  it('uses automatic sub-bands unless the user defined some', () => {
    expect(subBandsFor(items, []).map((b) => b.name)).toEqual(['1800–1900 MHz']);
    const user = [{ name: 'X', minMHz: 1, maxMHz: 2 }];
    const r = subBandsFor(items, user);
    expect(r).toEqual(user);
    expect(r).not.toBe(user);
  });
});

describe('datasetKeyOf', () => {
  const groups = [{ id: 'g1', name: 'Site A' }];
  const items = [
    tp('a', { array: 'Y1' }),
    tp('b', { array: 'Y1' }),
    tp('c', { array: 'R1' }),
    tp('e', { array: 'Y1' }, { scope: 'g1' }),
    tp('h', { array: 'R1' }, { scope: 'zz' }),
  ];
  it('is the key of the dataset the file belongs to, equal for every file of one dataset', () => {
    for (const d of buildDatasets(items, groups)) {
      for (const i of d.items) expect(datasetKeyOf(i, groups)).toBe(d.key);
    }
    expect(datasetKeyOf(items[0], groups)).toBe(datasetKeyOf(items[1], groups));
    expect(datasetKeyOf(items[0], groups)).not.toBe(datasetKeyOf(items[2], groups));
  });
  it('is null for a file that is in no dataset', () => {
    expect(datasetKeyOf(tp('f', { array: 'Y1' }, { copyOf: 'a' }), groups)).toBeNull();
    expect(datasetKeyOf(tp('g', { array: 'Y1' }, {}, 0), groups)).toBeNull();
  });
});
