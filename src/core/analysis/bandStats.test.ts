import { describe, expect, it } from 'vitest';
import {
  arithmeticMean,
  doubleSided,
  EXCURSION_DB,
  fix1,
  formatStat,
  GAIN_REPEATABILITY_DB,
  meanOnly,
  MIN_SAMPLES,
  P_LOWER,
  P_MAX,
  P_MIN,
  P_UPPER,
  percentile,
  powerMeanDb,
  singleSided,
  substituteNotAvailable,
  withUnit,
} from './bandStats';
import {
  BASTA_AZ_HPBW,
  BASTA_GAIN_ALL_TILTS,
  BASTA_GAIN_TILT0,
  BASTA_P2P_TRACKING,
  BASTA_USLS_PEAK20,
} from '../../test/bastaVectors';

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const range = (a: number, b: number, step = 1) => {
  const out: number[] = [];
  for (let x = a; x <= b + 1e-9; x += step) out.push(x);
  return out;
};

describe('BASTA vector transcription', () => {
  it('has the expected lengths and sums', () => {
    expect(BASTA_AZ_HPBW).toHaveLength(126);
    expect(BASTA_P2P_TRACKING).toHaveLength(162);
    expect(BASTA_USLS_PEAK20).toHaveLength(126);
    expect(BASTA_GAIN_ALL_TILTS).toHaveLength(198);
    expect(BASTA_GAIN_TILT0).toHaveLength(18);
    expect(sum(BASTA_AZ_HPBW)).toBeCloseTo(8206.4, 6);
    expect(sum(BASTA_P2P_TRACKING)).toBeCloseTo(205.0, 6);
    expect(sum(BASTA_USLS_PEAK20)).toBeCloseTo(2117.1, 6);
    expect(sum(BASTA_GAIN_ALL_TILTS)).toBeCloseTo(3457.1, 6);
  });
});

describe('percentile', () => {
  it('interpolates on the 1-based index', () => {
    const v = [1, 2, 3, 4, 5];
    expect(percentile(v, 50)).toBeCloseTo(3, 6);
    expect(percentile(v, 16)).toBeCloseTo(1.64, 6);
    expect(percentile(v, 84)).toBeCloseTo(4.36, 6);
    expect(percentile([10, 20], 6.7)).toBeCloseTo(10.67, 6);
    expect(percentile([10, 20], 93.3)).toBeCloseTo(19.33, 6);
    expect(percentile([7], 84)).toBeCloseTo(7, 6);
    expect(percentile([3, 1, 2], 0)).toBeCloseTo(1, 6);
    expect(percentile([3, 1, 2], 100)).toBeCloseTo(3, 6);
    const eleven = range(0, 100, 10);
    expect(percentile(eleven, 16)).toBeCloseTo(16, 6);
    expect(percentile(eleven, 6.7)).toBeCloseTo(6.7, 6);
    const ten = range(1, 10);
    expect(percentile(ten, 16)).toBeCloseTo(2.44, 6);
    expect(percentile(ten, 84)).toBeCloseTo(8.56, 6);
    expect(percentile(ten, 6.7)).toBeCloseTo(1.603, 6);
    expect(percentile(ten, 93.3)).toBeCloseTo(9.397, 6);
  });

  it('handles empty input, order, mutation and clamping', () => {
    expect(percentile([], 50)).toBeNaN();
    const v = [3, 1, 2];
    percentile(v, 50);
    expect(v).toEqual([3, 1, 2]);
    expect(percentile([3, 1, 2], 150)).toBe(percentile([3, 1, 2], 100));
  });
});

describe('means', () => {
  it('computes arithmetic and power means', () => {
    expect(arithmeticMean([10, 20])).toBeCloseTo(15, 6);
    expect(powerMeanDb([10, 20])).toBeCloseTo(17.403627, 6);
    expect(powerMeanDb([17, 17, 17])).toBeCloseTo(17, 6);
    expect(powerMeanDb([0, 3])).toBeCloseTo(1.754049, 6);
    expect(arithmeticMean([])).toBeNaN();
    expect(powerMeanDb([])).toBeNaN();
  });
});

describe('BASTA Annex C worked examples', () => {
  it('azimuth HPBW', () => {
    const s = doubleSided(BASTA_AZ_HPBW, 'arithmetic')!;
    expect(s.n).toBe(126);
    expect(s.min).toBeCloseTo(58.8, 6);
    expect(s.max).toBeCloseTo(70.8, 6);
    expect(s.mean).toBeCloseTo(65.130159, 6);
    expect(s.lower).toBeCloseTo(61.3625, 6);
    expect(s.upper).toBeCloseTo(69.4, 6);
    expect(s.tolerance).toBeCloseTo(4.01875, 6);
    expect(formatStat(s, '°')).toBe('65.1° ± 4.0°');
  });

  it('port-to-port tracking', () => {
    const s = singleSided(BASTA_P2P_TRACKING, 'max', 3)!;
    expect(s.n).toBe(162);
    expect(s.min).toBeCloseTo(0, 6);
    expect(s.max).toBeCloseTo(3.6, 6);
    expect(s.percentile).toBeCloseTo(2.724, 6);
    expect(s.value).toBeCloseTo(2.724, 6);
    expect(s.adjusted).toBe(false);
    expect(formatStat(s, 'dB')).toBe('< 2.7 dB');
  });

  it('upper sidelobe suppression', () => {
    const s = singleSided(BASTA_USLS_PEAK20, 'min', 3)!;
    expect(s.n).toBe(126);
    expect(s.min).toBeCloseTo(14.9, 6);
    expect(s.max).toBeCloseTo(19.8, 6);
    expect(s.percentile).toBeCloseTo(15.8, 6);
    expect(s.value).toBeCloseTo(15.8, 6);
    expect(s.adjusted).toBe(false);
    expect(formatStat(s, 'dB')).toBe('> 15.8 dB');
  });

  it('gain over all tilts', () => {
    const s = doubleSided(BASTA_GAIN_ALL_TILTS, 'power')!;
    expect(s.n).toBe(198);
    expect(s.min).toBeCloseTo(16.9, 6);
    expect(s.max).toBeCloseTo(17.9, 6);
    expect(s.mean).toBeCloseTo(17.465237, 6);
    expect(s.lower).toBeCloseTo(17.1, 6);
    expect(s.upper).toBeCloseTo(17.8, 6);
    expect(s.tolerance).toBeCloseTo(0.35, 6);
    expect(formatStat(s, 'dBi', 'dB')).toMatch(/^17\.5 dBi ± 0\.[34] dB$/);
    expect(doubleSided(BASTA_GAIN_ALL_TILTS, 'arithmetic')!.mean).toBeCloseTo(17.460101, 6);
  });

  it('gain at one tilt', () => {
    const s = meanOnly(BASTA_GAIN_TILT0, 'power')!;
    expect(s.n).toBe(18);
    expect(s.min).toBeCloseTo(16.85, 6);
    expect(s.max).toBeCloseTo(17.44, 6);
    expect(formatStat(s, 'dBi')).toBe('17.1 dBi');
    expect(withUnit(s.mean - GAIN_REPEATABILITY_DB, 'dBi')).toBe('16.3 dBi');
  });
});

describe('small distributions', () => {
  it('double-sided', () => {
    const a = doubleSided(range(60, 80, 2), 'arithmetic')!;
    expect(a.mean).toBeCloseTo(70, 6);
    expect(a.lower).toBeCloseTo(61.34, 6);
    expect(a.upper).toBeCloseTo(78.66, 6);
    expect(a.tolerance).toBeCloseTo(8.66, 6);
    const p = doubleSided([7, 8, 9, 10, 11, 7.5, 8.5, 9.5, 10.5, 8, 9], 'power')!;
    expect(p.mean).toBeCloseTo(9.077162, 6);
    expect(p.lower).toBeCloseTo(7.335, 6);
    expect(p.upper).toBeCloseTo(10.665, 6);
    expect(p.tolerance).toBeCloseTo(1.665, 6);
  });

  it('applies the 3 dB excursion rule', () => {
    const v = [10, 15, 15.5, 16, 16, 16.5, 17, 17, 17.5, 18, 18, 18.5];
    const a = singleSided(v, 'min', 3)!;
    expect(a.percentile).toBeCloseTo(15.38, 6);
    expect(a.value).toBeCloseTo(13, 6);
    expect(a.adjusted).toBe(true);
    const b = singleSided(v, 'min')!;
    expect(b.value).toBeCloseTo(15.38, 6);
    expect(b.adjusted).toBe(false);
    const w = [0.1, 0.2, 0.2, 0.3, 0.3, 0.4, 0.4, 0.5, 0.5, 0.6, 0.6, 6];
    const c = singleSided(w, 'max', 3)!;
    expect(c.percentile).toBeCloseTo(0.6, 6);
    expect(c.value).toBeCloseTo(3, 6);
    expect(c.adjusted).toBe(true);
  });

  it('returns null for empty input', () => {
    expect(doubleSided([], 'arithmetic')).toBeNull();
    expect(singleSided([], 'max')).toBeNull();
    expect(meanOnly([], 'power')).toBeNull();
  });
});

describe('substituteNotAvailable', () => {
  it('substitutes when at most half are missing', () => {
    const r = substituteNotAvailable([15, 16, 17, 18, 19, 20, ...Array(6).fill(null)]);
    expect(r.applicable).toBe(true);
    if (!r.applicable) return;
    expect(r.substituted).toBe(6);
    expect(r.values.slice(-6)).toEqual([22, 22, 22, 22, 22, 22]);
    expect(singleSided(r.values, 'min', 3)!.value).toBeCloseTo(16.76, 6);
  });

  it('is not applicable when more than half are missing', () => {
    expect(substituteNotAvailable([15, 16, 17, 18, 19, ...Array(7).fill(null)])).toEqual({
      applicable: false,
      notAvailable: 7,
      total: 12,
    });
  });

  it('handles empty input and a custom substitute', () => {
    expect(substituteNotAvailable([])).toEqual({ applicable: true, values: [], substituted: 0 });
    const r = substituteNotAvailable([null, 1, 2], 30);
    expect(r.applicable && r.values).toEqual([30, 1, 2]);
  });
});

describe('formatting and constants', () => {
  it('formats numbers', () => {
    expect(fix1(-0.04)).toBe('0.0');
    expect(withUnit(65.13, '°')).toBe('65.1°');
    expect(withUnit(2.724, 'dB')).toBe('2.7 dB');
  });

  it('exports the thresholds', () => {
    expect([P_LOWER, P_UPPER, P_MIN, P_MAX, EXCURSION_DB, GAIN_REPEATABILITY_DB, MIN_SAMPLES]).toEqual([
      6.7, 93.3, 16, 84, 3, 0.8, 10,
    ]);
  });
});
