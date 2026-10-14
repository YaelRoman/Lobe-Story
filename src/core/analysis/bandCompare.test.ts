import { describe, expect, it } from 'vitest';
import { bandDiff, compareSubBands, signedDiff } from './bandCompare';
import { type BandCell, type BandParamKey } from './bandParams';
import { doubleSided, meanOnly, singleSided, EXCURSION_DB } from './bandStats';
import type { TaggedPattern } from './metrics';

const base = { missing: 0, substituted: 0, adjusted: false, title: 't' };
const range = (from: number, step: number, n = 10) => Array.from({ length: n }, (_, i) => from + step * i);

const double = (key: BandParamKey, values: number[], unit: string): BandCell => {
  const stat = doubleSided(values, unit === '°' ? 'arithmetic' : 'power')!;
  return { ...base, key, state: 'ok', n: values.length, stat, values, unit, text: `${stat.mean} ± ${stat.tolerance}` };
};
const single = (key: BandParamKey, side: 'min' | 'max', values: number[], excursion = true): BandCell => {
  const stat = singleSided(values, side, excursion ? EXCURSION_DB : undefined)!;
  return { ...base, key, state: 'ok', n: values.length, stat, values, unit: 'dB', adjusted: stat.adjusted, text: `${stat.value}${stat.adjusted ? '*' : ''}` };
};
const mean = (values: number[], tiltDeg: number, unit = 'dBi'): BandCell => {
  const stat = meanOnly(values, 'power')!;
  return { ...base, key: 'gainMinTilt', state: 'ok', n: values.length, stat, values, unit, tiltDeg, text: `${stat.mean} @ ${tiltDeg}°` };
};
const tilts = (t: number[]): BandCell => ({ ...base, key: 'tiltRange', state: 'ok', n: t.length, stat: null, values: t, unit: '°', text: t.join(' – ') });
const empty = (key: BandParamKey, unit = '°'): BandCell => ({ ...base, key, state: 'empty', n: 0, stat: null, values: [], unit, text: '—' });
const few = (key: BandParamKey, values: number[], unit = '°'): BandCell => ({ ...base, key, state: 'few', n: values.length, stat: null, values, unit, text: 'a … b' });
const notApplicable = (key: BandParamKey): BandCell => ({ ...base, key, state: 'notApplicable', n: 12, stat: null, values: [], unit: 'dB', text: 'n/a' });

describe('signedDiff', () => {
  it('writes one decimal with a sign, and no sign on a difference that is zero', () => {
    expect(signedDiff(1.24, '°')).toBe('+1.2°');
    expect(signedDiff(-0.96, 'dB')).toBe('-1.0 dB');
    expect(signedDiff(0, 'dB')).toBe('0.0 dB');
  });
  it('gives a small difference that is not zero the decimals that show it, so two different values never read as equal', () => {
    expect(signedDiff(0.04, '°')).toBe('+0.04°');
    expect(signedDiff(-0.004, 'dB')).toBe('-0.004 dB');
    expect(signedDiff(1e-12, 'dB')).toBe('0.0 dB');
  });
});

describe('bandDiff: double-sided cells', () => {
  const a = double('hHpbw', range(60, 1), '°');
  const b = double('hHpbw', range(62, 0.5), '°');
  it('is the difference of the means and of the tolerances, in the unit of the row', () => {
    const d = bandDiff(a, b);
    expect(d.state).toBe('ok');
    const dm = b.stat!.kind === 'double' && a.stat!.kind === 'double' ? b.stat!.mean - a.stat!.mean : NaN;
    const dt = b.stat!.kind === 'double' && a.stat!.kind === 'double' ? b.stat!.tolerance - a.stat!.tolerance : NaN;
    expect(d.text).toBe(`${signedDiff(dm, '°')} (tol ${signedDiff(dt, '°')})`);
    expect(d.numbers.value).toBeCloseTo(dm, 12);
    expect(d.numbers.mean).toBeCloseTo(dm, 12);
    expect(d.numbers.tolerance).toBeCloseTo(dt, 12);
    expect(d.numbers.lower).toBeDefined();
    expect(d.numbers.upper).toBeDefined();
    expect(d.numbers.min).toBe(62 - 60);
    expect(d.numbers.max).toBeCloseTo(66.5 - 69, 12);
    expect(d.muted).toBe(false);
    expect(d.title).toContain('B − A of the mean');
    expect(d.title).not.toMatch(/better|worse/i);
  });
  it('writes a gain difference in dB, whatever the gain unit of the cells', () => {
    const d = bandDiff(double('gainAll', range(17, 0.1), 'dBi'), double('gainAll', range(17.5, 0.1), 'dBi'));
    expect(d.unit).toBe('dB');
    expect(d.text).toMatch(/^\+0\.5 dB \(tol (0\.0|[+-]0\.0\d+) dB\)$/);
  });
});

describe('bandDiff: single-sided limits', () => {
  it('is the difference of the limits as shown, the adjusted ones where the excursion rule changed them', () => {
    const a = single('fbWindow', 'min', range(20, 1));
    const b = single('fbWindow', 'min', range(22, 1));
    const d = bandDiff(a, b);
    expect(d.text).toBe('+2.0 dB');
    expect(d.numbers.value).toBeCloseTo(2, 12);
    expect(d.numbers.percentile).toBeCloseTo(2, 12);
    expect(d.adjusted).toBe(false);
  });
  it('carries the * of an input changed by the excursion rule, and says which', () => {
    const a = single('fbWindow', 'min', [10, ...range(20, 1, 11)]);
    expect(a.adjusted).toBe(true);
    const d = bandDiff(a, single('fbWindow', 'min', range(22, 1)));
    expect(d.text.endsWith('*')).toBe(true);
    expect(d.adjusted).toBe(true);
    expect(d.title).toContain('A is adjusted by the 3 dB excursion rule');
    // Value is of the adjusted limits, Percentile of the plain percentiles.
    const sa = a.stat!.kind === 'min' ? a.stat! : null;
    expect(d.numbers.value).toBeCloseTo(singleSided(range(22, 1), 'min')!.value - sa!.value, 12);
    expect(d.numbers.percentile).toBeCloseTo(singleSided(range(22, 1), 'min')!.percentile - sa!.percentile, 12);
  });
  it('treats a maximum the same way', () => {
    const d = bandDiff(single('nullFill', 'max', range(20, 1), false), single('nullFill', 'max', range(19, 1), false));
    expect(d.text).toBe('-1.0 dB');
  });
});

describe('bandDiff: mean gain at a tilt', () => {
  it('is the difference of the means, and names the tilts when the two antennas differ there', () => {
    expect(bandDiff(mean([17, 17], 2), mean([17.4, 17.4], 2)).text).toBe('+0.4 dB');
    const d = bandDiff(mean([17, 17], 0), mean([17.4, 17.4], 2));
    expect(d.text).toBe('+0.4 dB (A @ 0°, B @ 2°)');
    expect(d.title).toContain('not at the same nominal tilt');
  });
  it('needs one value on each side, as the mean itself', () => {
    expect(bandDiff(mean([17], 2), mean([18], 2)).state).toBe('ok');
  });
});

describe('bandDiff: the electrical tilt range', () => {
  it('is the difference of the lowest and of the highest nominal tilt', () => {
    const d = bandDiff(tilts([0, 5, 10]), tilts([2, 12]));
    expect(d.text).toBe('lowest +2°, highest +2°');
    expect(d.numbers.min).toBe(2);
    expect(d.numbers.max).toBe(2);
    expect(d.numbers.value).toBeUndefined();
  });
  it('is one number when both antennas have one tilt', () => {
    expect(bandDiff(tilts([8]), tilts([6])).text).toBe('-2°');
    expect(bandDiff(tilts([8]), tilts([8])).text).toBe('0°');
    expect(bandDiff(tilts([0.25]), tilts([0.3])).text).toBe('+0.05°');
  });
});

describe('bandDiff: no difference where an input has no statistic', () => {
  it('is a muted dash with the reason of each side', () => {
    const ok = double('hHpbw', range(60, 1), '°');
    const cases: [BandCell, BandCell, RegExp][] = [
      [empty('hHpbw'), ok, /A has no values in this sub-band/],
      [ok, empty('hHpbw'), /B has no values in this sub-band/],
      [few('hHpbw', [60, 61, 62]), ok, /A has only 3 values \(fewer than 10\)/],
      [ok, notApplicable('hHpbw'), /B is n\/a/],
    ];
    for (const [a, b, why] of cases) {
      const d = bandDiff(a, b);
      expect(d.state).toBe('none');
      expect(d.text).toBe('—');
      expect(d.muted).toBe(true);
      expect(d.title).toMatch(why);
      expect(d.numbers).toEqual({});
    }
    const both = bandDiff(empty('hHpbw'), few('hHpbw', [1, 2]));
    expect(both.title).toMatch(/A has no values/);
    expect(both.title).toMatch(/B has only 2 values/);
  });
  it('never takes the range of a cell with too few values as a statistic', () => {
    expect(bandDiff(few('hHpbw', [60, 61]), few('hHpbw', [62, 63])).state).toBe('none');
  });
  it('uses the names of the antennas in the reasons when given', () => {
    expect(bandDiff(empty('hHpbw'), empty('hHpbw'), { a: 'Array Y2', b: 'Array Y3' }).title).toContain('A (Array Y2) has no values');
  });
});

describe('bandDiff: 22 dB substitutes', () => {
  it('marks and mutes a difference with an input that counts "not available" values as 22 dB', () => {
    const a = { ...single('usls', 'min', range(18, 1)), substituted: 3 };
    const d = bandDiff(a, single('usls', 'min', range(19, 1)));
    expect(d.state).toBe('ok');
    expect(d.substituted).toBe(true);
    expect(d.muted).toBe(true);
    expect(d.text).toBe('+1.0 dB†');
    expect(d.title).toContain('A counts 3 "not available" values as 22 dB');
  });
  it('puts † after * when both apply', () => {
    const a = { ...single('usls', 'min', [5, ...range(20, 1, 11)]), substituted: 1 };
    expect(bandDiff(a, single('usls', 'min', range(19, 1))).text).toMatch(/\*†$/);
  });
});

describe('compareSubBands', () => {
  const item = (f: number) => ({ pattern: { frequencyMHz: f } }) as TaggedPattern;
  it('takes the user sub-bands when there are any', () => {
    const user = [{ name: 'U', minMHz: 1700, maxMHz: 1900 }];
    expect(compareSubBands([item(1800)], [item(2600)], user)).toEqual(user);
  });
  it('makes automatic sub-bands over the frequencies of both antennas, so the columns line up', () => {
    expect(compareSubBands([item(1800), item(1850)], [item(1900), item(2600)], []).map((b) => b.name)).toEqual(['1800–1900 MHz', '2600 MHz']);
  });
});
