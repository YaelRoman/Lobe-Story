import { SLS_NOT_AVAILABLE_DB } from './sidelobes';
import { fixed } from '../fixed';

/** Distribution statistics of NGMN BASTA V13 Annex C, applied to the values of one antenna in one sub-band. */
export const P_LOWER = 6.7; // double-sided lower threshold (percent)
export const P_UPPER = 93.3; // double-sided upper threshold
export const P_MIN = 16; // single-sided minimum
export const P_MAX = 84; // single-sided maximum
export const EXCURSION_DB = 3; // BASTA 12.2
export const GAIN_REPEATABILITY_DB = 0.8; // BASTA 12.6
export const MIN_SAMPLES = 10; // fewer samples make the percentiles interpolations of the extremes
/**
 * How a mean is taken: of the values ('arithmetic'); of the linear powers of dB values ('power', gain and the dB rows of
 * Annex C); or of the linear powers of levels written as dB *below* a reference ('powerLevel': 10^(−x/10), the power
 * that reaches there, so the mean is the level of the mean power and is not pulled towards the deepest values).
 */
export type MeanKind = 'arithmetic' | 'power' | 'powerLevel';

/** Percentile on the 1-based index `1 + (N − 1)·p/100` of the ascending values, linearly interpolated, index unrounded. */
export function percentile(values: readonly number[], p: number): number {
  const z = [...values].sort((a, b) => a - b);
  const n = z.length;
  if (n === 0) return NaN;
  const pc = Math.min(100, Math.max(0, p));
  const x = 1 + ((n - 1) * pc) / 100;
  const lo = Math.floor(x);
  const f = x - lo;
  if (f === 0 || lo >= n) return z[Math.min(lo, n) - 1];
  return z[lo - 1] + f * (z[lo] - z[lo - 1]);
}

export function arithmeticMean(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/** Mean of the linear powers of dB values, converted back to dB. */
export function powerMeanDb(values: readonly number[]): number {
  return 10 * Math.log10(arithmeticMean(values.map((x) => 10 ** (x / 10))));
}

/** Mean of the linear powers of levels given as dB below a reference, as dB below it again: −10·log10(mean 10^(−x/10)). */
export function powerLevelMeanDb(values: readonly number[]): number {
  return -powerMeanDb(values.map((x) => -x));
}

export function meanOf(values: readonly number[], kind: MeanKind): number {
  return kind === 'power' ? powerMeanDb(values) : kind === 'powerLevel' ? powerLevelMeanDb(values) : arithmeticMean(values);
}

export interface DoubleSided {
  kind: 'double';
  n: number;
  min: number;
  max: number;
  mean: number;
  lower: number;
  upper: number;
  tolerance: number;
}
export interface SingleSided {
  kind: 'max' | 'min';
  n: number;
  min: number;
  max: number;
  percentile: number;
  value: number;
  adjusted: boolean;
}
export interface MeanOnly {
  kind: 'mean';
  n: number;
  min: number;
  max: number;
  mean: number;
}
export type BandStat = DoubleSided | SingleSided | MeanOnly;

const extent = (values: readonly number[]): { min: number; max: number } => {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
};

export function doubleSided(values: readonly number[], mean: MeanKind): DoubleSided | null {
  if (values.length === 0) return null;
  const m = meanOf(values, mean);
  const lower = percentile(values, P_LOWER);
  const upper = percentile(values, P_UPPER);
  return {
    kind: 'double',
    n: values.length,
    ...extent(values),
    mean: m,
    lower,
    upper,
    tolerance: (Math.abs(m - lower) + Math.abs(upper - m)) / 2,
  };
}

export function singleSided(values: readonly number[], side: 'max' | 'min', excursionDb?: number): SingleSided | null {
  if (values.length === 0) return null;
  const { min, max } = extent(values);
  const pct = percentile(values, side === 'max' ? P_MAX : P_MIN);
  let value = pct;
  if (excursionDb !== undefined) {
    if (side === 'min' && min < pct - excursionDb) value = min + excursionDb;
    if (side === 'max' && max > pct + excursionDb) value = max - excursionDb;
  }
  return { kind: side, n: values.length, min, max, percentile: pct, value, adjusted: value !== pct };
}

export function meanOnly(values: readonly number[], mean: MeanKind): MeanOnly | null {
  if (values.length === 0) return null;
  return { kind: 'mean', n: values.length, ...extent(values), mean: meanOf(values, mean) };
}

export type Substituted =
  | { applicable: true; values: number[]; substituted: number }
  | { applicable: false; notAvailable: number; total: number };

/** BASTA 12.5.3: `null` entries are "not available". More than half missing → not applicable; otherwise they count as `substitute`. */
export function substituteNotAvailable(
  values: readonly (number | null)[],
  substitute: number = SLS_NOT_AVAILABLE_DB,
): Substituted {
  const total = values.length;
  const na = values.filter((v) => v === null).length;
  if (na > total / 2) return { applicable: false, notAvailable: na, total };
  return { applicable: true, values: values.map((v) => v ?? substitute), substituted: na };
}

/** One decimal, without the sign of a zero (the shared `fixed`). */
export const fix1 = (v: number): string => fixed(v, 1);

/** A value with its unit (no space before "°"); one decimal unless the row has its own (`decimals`). */
export function withUnit(v: number, unit: string, decimals = 1): string {
  return fixed(v, decimals) + (unit === '°' ? '' : ' ') + unit;
}

export function formatStat(stat: BandStat, unit: string, toleranceUnit: string = unit, decimals = 1, toleranceDecimals = decimals): string {
  switch (stat.kind) {
    case 'double':
      return `${withUnit(stat.mean, unit, decimals)} ± ${withUnit(stat.tolerance, toleranceUnit, toleranceDecimals)}`;
    case 'max':
      return `< ${withUnit(stat.value, unit, decimals)}`;
    case 'min':
      return `> ${withUnit(stat.value, unit, decimals)}`;
    case 'mean':
      return withUnit(stat.mean, unit, decimals);
  }
}
