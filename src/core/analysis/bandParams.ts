import type { GainUnit, MetricResult } from '../types';
import { convertGain } from '../gain';
import {
  doubleSided,
  EXCURSION_DB,
  fix1,
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

export type BandParamKey =
  | 'gainAll' | 'gainMinTilt' | 'gainMidTilt' | 'gainMaxTilt' | 'tiltRange'
  | 'hHpbw' | 'vHpbw' | 'squint' | 'tiltDeviation' | 'fbWindow'
  | 'firstUsls' | 'usls' | 'uslsHorizon' | 'uslsMax' | 'nullFill' | 'firstLsls' | 'hSls'
  | 'tracking' | 'rollOff' | 'air';
export type ValidationType = 'double' | 'max' | 'min' | 'mean' | 'absolute';

export interface BandParam {
  key: BandParamKey;
  label: string;
  unit: '°' | 'dB' | 'gain';
  type: ValidationType;
  mean?: MeanKind;
  /** The 3 dB excursion rule applies (not to null fill: a pure 84th percentile). */
  excursion?: true;
  /** "Not available" values take part in the 22 dB rule. */
  substitute?: true;
  basta: string;
  description: string;
}

export const BAND_PARAMS: BandParam[] = [
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

export function bandParamLabel(p: BandParam, settings: AnalysisSettings): string {
  if (p.key === 'fbWindow') return `F/B ±${settings.fbWindowDeg}°`;
  if (p.key === 'usls') return `USLS peak to ${settings.uslsRangeDeg}°`;
  if (p.key === 'uslsHorizon') return `USLS horizon to ${settings.uslsRangeDeg}°`;
  return p.label;
}

export function bandParamTitle(p: BandParam, settings: AnalysisSettings): string {
  const description = p.description.replace('R°', `${settings.uslsRangeDeg}°`);
  return `${description} (BASTA ${p.basta}) — ${VALIDATION_LABEL[p.type]}`;
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

type PlainKey = 'hHpbw' | 'vHpbw' | 'squint' | 'fbWindow' | 'firstUsls' | 'usls' | 'uslsHorizon' | 'uslsMax' | 'nullFill' | 'firstLsls' | 'hSls' | 'air';
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
  const spec = BAND_PARAMS.find((p) => p.key === key)!;

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
    if (key === 'tiltDeviation') {
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
  tiltDeg?: number;
  text: string;
  title: string;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const substitutedNote = (k: number, n: number): string => `${k} of ${n} values were "not available" and count as 22 dB (BASTA 12.5.3)`;
const tiltText = (t: number): string => String(Math.round(t * 10) / 10);

export function bandCell(
  p: BandParam,
  items: readonly TaggedPattern[],
  metrics: Map<string, PatternMetrics>,
  ctx: BandContext,
): BandCell {
  const s = collectSamples(p.key, items, metrics, ctx.gainUnit);
  const unit = p.unit === 'gain' ? ctx.gainUnit : p.unit;
  const toleranceUnit = p.unit === 'gain' ? 'dB' : unit;
  const base = { key: p.key, missing: s.missing, substituted: 0, adjusted: false, stat: null, unit, tiltDeg: s.tiltDeg };

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
      text: fix1(min) === fix1(max) ? withUnit(min, unit) : `${fix1(min)} … ${withUnit(max, unit)}`,
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
  let text = formatStat(stat, unit, toleranceUnit) + (adjusted ? '*' : '');
  if (stat.kind === 'mean') text += ` @ ${tiltText(s.tiltDeg!)}°`;

  const f2 = (x: number) => x.toFixed(2);
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
  if (stat.kind === 'min' && stat.adjusted) lines.push('* Lowered to the lowest value + 3 dB (3 dB excursion rule, BASTA 12.2)');
  if (stat.kind === 'max' && stat.adjusted) lines.push('* Raised to the highest value − 3 dB (3 dB excursion rule, BASTA 12.2)');
  if (sub.substituted > 0) lines.push(substitutedNote(sub.substituted, n));
  if (p.key === 'gainAll') lines.push(`Declared gain from the file headers; repeatability margin ${GAIN_REPEATABILITY_DB} dB (BASTA 12.6)`);

  return { ...common, state: 'ok', adjusted, stat, text, title: lines.join('\n') };
}

export interface BandColumn {
  subBand: SubBand;
  files: number;
  frequencies: number;
  /** Distinct nominal tilts, ascending. */
  tilts: number[];
  cells: Record<BandParamKey, BandCell>;
}

export function bandTable(
  items: readonly TaggedPattern[],
  metrics: Map<string, PatternMetrics>,
  subBands: readonly SubBand[],
  ctx: BandContext,
): BandColumn[] {
  return subBands.map((subBand) => {
    const inBand = items.filter((i) => inSubBand(i.pattern.frequencyMHz, subBand));
    const cells = Object.fromEntries(BAND_PARAMS.map((p) => [p.key, bandCell(p, inBand, metrics, ctx)])) as Record<BandParamKey, BandCell>;
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
