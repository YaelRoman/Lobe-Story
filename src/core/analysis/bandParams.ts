import type { GainUnit, MetricResult } from '../types';
import { convertGain } from '../gain';
import {
  doubleSided,
  EXCURSION_DB,
  formatStat,
  GAIN_REPEATABILITY_DB,
  meanOnly,
  MIN_SAMPLES,
  singleSided,
  substituteNotAvailable,
  withUnit,
  type BandStat,
  type MeanKind,
} from './bandStats';
import type { AnalysisSettings, PatternMetrics, TaggedPattern } from './metrics';
import { inSubBand, type SubBand } from './subBands';
import { fixed, settingText } from '../fixed';
import type { Method3d } from './pattern3d';

/** The rows of BASTA Annex C: always in the table. */
export type AnnexParamKey =
  | 'gainAll' | 'gainMinTilt' | 'gainMidTilt' | 'gainMaxTilt' | 'tiltRange'
  | 'hHpbw' | 'vHpbw' | 'squint' | 'tiltDeviation' | 'fbWindow'
  | 'firstUsls' | 'usls' | 'uslsHorizon' | 'uslsMax' | 'nullFill' | 'firstLsls' | 'hSls'
  | 'tracking' | 'rollOff' | 'air';
/**
 * The rows that are there only while the metrics table has their values: the Horizon level (horizontal cut at the
 * horizon) and the angular-region estimate (its column group shown). See `bandRows`.
 */
export type ExtraParamKey = 'horizonLevel' | 'areSector' | 'areSpatial' | 'areLower';
export type BandParamKey = AnnexParamKey | ExtraParamKey;
export type ValidationType = 'double' | 'max' | 'min' | 'mean' | 'absolute';

export interface BandParam {
  key: BandParamKey;
  label: string;
  unit: '°' | 'dB' | '%' | 'gain';
  type: ValidationType;
  /** Decimals of the cell (and of the CSV numbers), where one (two) would read 0 on almost every value; see `areLower`. */
  decimals?: { shown: number; csv: number };
  mean?: MeanKind;
  /** The 3 dB excursion rule applies (not to null fill: a pure 84th percentile). */
  excursion?: true;
  /** "Not available" values take part in the 22 dB rule. */
  substitute?: true;
  basta: string;
  description: string;
}

/** A row of the Annex C list (its cell is in every band column). */
export type AnnexParam = BandParam & { key: AnnexParamKey };

export const BAND_PARAMS: AnnexParam[] = [
  { key: 'gainAll', label: 'Gain, all tilts', unit: 'gain', type: 'double', mean: 'power', basta: '7.2.10, 12.6.2', description: 'Declared gain of every file in the sub-band, all tilts and ports' },
  { key: 'gainMinTilt', label: 'Gain, lowest tilt', unit: 'gain', type: 'mean', mean: 'power', basta: '12.6.1', description: 'Declared gain at the lowest nominal tilt' },
  { key: 'gainMidTilt', label: 'Gain, middle tilt', unit: 'gain', type: 'mean', mean: 'power', basta: '12.6.1', description: 'Declared gain at the middle nominal tilt' },
  { key: 'gainMaxTilt', label: 'Gain, highest tilt', unit: 'gain', type: 'mean', mean: 'power', basta: '12.6.1', description: 'Declared gain at the highest nominal tilt' },
  { key: 'tiltRange', label: 'Electrical tilt range', unit: '°', type: 'absolute', basta: '7.2.7', description: 'Lowest and highest nominal electrical tilt' },
  { key: 'hHpbw', label: 'Azimuth beamwidth', unit: '°', type: 'double', mean: 'arithmetic', basta: '7.2.5.1', description: 'Azimuth beamwidth of the co-polar cut' },
  { key: 'vHpbw', label: 'Elevation beamwidth', unit: '°', type: 'double', mean: 'arithmetic', basta: '7.2.8.1', description: 'Elevation beamwidth of the co-polar cut' },
  { key: 'squint', label: 'Azimuth beam squint', unit: '°', type: 'double', mean: 'arithmetic', basta: '7.8.1.5', description: 'Beamwidth bisector relative to boresight, signed' },
  { key: 'tiltDeviation', label: 'Downtilt deviation', unit: '°', type: 'max', basta: '7.2.8.2, 12.7', description: 'Absolute difference between the beam peak direction and the nominal tilt' },
  { key: 'fbWindow', label: 'F/B ±30°', unit: 'dB', type: 'min', excursion: true, basta: '7.2.9.1', description: 'Co-polar front-to-back ratio in the rear window' },
  { key: 'firstUsls', label: 'First USLS', unit: 'dB', type: 'min', excursion: true, basta: '7.8.4.2', description: 'First upper sidelobe suppression' },
  { key: 'usls', label: 'USLS peak to 20°', unit: 'dB', type: 'min', excursion: true, substitute: true, basta: '7.8.4.3', description: 'Upper sidelobe suppression, beam peak to R° above it' },
  { key: 'uslsHorizon', label: 'USLS horizon to 20°', unit: 'dB', type: 'min', excursion: true, substitute: true, basta: '7.8.4.5', description: 'Upper sidelobe suppression, horizon to R° above it' },
  { key: 'uslsMax', label: 'USLS max', unit: 'dB', type: 'min', excursion: true, substitute: true, basta: '7.8.4.4', description: 'Maximum upper sidelobe suppression, beam peak to zenith' },
  { key: 'nullFill', label: 'Null fill', unit: 'dB', type: 'max', basta: '7.8.3', description: 'Depth of the first null below the main beam' },
  { key: 'firstLsls', label: 'First LSLS', unit: 'dB', type: 'min', excursion: true, basta: '7.2.11', description: 'First lower sidelobe suppression' },
  { key: 'hSls', label: 'H-SLS', unit: 'dB', type: 'min', excursion: true, basta: '7.8.4.1', description: 'Maximum horizontal sidelobe suppression inside the sector' },
  { key: 'tracking', label: 'P2P tracking (sector edges)', unit: 'dB', type: 'max', excursion: true, basta: '7.8.5, 12.4.5', description: 'Level difference between the +45 and −45 ports at the two sector edges, one pair of values per port pair' },
  { key: 'rollOff', label: 'Roll-off (both edges)', unit: 'dB', type: 'double', mean: 'power', basta: '7.8.1.4', description: 'Level below the peak at each sector edge, both edges of every file' },
  { key: 'air', label: 'AIR', unit: 'dB', type: 'double', mean: 'power', basta: '7.8.1.6', description: 'Azimuth interference ratio, co-polar only' },
];

/** The Horizon level: one value per file, of its horizon cut only (a file cut has none). After the azimuth beamwidth, as in the metrics table. */
export const HORIZON_LEVEL_PARAM: BandParam = {
  key: 'horizonLevel', label: 'Horizon level', unit: 'dB', type: 'double', mean: 'powerLevel', basta: '',
  description: 'How far the strongest point of the horizon cut is below the 3D peak, one value per file (not a BASTA parameter); the mean is that of the linear power at the horizon, written again as dB below the peak',
};

/**
 * The angular-region estimate (after BASTA 7.2.4): percentages, so the mean is arithmetic (BASTA 12.4.2 for %) and the
 * difference of two antennas is in percentage points. Not BASTA-compliant: estimated from the two co-polar cuts.
 */
export const ANGULAR_REGION_PARAMS: readonly BandParam[] = [
  { key: 'areSector', label: 'Sector efficiency est.', unit: '%', type: 'double', mean: 'arithmetic', basta: '7.2.4, estimate', description: 'Power in the service region as a share of the power over the whole sphere, estimated from the two co-polar cuts; arithmetic mean (a percentage)' },
  { key: 'areSpatial', label: 'Spatial efficiency est.', unit: '%', type: 'double', mean: 'arithmetic', basta: '7.2.4, estimate', description: 'Power in the service region as a share of the power in the service and interference regions, estimated from the two co-polar cuts; arithmetic mean (a percentage)' },
  { key: 'areLower', label: 'Lower region ratio est.', unit: '%', type: 'double', mean: 'arithmetic', decimals: { shown: 3, csv: 4 }, basta: '7.2.4, estimate', description: 'Power from 75° below the horizon to straight down as a share of the power over the whole sphere, estimated from the two co-polar cuts; arithmetic mean (a percentage)' },
];

/** Every row a band table can have, in no particular order (see `bandRows` for the order shown). */
export const ALL_BAND_PARAMS: readonly BandParam[] = [...BAND_PARAMS, HORIZON_LEVEL_PARAM, ...ANGULAR_REGION_PARAMS];

/** What the metrics table has beyond the Annex C rows, and so the band statistics too. */
export interface BandRowOptions {
  /** The angular-region columns are shown (their values are computed). */
  angularRegions: boolean;
  /** The simulated horizontal cut is the one at the horizon (every file has a Horizon level). */
  horizonLevel: boolean;
}

/** The rows of the band table: the Annex C list, the Horizon level after the azimuth beamwidth, the angular regions last. */
export function bandRows(o: BandRowOptions): readonly BandParam[] {
  if (!o.angularRegions && !o.horizonLevel) return BAND_PARAMS;
  const rows = BAND_PARAMS.flatMap((p) => (o.horizonLevel && p.key === 'hHpbw' ? [p, HORIZON_LEVEL_PARAM] : [p]));
  return o.angularRegions ? [...rows, ...ANGULAR_REGION_PARAMS] : rows;
}

const ANGULAR_REGION_KEYS: ReadonlySet<BandParamKey> = new Set(ANGULAR_REGION_PARAMS.map((p) => p.key));
export const isAngularRegion = (key: BandParamKey): boolean => ANGULAR_REGION_KEYS.has(key);

/** A row whose only value is of the simulated horizontal cut (the Horizon level): its cell shows that value alone, not `original → simulated`. */
export const simulatedOnly = (key: BandParamKey): boolean => key === 'horizonLevel';

const METHOD_NAME: Record<Method3d, string> = { summation: 'Summation', weighted: 'Weighted' };

export const VALIDATION_LABEL: Record<ValidationType, string> = {
  double: 'double-sided: mean ± tolerance',
  max: 'single-sided maximum: 84th percentile',
  min: 'single-sided minimum: 16th percentile',
  mean: 'mean',
  absolute: 'nominal range',
};

export interface BandContext {
  gainUnit: GainUnit;
  settings: AnalysisSettings;
}

/** The label of a row; an angular-region row names its 3D method (it changes the estimate by several points), as the table's exports do. */
export function bandParamLabel(p: BandParam, settings: AnalysisSettings, method?: Method3d): string {
  if (isAngularRegion(p.key) && method) return `${p.label} [${METHOD_NAME[method]}]`;
  if (p.key === 'fbWindow') return `F/B ±${settingText(settings.fbWindowDeg)}°`;
  if (p.key === 'usls') return `USLS peak to ${settingText(settings.uslsRangeDeg)}°`;
  if (p.key === 'uslsHorizon') return `USLS horizon to ${settingText(settings.uslsRangeDeg)}°`;
  return p.label;
}

export function bandParamTitle(p: BandParam, settings: AnalysisSettings, method?: Method3d): string {
  const description = p.description.replace('R°', `${settingText(settings.uslsRangeDeg)}°`);
  const how = isAngularRegion(p.key)
    ? ` (3D method: ${method ? METHOD_NAME[method] : 'as chosen in the Simulation bar'}); not BASTA-compliant, Type A (macro) beams only`
    : '';
  return `${description}${how}${p.basta ? ` (BASTA ${p.basta})` : ''} — ${VALIDATION_LABEL[p.type]}`;
}

/** Lowest, middle and highest distinct nominal tilt; the middle one is nearest the midpoint (ties: the lower). */
export function gainTilts(items: readonly TaggedPattern[]): { min: number; mid: number; max: number } | null {
  const tilts = nominalTilts(items);
  if (tilts.length === 0) return null;
  const min = tilts[0];
  const max = tilts[tilts.length - 1];
  const centre = (min + max) / 2;
  let mid = min;
  for (const t of tilts) if (Math.abs(t - centre) < Math.abs(mid - centre)) mid = t;
  return { min, mid, max };
}

function nominalTilts(items: readonly TaggedPattern[]): number[] {
  const set = new Set<number>();
  for (const i of items) if (i.tags.tiltDeg !== undefined && Number.isFinite(i.tags.tiltDeg)) set.add(i.tags.tiltDeg);
  return [...set].sort((a, b) => a - b);
}

export interface Samples {
  /** `null` = BASTA "not available". */
  values: (number | null)[];
  missing: number;
  tiltDeg?: number;
}

type PlainKey = 'hHpbw' | 'vHpbw' | 'squint' | 'fbWindow' | 'firstUsls' | 'usls' | 'uslsHorizon' | 'uslsMax' | 'nullFill' | 'firstLsls' | 'hSls' | 'air' | 'areSector' | 'areSpatial' | 'areLower';
type NotAvailableResult = MetricResult & { notAvailable?: true };

const PLAIN: Record<PlainKey, (m: PatternMetrics) => NotAvailableResult> = {
  hHpbw: (m) => m.h.hpbw,
  vHpbw: (m) => m.v.hpbw,
  squint: (m) => m.squint,
  fbWindow: (m) => m.fbWindow,
  firstUsls: (m) => m.firstUsls,
  usls: (m) => m.usls,
  uslsHorizon: (m) => m.uslsHorizon,
  uslsMax: (m) => m.uslsMax,
  nullFill: (m) => m.nullFill,
  firstLsls: (m) => m.firstLsls,
  hSls: (m) => m.hSls,
  air: (m) => m.air,
  // The values the metrics table shows: computed there, read here (the estimate is not worked out again).
  areSector: (m) => m.are.sector,
  areSpatial: (m) => m.are.spatial,
  areLower: (m) => m.are.lower,
};

const GAIN_TILT: Partial<Record<BandParamKey, 'min' | 'mid' | 'max'>> = {
  gainMinTilt: 'min',
  gainMidTilt: 'mid',
  gainMaxTilt: 'max',
};

export function collectSamples(
  key: BandParamKey,
  items: readonly TaggedPattern[],
  metrics: Map<string, PatternMetrics>,
  gainUnit: GainUnit,
): Samples {
  const values: (number | null)[] = [];
  let missing = 0;
  const spec = ALL_BAND_PARAMS.find((p) => p.key === key)!;

  if (key === 'tiltRange') {
    return { values: nominalTilts(items), missing: items.filter((i) => !Number.isFinite(i.tags.tiltDeg)).length };
  }

  const tiltPick = GAIN_TILT[key];
  if (tiltPick) {
    const t = gainTilts(items);
    if (!t) return { values, missing: items.length };
    const tiltDeg = t[tiltPick];
    for (const i of items) {
      if (i.tags.tiltDeg !== tiltDeg) continue;
      const g = convertGain(i.pattern.gain, gainUnit);
      if (g === null) missing++;
      else values.push(g);
    }
    return { values, missing, tiltDeg };
  }

  const seenPairs = new Set<string>();
  const itemIds = new Set(items.map((i) => i.pattern.id));
  for (const item of items) {
    const id = item.pattern.id;
    const m = metrics.get(id);
    if (key === 'gainAll') {
      const g = convertGain(item.pattern.gain, gainUnit);
      if (g === null) missing++;
      else values.push(g);
      continue;
    }
    if (!m) {
      missing++;
      continue;
    }
    if (key === 'horizonLevel') {
      // Only a horizon cut has one (the table's Horizon level column); a file cut gives no sample.
      if (m.hCutPeakDb === undefined) missing++;
      else values.push(m.hCutPeakDb);
    } else if (key === 'tiltDeviation') {
      // Beam peak (BASTA 7.2.8.2, 12.7) against the same nominal tilt the per-file tilt error uses.
      if (m.vPeak.value === null || m.nominalTiltDeg === undefined) missing++;
      else values.push(Math.abs(m.vPeak.value - m.nominalTiltDeg));
    } else if (key === 'rollOff') {
      if (m.rollOff.value === null) missing++;
      else values.push(...m.rollOffEdges);
    } else if (key === 'tracking') {
      const partnerId = m.trackingEdges?.partnerId;
      // Both files must be in this dataset and name each other; anything else has no pair to count.
      const mutual =
        partnerId !== undefined &&
        partnerId !== id &&
        itemIds.has(partnerId) &&
        metrics.get(partnerId)?.trackingEdges?.partnerId === id;
      if (m.beamTracking.value === null || !m.trackingEdges || !mutual) {
        missing++;
        continue;
      }
      const pair = [id, m.trackingEdges.partnerId].sort().join('\u0000');
      if (seenPairs.has(pair)) continue;
      seenPairs.add(pair);
      values.push(...m.trackingEdges.values);
    } else {
      const r = PLAIN[key as PlainKey](m);
      if (r.value !== null) values.push(r.value);
      else if (r.notAvailable === true && spec.substitute) values.push(null);
      else missing++;
    }
  }
  return { values, missing };
}

export type CellState = 'ok' | 'few' | 'empty' | 'notApplicable';
export interface BandCell {
  key: BandParamKey;
  state: CellState;
  /** Samples used ('notApplicable': all samples, numeric or not). */
  n: number;
  /** Files (pairs for tracking: files) that gave no sample. */
  missing: number;
  /** Samples counted as 22 dB. */
  substituted: number;
  /** The 3 dB excursion rule changed the value; the text carries a trailing `*`. */
  adjusted: boolean;
  /** Null unless the state is 'ok' (always null for tiltRange). */
  stat: BandStat | null;
  /** The numbers behind the cell, after substitution; empty when the cell is empty or not applicable. */
  values: number[];
  unit: string;
  /** Decimals of the text when not one: the row's own (`BandParam.decimals`). */
  decimals?: number;
  tiltDeg?: number;
  text: string;
  title: string;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const substitutedNote = (k: number, n: number): string => `${k} of ${n} values were "not available" and count as 22 dB (BASTA 12.5.3)`;
export const tiltText = (t: number): string => String(Math.round(t * 10) / 10);

/** The range of a cell with fewer than `MIN_SAMPLES` values: one value where the two ends read the same. */
const rangeText = (min: number, max: number, unit: string, decimals: number): string =>
  fixed(min, decimals) === fixed(max, decimals) ? withUnit(min, unit, decimals) : `${fixed(min, decimals)} … ${withUnit(max, unit, decimals)}`;

/**
 * The text of a cell written with `decimals` (a row with its own decimals, where a pair needs more to tell its two
 * values apart). The same text as `bandCell` gives for that number of decimals.
 */
export function cellText(cell: BandCell, decimals: number): string {
  if (cell.state === 'few') return rangeText(Math.min(...cell.values), Math.max(...cell.values), cell.unit, decimals);
  if (cell.state !== 'ok' || !cell.stat || cell.key === 'tiltRange') return cell.text;
  const toleranceUnit = cell.unit === 'dBi' || cell.unit === 'dBd' ? 'dB' : cell.unit;
  let text = formatStat(cell.stat, cell.unit, toleranceUnit, decimals, toleranceDecimals(cell.stat, decimals, cell.decimals !== undefined)) + (cell.adjusted ? '*' : '');
  if (cell.stat.kind === 'mean') text += ` @ ${tiltText(cell.tiltDeg!)}°`;
  return text;
}

/**
 * Decimals of a tolerance: the cell's, or in a row with its own decimals as many more as a tolerance that is not zero
 * needs to show a digit (a lower region ratio of 0.0007 % ± 0.0002 % does not read "± 0.000 %").
 */
function toleranceDecimals(stat: BandStat, decimals: number, fine: boolean): number {
  return fine && stat.kind === 'double' ? fineDecimals(stat.tolerance, decimals) : decimals;
}

/** The numbers a cell's text is made of (mean and tolerance, the limit, or the range). */
function headlineNumbers(cell: BandCell): number[] {
  if (cell.state === 'few') return [Math.min(...cell.values), Math.max(...cell.values)];
  const st = cell.stat;
  if (cell.state !== 'ok' || !st) return [];
  return st.kind === 'double' ? [st.mean, st.tolerance] : st.kind === 'mean' ? [st.mean] : [st.value];
}

/** The most decimals a small value is written with (as the metrics table). */
const MAX_DECIMALS = 7;

/** Decimals for `v` in a row with its own decimals: the row's, or as many more as a value that is not zero needs to show a digit. */
export function fineDecimals(v: number, usual: number): number {
  if (v === 0 || Number(v.toFixed(usual)) !== 0) return usual;
  for (let d = usual + 1; d <= MAX_DECIMALS; d++) if (Number(v.toFixed(d)) !== 0) return d;
  return usual;
}

/**
 * Decimals for an `original → simulated` pair of a row with its own decimals: as many as it takes for no value that is
 * not zero to read as zero ("0.0009 % → 0.0002 %", not "0.001 % → 0.000 %"), as the metrics table writes such a pair.
 * The cells' own decimals for any other row.
 */
export function pairDecimals(a: BandCell, b: BandCell): number {
  const usual = a.decimals ?? 1;
  const spec = ALL_BAND_PARAMS.find((p) => p.key === a.key);
  if (!spec?.decimals) return usual;
  const numbersA = headlineNumbers(a);
  const numbersB = headlineNumbers(b);
  const d = Math.max(usual, ...[...numbersA, ...numbersB].map((v) => fineDecimals(v, usual)));
  // Two values that differ are not shown as one: up to the row's CSV decimals, as many as it takes for the texts to differ
  // (0.0007 % → 0.0012 % does not collapse into "0.001 %"). Values equal at that precision are shown once.
  const differ = numbersA.length !== numbersB.length || numbersA.some((v, i) => v !== numbersB[i]);
  if (!differ) return d;
  for (let finer = d; finer <= spec.decimals.csv; finer++) if (cellText(a, finer) !== cellText(b, finer)) return finer;
  return d;
}

export function bandCell(
  p: BandParam,
  items: readonly TaggedPattern[],
  metrics: Map<string, PatternMetrics>,
  ctx: BandContext,
): BandCell {
  const s = collectSamples(p.key, items, metrics, ctx.gainUnit);
  const unit = p.unit === 'gain' ? ctx.gainUnit : p.unit;
  const toleranceUnit = p.unit === 'gain' ? 'dB' : unit;
  const decimals = p.decimals?.shown ?? 1;
  const base = { key: p.key, missing: s.missing, substituted: 0, adjusted: false, stat: null, unit, ...(p.decimals ? { decimals } : {}), tiltDeg: s.tiltDeg };

  if (s.values.length === 0) {
    return {
      ...base,
      state: 'empty',
      n: 0,
      values: [],
      text: '—',
      title: 'No values in this sub-band' + (s.missing ? `: ${plural(s.missing, 'file')} without a value` : ''),
    };
  }

  if (p.key === 'tiltRange') {
    const t = s.values as number[];
    return {
      ...base,
      state: 'ok',
      n: t.length,
      values: t,
      text: t.length === 1 ? `${tiltText(t[0])}°` : `${tiltText(t[0])}° – ${tiltText(t[t.length - 1])}°`,
      title: `Nominal electrical tilts of the files (BASTA 7.2.7): ${t.map(tiltText).join(', ')}`,
    };
  }

  const sub = substituteNotAvailable(s.values);
  if (!sub.applicable) {
    return {
      ...base,
      state: 'notApplicable',
      n: sub.total,
      values: [],
      text: 'n/a',
      title: `Not applicable: ${sub.notAvailable} of ${sub.total} values are "not available" (more than half, BASTA 12.5.3)`,
    };
  }

  const v = sub.values;
  const n = v.length;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const common = { ...base, n, substituted: sub.substituted, values: v };

  if (p.type !== 'mean' && n < MIN_SAMPLES) {
    return {
      ...common,
      state: 'few',
      text: rangeText(min, max, unit, decimals),
      title: [
        `Only ${plural(n, 'value')}: fewer than ${MIN_SAMPLES}, so the BASTA statistic is not computed; the range is shown`,
        ...(s.missing ? [`${plural(s.missing, 'file')} without a value`] : []),
        ...(sub.substituted > 0 ? [substitutedNote(sub.substituted, n)] : []),
      ].join('\n'),
    };
  }

  const stat =
    p.type === 'double'
      ? doubleSided(v, p.mean!)!
      : p.type === 'mean'
        ? meanOnly(v, p.mean!)!
        : singleSided(v, p.type as 'max' | 'min', p.excursion ? EXCURSION_DB : undefined)!;
  const adjusted = (stat.kind === 'min' || stat.kind === 'max') && stat.adjusted;
  let text = formatStat(stat, unit, toleranceUnit, decimals, toleranceDecimals(stat, decimals, p.decimals !== undefined)) + (adjusted ? '*' : '');
  if (stat.kind === 'mean') text += ` @ ${tiltText(s.tiltDeg!)}°`;

  const f2 = (x: number) => fixed(x, p.decimals?.csv ?? 2);
  const lines: string[] = [];
  switch (stat.kind) {
    case 'double':
      lines.push('Double-sided (BASTA 12.4.2): mean ± tolerance; the tolerance is the mean distance of the 6.7th and 93.3rd percentiles from the mean');
      break;
    case 'max':
      lines.push('Single-sided maximum (BASTA 12.4.4): 84th percentile, 84 % of the values are at or below it');
      break;
    case 'min':
      lines.push('Single-sided minimum (BASTA 12.4.4): 16th percentile, 84 % of the values are at or above it');
      break;
    case 'mean':
      lines.push(
        `Mean of the linear gains at ${tiltText(s.tiltDeg!)}° nominal tilt, in dB (BASTA 12.6.1); with the ${GAIN_REPEATABILITY_DB} dB repeatability margin: ${withUnit(stat.mean - GAIN_REPEATABILITY_DB, unit)}`,
      );
      break;
  }
  let counts = `N = ${n}${s.missing ? ` (${plural(s.missing, 'file')} without a value)` : ''} · min ${f2(min)} · max ${f2(max)}`;
  if (stat.kind === 'double') counts += ` · mean ${f2(stat.mean)} · P6.7 ${f2(stat.lower)} · P93.3 ${f2(stat.upper)}`;
  else if (stat.kind === 'max') counts += ` · P84 ${f2(stat.percentile)}`;
  else if (stat.kind === 'min') counts += ` · P16 ${f2(stat.percentile)}`;
  lines.push(counts);
  if (p.mean === 'power' && stat.kind === 'double') lines.push('The mean is taken over the linear values and converted back to dB');
  if (p.mean === 'powerLevel' && stat.kind === 'double') lines.push('The mean is that of the linear power at the horizon (10^(−level/10)), written again as dB below the 3D peak; the percentiles are of the dB values');
  if (stat.kind === 'min' && stat.adjusted) lines.push('* Lowered to the lowest value + 3 dB (3 dB excursion rule, BASTA 12.2)');
  if (stat.kind === 'max' && stat.adjusted) lines.push('* Raised to the highest value − 3 dB (3 dB excursion rule, BASTA 12.2)');
  if (sub.substituted > 0) lines.push(substitutedNote(sub.substituted, n));
  if (p.key === 'gainAll') lines.push(`Declared gain from the file headers; repeatability margin ${GAIN_REPEATABILITY_DB} dB (BASTA 12.6)`);
  if (isAngularRegion(p.key)) lines.push('Estimates from the two co-polar cuts, not BASTA-compliant values; files whose beam is not Type A (macro) give no value');

  return { ...common, state: 'ok', adjusted, stat, text, title: lines.join('\n') };
}

/** The cells of a sub-band: every Annex C row, and the extra rows the table was made with (see `bandRows`). */
export type BandCells = Record<AnnexParamKey, BandCell> & Partial<Record<ExtraParamKey, BandCell>>;

export interface BandColumn {
  subBand: SubBand;
  files: number;
  frequencies: number;
  /** Distinct nominal tilts, ascending. */
  tilts: number[];
  cells: BandCells;
}

/** The cell of a row; the row must be one the column was made with (`bandTable`'s `rows`). */
export function cellOf(column: BandColumn, key: BandParamKey): BandCell {
  const cell = column.cells[key];
  if (!cell) throw new Error(`Band table made without the row ${key}`);
  return cell;
}

export function bandTable(
  items: readonly TaggedPattern[],
  metrics: Map<string, PatternMetrics>,
  subBands: readonly SubBand[],
  ctx: BandContext,
  /** The rows to compute: the Annex C list, or `bandRows(…)` (the extra ones read values the metrics already hold). */
  rows: readonly BandParam[] = BAND_PARAMS,
): BandColumn[] {
  return subBands.map((subBand) => {
    const inBand = items.filter((i) => inSubBand(i.pattern.frequencyMHz, subBand));
    const cells = Object.fromEntries(rows.map((p) => [p.key, bandCell(p, inBand, metrics, ctx)])) as BandCells;
    return {
      subBand,
      files: inBand.length,
      frequencies: new Set(inBand.map((i) => i.pattern.frequencyMHz)).size,
      tilts: nominalTilts(inBand),
      cells,
    };
  });
}

export function columnSummary(c: BandColumn): string {
  const t = c.tilts;
  const range = t.length === 0 ? '' : t.length === 1 ? ` (${tiltText(t[0])}°)` : ` (${tiltText(t[0])}°–${tiltText(t[t.length - 1])}°)`;
  return `${plural(c.files, 'file')} · ${c.frequencies} frequenc${c.frequencies === 1 ? 'y' : 'ies'} · ${plural(t.length, 'nominal tilt')}${range}`;
}
