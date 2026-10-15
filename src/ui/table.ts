import type { GainUnit, MetricResult } from '../core/types';
import type { PatternMetrics } from '../core/analysis/metrics';
import type { GroupView } from '../state/selectors';
import { isTilted, type HCutMode, type TiltSettings, type SimSettings } from '../core/analysis/tilt';
import { convertGain } from '../core/gain';
import { nameOf } from '../core/names';
import type { ColumnGroupKey } from '../state/store';
import { methodFull, methodShort, type MethodName } from '../core/analysis/backHalf3d';
import { bwName, settingText } from './bwLabel';
import { fixed } from './fixed';
import { HORIZON_LEVEL_KEY, METRIC_KEYS, type MetricColumn, type TableColumn } from '../state/metricKeys';

export { METRIC_KEYS, type MetricColumn, type TableColumn, fixed };

export const COLUMN_GROUPS: { key: ColumnGroupKey; label: string }[] = [
  { key: 'beam', label: 'Beam' },
  { key: 'fb', label: 'Front/back' },
  { key: 'sidelobes', label: 'Sidelobes' },
  { key: 'sector', label: 'Sector' },
  { key: 'declared', label: 'Declared Δ' },
  { key: 'are', label: 'Angular regions (est.)' },
];

/** What the table says about each metric column; `Record` makes a key without an entry (or an entry without a key) a compile error. */
const COLUMN_INFO: Record<MetricColumn, { label: string; unit: string; group: ColumnGroupKey }> = {
  hHpbw: { label: 'H-HPBW', unit: '°', group: 'beam' },
  vHpbw: { label: 'V-HPBW', unit: '°', group: 'beam' },
  hBw10: { label: 'H-BW 10 dB', unit: '°', group: 'beam' },
  vBw10: { label: 'V-BW 10 dB', unit: '°', group: 'beam' },
  squint: { label: 'Squint', unit: '°', group: 'beam' },
  hPeak: { label: 'Peak az', unit: '°', group: 'beam' },
  tilt: { label: 'Tilt', unit: '°', group: 'beam' },
  vPeak: { label: 'Peak tilt', unit: '°', group: 'beam' },
  tiltError: { label: 'Tilt error', unit: '°', group: 'beam' },
  fb180: { label: 'F/B 180°', unit: 'dB', group: 'fb' },
  fbWindow: { label: 'F/B window', unit: 'dB', group: 'fb' },
  firstUsls: { label: 'First USLS', unit: 'dB', group: 'sidelobes' },
  usls: { label: 'USLS peak to 20°', unit: 'dB', group: 'sidelobes' },
  uslsHorizon: { label: 'USLS horizon to 20°', unit: 'dB', group: 'sidelobes' },
  uslsMax: { label: 'USLS max', unit: 'dB', group: 'sidelobes' },
  nullFill: { label: 'Null fill', unit: 'dB', group: 'sidelobes' },
  firstLsls: { label: 'First LSLS', unit: 'dB', group: 'sidelobes' },
  hSls: { label: 'H-SLS', unit: 'dB', group: 'sidelobes' },
  tracking: { label: 'P2P tracking', unit: 'dB', group: 'sector' },
  spr: { label: 'SPR', unit: '%', group: 'sector' },
  air: { label: 'AIR', unit: 'dB', group: 'sector' },
  rollOff: { label: 'Roll-off', unit: 'dB', group: 'sector' },
  du16: { label: 'D/U 16QAM', unit: '°', group: 'sector' },
  du64: { label: 'D/U 64QAM', unit: '°', group: 'sector' },
  du256: { label: 'D/U 256QAM', unit: '°', group: 'sector' },
  dH: { label: 'H-HPBW − decl.', unit: '°', group: 'declared' },
  dV: { label: 'V-HPBW − decl.', unit: '°', group: 'declared' },
  dFb: { label: 'F/B − decl.', unit: 'dB', group: 'declared' },
  areSector: { label: 'Sector eff. est.', unit: '%', group: 'are' },
  areSpatial: { label: 'Spatial eff. est.', unit: '%', group: 'are' },
  areLower: { label: 'Lower region est.', unit: '%', group: 'are' },
};

/** The metric columns, in the order of `METRIC_KEYS` (the one list of keys; see state/metricKeys.ts). */
export const METRIC_COLUMNS: { key: MetricColumn; label: string; unit: string; group: ColumnGroupKey }[] = METRIC_KEYS.map((key) => ({ key, ...COLUMN_INFO[key] }));

export function visibleColumns(groups: Record<ColumnGroupKey, boolean>): typeof METRIC_COLUMNS {
  return METRIC_COLUMNS.filter((c) => groups[c.group]);
}

/** The group whose values are only computed while they are wanted (see `needsAngularRegions`). */
const ON_DEMAND_GROUP: ColumnGroupKey = 'are';

/**
 * The columns of the CSV: every column whether its group is shown or not, except the angular-region estimate,
 * which is exported only while its group is shown (it is not computed otherwise).
 */
export function csvColumns(groups: Record<ColumnGroupKey, boolean>): typeof METRIC_COLUMNS {
  return METRIC_COLUMNS.filter((c) => c.group !== ON_DEMAND_GROUP || groups[ON_DEMAND_GROUP]);
}

/** The tooltip of a column group's checkbox; only the on-demand group has something to say. */
export function columnGroupTitle(key: ColumnGroupKey): string | undefined {
  return key === ON_DEMAND_GROUP
    ? 'Estimates from the two cuts, not BASTA-compliant values. Unlike the other groups, these columns are exported to CSV only while they are shown here.'
    : undefined;
}

const CSV_DEFAULT_COLUMNS = METRIC_COLUMNS.filter((c) => c.group !== ON_DEMAND_GROUP);

/** Whether the angular-region estimate has to be computed: its group is shown, or the frequency chart plots one of its columns. */
export function needsAngularRegions(groups: Record<ColumnGroupKey, boolean>, freqMetric: TableColumn): boolean {
  return groups[ON_DEMAND_GROUP] || (freqMetric !== HORIZON_LEVEL_KEY && COLUMN_INFO[freqMetric].group === ON_DEMAND_GROUP);
}

/** A column as the table, the exports and the chart menu list it. */
export interface ColumnSpec {
  key: TableColumn;
  label: string;
  unit: string;
  group: ColumnGroupKey;
}

/**
 * The Horizon level: how far the maximum of a row's horizon cut lies below the pattern's 3D peak. It is not among
 * `METRIC_COLUMNS`: it exists only while the simulated horizontal cut is the one at the horizon (`withHorizonLevel`).
 */
export const HORIZON_LEVEL_COLUMN: ColumnSpec & { key: typeof HORIZON_LEVEL_KEY } = { key: HORIZON_LEVEL_KEY, label: 'Horizon level', unit: 'dB', group: 'beam' };

/**
 * `columns` with the Horizon level right after the horizontal beamwidth while the cut is the one at the horizon;
 * `columns` itself otherwise, or when the horizontal beamwidth is not among them (the Beam group is hidden).
 */
export function withHorizonLevel<T extends ColumnSpec>(columns: readonly T[], horizonCut: boolean): readonly (T | typeof HORIZON_LEVEL_COLUMN)[] {
  const at = horizonCut ? columns.findIndex((c) => c.key === 'hHpbw') : -1;
  return at < 0 ? columns : [...columns.slice(0, at + 1), HORIZON_LEVEL_COLUMN, ...columns.slice(at + 1)];
}

/** What the frequency chart's Metric menu offers: the metric columns, and the Horizon level at the horizon. */
export const chartColumns = (horizonCut: boolean): readonly ColumnSpec[] => withHorizonLevel(METRIC_COLUMNS, horizonCut);

/** The metric the frequency chart plots: the stored one, or the beamwidths while the stored one is the Horizon level and the cut is not the one at the horizon. */
export const shownChartMetric = (stored: TableColumn, horizonCut: boolean): TableColumn => (stored === HORIZON_LEVEL_KEY && !horizonCut ? 'hHpbw' : stored);

const NO_HORIZON_LEVEL: MetricResult = { value: null, reason: 'Only a simulated horizon cut has a horizon level' };

/** The Horizon level of a file's metrics: a value for a simulated horizon cut, missing (with the reason) for anything else. */
const horizonLevelOf = (m: PatternMetrics | undefined): MetricResult => (m?.hCutPeakDb === undefined ? NO_HORIZON_LEVEL : { value: m.hCutPeakDb });

/** The words a column has in the name of its frequency chart image (a file name: no settings-dependent numbers, no symbols). */
const CHART_SLUG: Record<TableColumn, string> = {
  hHpbw: 'beamwidth',
  vHpbw: 'vertical-beamwidth',
  hBw10: 'horizontal-beamwidth-10-db',
  vBw10: 'vertical-beamwidth-10-db',
  squint: 'squint',
  hPeak: 'peak-azimuth',
  tilt: 'tilt',
  vPeak: 'peak-tilt',
  tiltError: 'tilt-error',
  fb180: 'front-to-back-180',
  fbWindow: 'front-to-back-window',
  firstUsls: 'first-upper-sidelobe',
  usls: 'upper-sidelobe-from-peak',
  uslsHorizon: 'upper-sidelobe-from-horizon',
  uslsMax: 'upper-sidelobe-max',
  nullFill: 'null-fill',
  firstLsls: 'first-lower-sidelobe',
  hSls: 'horizontal-sidelobe',
  tracking: 'port-to-port-tracking',
  spr: 'sector-power-ratio',
  air: 'azimuth-interference-ratio',
  rollOff: 'roll-off',
  du16: 'du-aperture-16qam',
  du64: 'du-aperture-64qam',
  du256: 'du-aperture-256qam',
  dH: 'horizontal-beamwidth-minus-declared',
  dV: 'vertical-beamwidth-minus-declared',
  dFb: 'front-to-back-minus-declared',
  areSector: 'sector-efficiency-est',
  areSpatial: 'spatial-efficiency-est',
  areLower: 'lower-region-est',
  [HORIZON_LEVEL_KEY]: 'horizon-level',
};

/** The name of a column's frequency chart image, without "-simulated" and the extension: "sector-efficiency-est-vs-frequency". */
export const chartFileBase = (key: TableColumn): string => `${CHART_SLUG[key]}-vs-frequency`;

/** One column's value of a file's metrics (what the frequency chart plots). */
export const metricValue = (m: PatternMetrics, key: TableColumn): MetricResult => (key === HORIZON_LEVEL_KEY ? horizonLevelOf(m) : cellsOf(m)[key]);

/**
 * A column's label where its numbers leave the table (CSV and copied headers, the frequency chart's axis and caption):
 * the angular-region estimate carries the 3D method, which changes it by several points; every other label is as given.
 */
export function withMethod(key: TableColumn, label: string, method: MethodName): string {
  return key !== HORIZON_LEVEL_KEY && COLUMN_INFO[key].group === ON_DEMAND_GROUP ? `${label} [${methodFull(method)}]` : label;
}

/**
 * The 3D method as the on-screen header of an angular-region column carries it: a short tag to read ("[Sum.]") and
 * the full one ("[Summation]", as in the exported header) for the accessible name. Undefined for every other column.
 */
export function methodTag(key: TableColumn, method: MethodName): { short: string; full: string } | undefined {
  return key !== HORIZON_LEVEL_KEY && COLUMN_INFO[key].group === ON_DEMAND_GROUP ? { short: `[${methodShort(method)}]`, full: `[${methodFull(method)}]` } : undefined;
}

/** The metric columns read from the horizontal cut: the ones that follow the choice of the simulated horizontal cut. */
const HORIZONTAL_KEYS: ReadonlySet<MetricColumn> = new Set<MetricColumn>([
  'hHpbw', 'hBw10', 'squint', 'hPeak', 'fb180', 'fbWindow', 'hSls', 'tracking', 'spr', 'air', 'rollOff', 'du16', 'du64', 'du256',
]);

/**
 * The cells of an untilted file that follow its simulated horizontal cut (a horizon cut): the horizontal columns, and
 * the two Δ-declared ones read from the horizontal cut (blank then: the header describes the file cut).
 */
const FOLLOWS_H_CUT: ReadonlySet<MetricColumn> = new Set<MetricColumn>([...HORIZONTAL_KEYS, 'dH', 'dFb']);

/** Whether a column is read from the horizontal cut, so that its values follow the simulated horizontal cut of an untilted file too. */
export const followsHCut = (key: TableColumn): boolean => key === HORIZON_LEVEL_KEY || FOLLOWS_H_CUT.has(key);

/** Whether a column holds `original → tilted` values read from the horizontal cut (the Horizon level is a single value). */
const isHorizontal = (key: TableColumn): boolean => key !== HORIZON_LEVEL_KEY && HORIZONTAL_KEYS.has(key);

/** What the two values of a simulated cell (`a → b`) are called. */
export interface PairWords {
  from: string;
  to: string;
}
/** A tilt is set on some file: a pair is the original and the tilted value. */
export const TILT_WORDS: PairWords = { from: 'original', to: 'tilted' };
/** The cut at the horizon with no tilt on any file: nothing is tilted, a pair is the file cut and the horizon cut. */
export const HORIZON_WORDS: PairWords = { from: 'file cut', to: 'horizon cut' };
export const pairWords = (horizonCut: boolean, tiltActive: boolean): PairWords => (horizonCut && !tiltActive ? HORIZON_WORDS : TILT_WORDS);

/** The tag of a horizontal column in the exports while the cut is at the horizon and no file is tilted (comma-free). */
export const AT_HORIZON_TAG = '[H cut at the horizon]';

/** What an export header adds to the tilted values of a horizontal column while the simulated cut is the one at the horizon (comma-free, like the 3D method). */
export const HORIZON_TAG = '[horizon cut]';

/**
 * The 3D method after a horizon-cut tag, as the angular-region headers carry it ("[horizon cut] [Weighted]", comma-free):
 * a horizon cut is read from the 3D reconstruction, so the method decides its numbers.
 */
const methodNamed = (tag: string, method: MethodName): string => `${tag} [${methodFull(method)}]`;

/** The tag for column `key`, with a leading space, or nothing: only horizontal columns, only when `horizonCut`. */
const horizonTag = (key: TableColumn, horizonCut: boolean, method: MethodName): string =>
  horizonCut && (key === HORIZON_LEVEL_KEY || isHorizontal(key)) ? ` ${methodNamed(HORIZON_TAG, method)}` : '';

/** The second half of the three angular-region tooltips: what kind of number this is. */
const areNote = (method: MethodName, levelDb = 3): string =>
  `Estimate from the two co-polar cuts, integrated over the 3D reconstruction (3D method: ${methodFull(method)}, chosen in the Simulation bar); not BASTA-compliant, which needs the measured full sphere and total power. Beam Type A (macro) only: — when V-HPBW is outside 0.5–25° or H-HPBW outside 50–130°${levelDb === 3 ? '' : '. V-HPBW and H-HPBW here are the 3 dB widths, whatever the beamwidth level'}`;

/** Header text for a column; the beamwidth, F/B window and USLS window labels depend on the current settings. */
export function columnLabel(c: { key: TableColumn; label: string }, fbWindowDeg: number, uslsRangeDeg = 20, levelDb = 3): string {
  if (c.key === 'hHpbw') return `H-${bwName(levelDb)}`;
  if (c.key === 'vHpbw') return `V-${bwName(levelDb)}`;
  if (c.key === 'dH') return `H-${bwName(levelDb)} − decl.`;
  if (c.key === 'dV') return `V-${bwName(levelDb)} − decl.`;
  if (c.key === 'fbWindow') return `F/B ±${settingText(fbWindowDeg)}°`;
  if (c.key === 'usls') return `USLS peak to ${settingText(uslsRangeDeg)}°`;
  if (c.key === 'uslsHorizon') return `USLS horizon to ${settingText(uslsRangeDeg)}°`;
  return c.label;
}

const DU_DB: Partial<Record<MetricColumn, number>> = { du16: 15, du64: 20, du256: 25 };

/**
 * What a column's tooltip adds while the simulated horizontal cut is the one at the horizon: which reference its
 * "below the peak" uses there. Levels are below the pattern's 3D peak, widths below the cut's own maximum, so the
 * roll-off and the 10 dB beamwidth, two readings of one curve, differ by the Horizon level.
 */
const HORIZON_REFERENCE: Partial<Record<MetricColumn, string>> = {
  hHpbw: 'below the maximum of that cut, not the 3D peak',
  hBw10: '10 dB below the maximum of that cut, not the 3D peak',
  squint: 'of that cut, whose strongest lobe need not be the main beam (see Horizon level)',
  hPeak: 'of that cut, whose strongest lobe need not be the main beam (see Horizon level)',
  fb180: 'below the 3D peak of the pattern, not the maximum of the cut',
  fbWindow: 'below the 3D peak of the pattern, not the maximum of the cut',
  hSls: 'below the 3D peak of the pattern, not the maximum of the cut',
  tracking: 'each port against its own 3D peak',
  rollOff: 'the level at the sector edge below the 3D peak; subtract the Horizon level for the shape of the cut',
};

interface TitleSettings {
  sectorEdgeDeg: number;
  siteSectors: number;
  uslsRangeDeg?: number;
  lobeLimitFactor?: number;
  levelDb?: number;
  fbWindowDeg?: number;
  method3d?: MethodName;
  /** The simulated horizontal cut is the one at the horizon: the columns read from it say which peak they refer to. */
  horizonCut?: boolean;
  /** A file shown is tipped mechanically and its horizontal cut is the cone through the tilted beam peak (see `mechConeCut`): the F/B columns say what that does to them. */
  mechConeCut?: boolean;
}

/**
 * Said at the F/B columns and in the note above the table while `mechConeCut`: on the cone through the tilted beam
 * peak the back of the pattern is read about twice the tilt off the antenna's own cut, where the reconstruction is
 * weakest, so a mechanical tilt can seem to change F/B by many dB (see docs/metrics.md).
 */
export const FB_CONE_NOTE = 'Under a mechanical tilt, F/B on this cut is a rough estimate (the back is read off a tilted cone); see Definitions';

/** Whether one of the files `ids` has a mechanical tilt (the slider plus its offsets) while the horizontal cut shown is the one through the beam peak. */
export function mechConeCut(hCut: HCutMode, ids: Iterable<string>, effective: (id: string) => SimSettings): boolean {
  if (hCut !== 'beam') return false;
  for (const id of ids) if (effective(id).mechanicalDeg !== 0) return true;
  return false;
}

/** Header tooltip for a column; the sector columns depend on the sector settings (E, S). */
export function columnTitle(key: TableColumn, settings: TitleSettings): string | undefined {
  const title = baseTitle(key, settings);
  const reference = settings.horizonCut && key !== HORIZON_LEVEL_KEY ? HORIZON_REFERENCE[key] : undefined;
  if (title !== undefined && settings.mechConeCut && (key === 'fb180' || key === 'fbWindow')) return `${title}. ${FB_CONE_NOTE}.`;
  return title !== undefined && reference ? `${title}. On a horizon cut: ${reference}.` : title;
}

function baseTitle(key: TableColumn, settings: TitleSettings): string | undefined {
  // The settings as the page writes them (the level is also compared and named: `levelText` is its text).
  const e = settingText(settings.sectorEdgeDeg);
  const r = settingText(settings.uslsRangeDeg ?? 20);
  const f = settings.lobeLimitFactor ?? 1.78;
  const level = settings.levelDb ?? 3;
  const levelText = settingText(level);
  const w = settingText(settings.fbWindowDeg ?? 30);
  const method = settings.method3d ?? 'summation';
  switch (key) {
    case 'hHpbw':
      return `Horizontal ${level === 3 ? 'half-power ' : ''}beamwidth (BASTA 6.1.6): distance between the two points ${levelText} dB below the peak of the azimuth cut`;
    case 'vHpbw':
      return `Vertical ${level === 3 ? 'half-power ' : ''}beamwidth (BASTA 6.1.6): distance between the two points ${levelText} dB below the peak of the elevation cut`;
    case 'fbWindow':
      return `Front/back ratio (BASTA 7.2.9.1): highest azimuth level within 180° ± ${w}°, in dB below the peak (co-pol only)`;
    case 'fb180':
      return 'Level of the azimuth cut at exactly 180°, in dB below the peak';
    case 'dH':
      return `Computed H-${bwName(level)} minus the value declared in the file header; — when the header has none`;
    case 'dV':
      return `Computed V-${bwName(level)} minus the value declared in the file header; — when the header has none`;
    case 'dFb':
      return 'Computed F/B at 180° minus the value declared in the file header; — when the header has none';
    case 'firstUsls':
      return `First upper sidelobe suppression (BASTA 7.8.4.2): first sidelobe peak within ${f} × V-HPBW above the beam peak, else the level at 1.55 × V-HPBW above it (merged sidelobe)`;
    case 'usls':
      return `Upper sidelobe suppression, beam peak to ${r}° above it (BASTA 7.8.4.3): highest level beyond the main beam in that window; — when only the main beam is in the window`;
    case 'uslsHorizon':
      return `Upper sidelobe suppression, horizon to ${r}° above it (BASTA 7.8.4.5, elevation cut only); — when only the main beam is in the window`;
    case 'uslsMax':
      return 'Maximum upper sidelobe suppression, beam peak to zenith (BASTA 7.8.4.4)';
    case 'nullFill':
      return 'Null fill (BASTA 7.8.3): depth below the peak of the first null below the main beam, or of the merged first lower sidelobe at 1.55 × V-HPBW';
    case 'firstLsls':
      return 'First lower sidelobe suppression: as First USLS, below the beam peak';
    case 'hSls':
      return `Maximum horizontal sidelobe suppression within ±${e}° (BASTA 7.8.4.1): highest level beyond the first nulls of the azimuth main beam`;
    case 'hBw10':
      return 'Azimuth beamwidth 10 dB below the peak of the cut (BASTA 6.1.6)';
    case 'vBw10':
      return 'Elevation beamwidth 10 dB below the peak of the cut (BASTA 6.1.6)';
    case 'hPeak':
      return 'Azimuth of the strongest co-pol level (BASTA beam direction); Squint is the bisector of the beamwidth points';
    case 'vPeak':
      return 'Elevation of the strongest co-pol level, positive below the horizon; Tilt is the bisector of the beamwidth points';
    case 'squint':
      return 'Azimuth beam squint: bisector of the beamwidth points relative to boresight (0°)';
    case 'tilt':
      return 'Electrical downtilt: bisector of the beamwidth points of the elevation cut (BASTA half-power beam axis), positive below the horizon';
    case 'tiltError':
      return 'Tilt minus the nominal tilt, signed (BASTA downtilt deviation is its absolute value)';
    case 'tracking':
      return `Azimuth beam port-to-port tracking within ±${e}° (gain-aware when both gains are declared)`;
    case 'spr':
      return `Sector power ratio: power outside ±${e}° divided by power inside, times 100 (co-pol). It is not a share of the total, so it can exceed 100 % for wide or omnidirectional patterns`;
    case 'air':
      return 'Azimuth interference ratio: 10·log10(inside/outside), co-pol only';
    case 'rollOff':
      return `Level at the ±${e}° sector edges below the peak (worse edge)`;
    case 'du16':
    case 'du64':
    case 'du256':
      return `Width around boresight where this pattern is ≥ ${DU_DB[key]} dB above the neighbouring sectors (${settings.siteSectors}-sector site)`;
    case 'areSector':
      return `Sector efficiency (after BASTA 7.2.4): power in the service region (within ±${e}° of boresight, from half a V-HPBW above the beam peak down to 75° below the horizon) as a share of the power over the whole sphere. ${areNote(method, level)}`;
    case 'areSpatial':
      return `Spatial efficiency (after BASTA 7.2.4): power in the service region (within ±${e}° of boresight) as a share of the power in the service and interference regions together (all azimuths, from one V-HPBW above the beam peak, at most the horizon, down to 75° below the horizon). ${areNote(method, level)}`;
    case HORIZON_LEVEL_KEY:
      return `Horizon level: how far the strongest point of the horizon cut is below the strongest point of the whole pattern (the 3D peak), in dB. When the level is large the horizon runs through a sidelobe or a null, and H-${bwName(level)}, H-BW 10 dB and Squint on this row describe that region, not the main beam.`;
    case 'areLower':
      return `Lower region ratio (after BASTA 7.2.4): power from 75° below the horizon to straight down, all azimuths, as a share of the power over the whole sphere. ${areNote(method, level)}`;
    default:
      return undefined;
  }
}

export interface MetricsRow {
  id: string;
  file: string;
  source: string;
  group: string;
  /** The group label is the app's own (see `GroupView.generatedLabel`): exports do not guard it as user text. */
  generatedGroup?: true;
  freq: number;
  gain: number | null;
  cells: Record<MetricColumn, MetricResult>;
  /** Only the cells that should show `original → tilted`; absent cells stay single values. */
  tilted?: Partial<Record<MetricColumn, MetricResult>>;
  /** The Horizon level, only for a row shown as a simulated horizon cut (in the difference view: the difference of two levels). */
  hLevel?: MetricResult;
  /** The pinned reference file's row: marked, and in the difference view it keeps its own values. */
  isReference?: boolean;
  /** The cells hold differences from the reference (signed, one decimal) instead of values. */
  isDelta?: boolean;
}

export { convertGain };

export function cellsOf(m: PatternMetrics): Record<MetricColumn, MetricResult> {
  return {
    hHpbw: m.h.hpbw,
    vHpbw: m.v.hpbw,
    hBw10: m.hBw10,
    vBw10: m.vBw10,
    squint: m.squint,
    hPeak: m.hPeak,
    tilt: m.tilt,
    vPeak: m.vPeak,
    tiltError: m.tiltError,
    fb180: m.fb180,
    fbWindow: m.fbWindow,
    firstUsls: m.firstUsls,
    usls: m.usls,
    uslsHorizon: m.uslsHorizon,
    uslsMax: m.uslsMax,
    nullFill: m.nullFill,
    firstLsls: m.firstLsls,
    hSls: m.hSls,
    tracking: m.beamTracking,
    spr: m.spr,
    air: m.air,
    rollOff: m.rollOff,
    du16: m.du.qam16,
    du64: m.du.qam64,
    du256: m.du.qam256,
    dH: m.delta.hHpbw,
    dV: m.delta.vHpbw,
    dFb: m.delta.fb,
    areSector: m.are.sector,
    areSpatial: m.are.spatial,
    areLower: m.are.lower,
  };
}

export function buildRows(
  groups: GroupView[],
  metrics: Map<string, PatternMetrics>,
  gainUnit: GainUnit,
  tiltedMetrics?: Map<string, PatternMetrics>,
  isTiltedId?: (id: string) => boolean,
  /** Whether an untilted file shows a simulated horizontal cut all the same (the cut at the horizon). */
  showsSimulatedH?: (id: string) => boolean,
): MetricsRow[] {
  const rows: MetricsRow[] = [];
  for (const g of groups) {
    for (const { pattern } of g.items) {
      const m = metrics.get(pattern.id);
      if (!m) continue;
      const tm = tiltedMetrics?.get(pattern.id);
      let tilted: Partial<Record<MetricColumn, MetricResult>> | undefined;
      if (tm) {
        if (isTiltedId?.(pattern.id) ?? true) {
          // The file itself is tilted: every cell compares original vs. tilted.
          tilted = cellsOf(tm);
        } else if (showsSimulatedH?.(pattern.id)) {
          // An untilted file shown as a horizon cut: what is read from the horizontal cut changes, nothing else does.
          const all = cellsOf(tm);
          tilted = {};
          for (const key of FOLLOWS_H_CUT) tilted[key] = all[key];
        } else if (tm.beamTracking.value !== m.beamTracking.value) {
          // An untilted file whose tracking partner is tilted: only its tracking cell changes.
          tilted = { tracking: tm.beamTracking };
        }
      }
      rows.push({
        id: pattern.id,
        file: nameOf(pattern),
        source: pattern.fileName,
        group: g.label,
        ...(g.generatedLabel ? { generatedGroup: true as const } : {}),
        freq: pattern.frequencyMHz,
        gain: convertGain(pattern.gain, gainUnit),
        cells: cellsOf(m),
        ...(tilted ? { tilted } : {}),
        ...(tm?.hCutPeakDb !== undefined ? { hLevel: horizonLevelOf(tm) } : {}),
      });
    }
  }
  return rows;
}

/** The rows of the ticked files, plus the pinned reference (always kept, so the difference view and its row stay). */
export function onlyTicked(rows: MetricsRow[], visible: Record<string, boolean>, referenceId: string | null): MetricsRow[] {
  return rows.filter((r) => visible[r.id] || r.id === referenceId);
}

/**
 * The count beside "Ticked files only": "2 of 24 files", and when the highlighted file's row is among the hidden ones
 * (it is not ticked) a note saying so, so a highlight that seems to point at nothing is explained.
 */
export function tickedCountText(shownRows: number, totalRows: number, highlightedRowHidden: boolean): string {
  const count = `${shownRows} of ${totalRows} files`;
  return highlightedRowHidden ? `${count} · the highlighted file is not ticked, so its row is hidden` : count;
}

/** What a row holds for a column: the metric cell, or the Horizon level (missing, with the reason, on a row without one). */
const cellOf = (r: MetricsRow, key: TableColumn): MetricResult => (key === HORIZON_LEVEL_KEY ? (r.hLevel ?? NO_HORIZON_LEVEL) : r.cells[key]);

/** The simulated value of a row's cell where it has one (the Horizon level is a single value: it has none). */
const tiltedOf = (r: MetricsRow, key: TableColumn): MetricResult | undefined => (key === HORIZON_LEVEL_KEY ? undefined : r.tilted?.[key]);

const shown = (r: MetricsRow, key: TableColumn): MetricResult => tiltedOf(r, key) ?? cellOf(r, key);

/** The difference of two shown values; missing (with the reason) when either side is. */
function difference(mine: MetricResult, theirs: MetricResult): MetricResult {
  return mine.value !== null && theirs.value !== null
    ? { value: mine.value - theirs.value }
    : { value: null, reason: mine.value === null ? (mine.reason ?? 'no value for this file') : 'the reference file has no value' };
}

/**
 * The rows with the reference file's row marked. With `delta`, every other row's cells and gain become the difference
 * from the reference (the value a cell shows, i.e. the tilted one under a simulation, minus the reference's); a value
 * is missing when either side is. The reference row keeps its own values (the tilted ones, as a single number, in the
 * difference view under a simulation). The rows are returned as given (not marked)
 * when the reference has no row.
 */
export function markReference(rows: MetricsRow[], referenceId: string | null, delta: boolean): MetricsRow[] {
  const ref = referenceId === null ? undefined : rows.find((r) => r.id === referenceId);
  if (!ref) return rows;
  return rows.map((r) => {
    // The reference keeps its own values; under a simulation in the difference view it shows its tilted value only (like every other row).
    if (r.id === ref.id) {
      if (!delta || !r.tilted) return { ...r, isReference: true };
      const cells = { ...r.cells, ...r.tilted };
      return { ...r, cells, tilted: undefined, isReference: true };
    }
    if (!delta) return r;
    const cells = {} as Record<MetricColumn, MetricResult>;
    for (const { key } of METRIC_COLUMNS) cells[key] = difference(shown(r, key), shown(ref, key));
    const gain = r.gain !== null && ref.gain !== null ? r.gain - ref.gain : null;
    const hLevel = r.hLevel || ref.hLevel ? { hLevel: difference(shown(r, HORIZON_LEVEL_KEY), shown(ref, HORIZON_LEVEL_KEY)) } : {};
    return { ...r, cells, gain, ...hLevel, tilted: undefined, isDelta: true };
  });
}

export type SortKey = 'file' | 'group' | 'freq' | 'gain' | TableColumn;
export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

/** Header click: ascending, then descending, then unsorted; another column starts ascending. */
export function nextSort(current: SortState | null, key: SortKey): SortState | null {
  if (current?.key !== key) return { key, dir: 'asc' };
  return current.dir === 'asc' ? { key, dir: 'desc' } : null;
}

export function ariaSort(sort: SortState | null, key: SortKey): 'ascending' | 'descending' | 'none' {
  if (sort?.key !== key) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}

/** The value a column sorts by; an `original → tilted` cell sorts by its tilted value. `null` = missing ("—"). */
export function sortValue(row: MetricsRow, key: SortKey): number | string | null {
  switch (key) {
    case 'file':
      return row.file;
    case 'group':
      return row.group;
    case 'freq':
      return row.freq;
    case 'gain':
      return row.gain;
    default:
      return shown(row, key).value;
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The rows with the reference row first when the rows are differences from it (rows not in the difference view come back as given). */
function pinReference(rows: MetricsRow[]): MetricsRow[] {
  const at = rows.findIndex((r) => r.isReference);
  if (at <= 0 || !rows.some((r) => r.isDelta)) return rows;
  return [rows[at], ...rows.slice(0, at), ...rows.slice(at + 1)];
}

/**
 * A sorted copy of the rows; missing values stay last in both directions, ties keep their order. In the difference view
 * the reference row is the baseline and stays first whatever the sort; the others sort by their differences.
 */
export function sortRows(rows: MetricsRow[], sort: SortState | null): MetricsRow[] {
  return pinReference(sortByKey(rows, sort));
}

function sortByKey(rows: MetricsRow[], sort: SortState | null): MetricsRow[] {
  if (!sort) return rows;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, sort.key) }))
    .sort((p, q) => {
      if (p.value === null || q.value === null) {
        if (p.value === q.value) return p.index - q.index;
        return p.value === null ? 1 : -1;
      }
      const c =
        typeof p.value === 'number' && typeof q.value === 'number'
          ? p.value - q.value
          : collator.compare(String(p.value), String(q.value));
      return c !== 0 ? sign * c : p.index - q.index;
    })
    .map((x) => x.row);
}

/**
 * New `scrollTop` of the table wrapper that shows a row (`top` is its offset in the table) fully,
 * below the sticky header; unchanged when it is already visible.
 */
export function revealScrollTop(
  row: { top: number; height: number },
  view: { scrollTop: number; clientHeight: number; headerHeight: number },
): number {
  if (row.top - view.headerHeight < view.scrollTop) return Math.max(0, row.top - view.headerHeight);
  const bottom = row.top + row.height;
  if (bottom > view.scrollTop + view.clientHeight) return bottom - view.clientHeight;
  return view.scrollTop;
}

interface Box { left: number; right: number; top: number; bottom: number }

/**
 * How far the table wrapper must scroll (`dx`, `dy`, added to scrollLeft / scrollTop) so a cell is fully inside `area`
 * and not under the sticky File column (`coveredLeft` wide) or the sticky header (`coveredTop` high).
 */
export function clearOfSticky(cell: Box, area: Box, coveredLeft: number, coveredTop: number): { dx: number; dy: number } {
  const edge = (lo: number, hi: number, areaLo: number, areaHi: number, covered: number) =>
    lo < areaLo + covered ? lo - (areaLo + covered) : hi > areaHi ? hi - areaHi : 0;
  return {
    dx: edge(cell.left, cell.right, area.left, area.right, coveredLeft),
    dy: edge(cell.top, cell.bottom, area.top, area.bottom, coveredTop),
  };
}

const FIXED_SORT_KEYS: readonly SortKey[] = ['file', 'group', 'freq', 'gain'];

/** The sort, or null when it orders by a metric column that is not displayed (a sort nobody can see or clear). */
export function sortIfShown(sort: SortState | null, columns: readonly { key: TableColumn }[]): SortState | null {
  if (!sort) return null;
  if (FIXED_SORT_KEYS.includes(sort.key) || columns.some((c) => c.key === sort.key)) return sort;
  return null;
}

/**
 * Whether the table should scroll the highlighted row into view: only when the highlighted id or
 * the sort changed since the last time, never because the rows were rebuilt (slider ticks, gain unit).
 */
export function shouldReveal(
  prev: { id: string | null; sort: SortState | null } | null,
  cur: { id: string | null; sort: SortState | null },
): boolean {
  if (cur.id === null) return false;
  if (!prev) return true;
  return prev.id !== cur.id || prev.sort?.key !== cur.sort?.key || prev.sort?.dir !== cur.sort?.dir;
}

/**
 * Decimals of the columns that need more than the table's one (shown, copied) and the CSV's two: the lower region
 * ratio is a few thousandths of a percent to a few tenths, so the usual format would read 0.0 on almost every file.
 */
const DECIMALS: Partial<Record<TableColumn, { shown: number; csv: number }>> = { areLower: { shown: 3, csv: 4 } };
const shownDecimals = (key: TableColumn): number => DECIMALS[key]?.shown ?? 1;
const csvDecimals = (key: TableColumn): number => DECIMALS[key]?.csv ?? 2;

/** Whether the frequency chart of a column fits its y axis to the data: its values are tiny against the unit's usual span. */
export const chartFitsData = (key: TableColumn): boolean => DECIMALS[key] !== undefined;

/** The most decimals a small difference is written with. */
const MAX_DELTA_DECIMALS = 7;

/**
 * Decimals of a difference in such a column: the column's own, or as many more as it takes for a difference that is
 * not zero to show a digit (two files that differ must not both read 0.000).
 */
function deltaDecimals(key: TableColumn, v: number | null): number {
  const usual = shownDecimals(key);
  if (v === null || v === 0 || DECIMALS[key] === undefined || Number(v.toFixed(usual)) !== 0) return usual;
  for (let d = usual + 1; d <= MAX_DELTA_DECIMALS; d++) if (Number(v.toFixed(d)) !== 0) return d;
  return usual;
}

/**
 * Decimals of an original → simulated pair in such a column: the column's own, or as many more as it takes for the
 * smaller value that is not zero to show a digit ("0.0009 → 0.0002", not "0.001 → 0.000", which reads as "to nothing").
 */
function pairDecimals(key: TableColumn, a: number | null, b: number | null): number {
  const usual = shownDecimals(key);
  const own = DECIMALS[key];
  if (own === undefined) return usual;
  const d = Math.max(deltaDecimals(key, a), deltaDecimals(key, b));
  // Two values that differ are not written as one: up to the CSV's decimals, as many as it takes for them to read
  // differently ("0.0007 → 0.0012", not "0.001"); values equal there are shown once. As the band statistics do.
  if (a === null || b === null || a === b) return d;
  for (let finer = d; finer <= own.csv; finer++) if (fixed(a, finer) !== fixed(b, finer)) return finer;
  return d;
}

const fmt = (v: number | null, decimals = 2) => (v === null ? '' : fixed(v, decimals));
/** One CSV field, quoted only where CSV syntax needs it. */
export const csvCell = (raw: string) => (/[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw);

/** A CSV field of user-influenced text (file, group or dataset names): a leading = + - @ tab or CR gets a leading quote so a spreadsheet does not run it as a formula. */
export const csvText = (raw: string) => csvCell(formulaSafe(raw));

/** `raw` with a leading quote when a spreadsheet would run it as a formula (leading = + - @ tab or CR). */
export function formulaSafe(raw: string): string {
  return /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
}

/** The Group cell of a CSV row: the app's own generated label as is (a polarization sign is not a formula), anything else as user text. */
const groupCsv = (r: MetricsRow): string => (r.generatedGroup ? csvCell(r.group) : csvText(r.group));

/** The Group cell of a tab-separated row, the same rule. */
const groupTsv = (r: MetricsRow): string => (r.generatedGroup ? tabSafe(r.group) : tsvText(r.group));

/** A tab or line break becomes a space, so text cannot split a tab-separated cell or line (for computed text, which needs no formula guard). */
export const tabSafe = (raw: string): string => raw.replace(/[\t\r\n]+/g, ' ');

/** One tab-separated field of user-influenced text: formula-guarded as in the CSV, and a tab or line break becomes a space so it cannot split the cell. */
export const tsvText = (raw: string): string => tabSafe(formulaSafe(raw));

const shownValue = (r: MetricResult, decimals: number) => (r.value === null ? '—' : fixed(r.value, decimals));

/** A difference as shown: signed, one decimal ("+1.2", "−0.4" as "-0.4", "0.0" when it rounds to zero). */
export const signedOneDecimal = (v: number | null): string => signedDecimals(v, 1);

/** A difference as shown, with the column's decimals: signed, and without a sign when it rounds to zero. */
function signedDecimals(v: number | null, decimals: number): string {
  if (v === null) return '—';
  const rounded = Number(v.toFixed(decimals));
  return rounded === 0 ? (0).toFixed(decimals) : rounded > 0 ? `+${rounded.toFixed(decimals)}` : rounded.toFixed(decimals);
}

/** Said in the tooltip of a cell that shows one value for an original and a tilted result that read the same. */
const equalNote = (w: PairWords): string => (w === TILT_WORDS ? 'original and tilted are equal under the simulation' : `${w.from} and ${w.to} are equal`);

/**
 * What a cell shows: the value, or `original → tilted` where the two shown texts differ (equal ones show once, with
 * `equal` set when the tooltip is only that note); one decimal unless the column has its own (`decimals`).
 */
export function formatCell(
  original: MetricResult,
  tilted?: MetricResult,
  decimals = 1,
  /** What the two values are called in the tooltip (see `pairWords`). */
  words: PairWords = TILT_WORDS,
): { text: string; title?: string; equal?: true } {
  if (!tilted) return { text: shownValue(original, decimals), title: original.reason };
  const EQUAL_NOTE = equalNote(words);
  const reasons = [
    original.reason ? `${words.from}: ${original.reason}` : '',
    tilted.reason ? `${words.to}: ${tilted.reason}` : '',
  ].filter(Boolean);
  const [from, to] = [shownValue(original, decimals), shownValue(tilted, decimals)];
  if (from === to) {
    return reasons.length
      ? { text: from, title: [EQUAL_NOTE, ...reasons].join('\n') }
      : { text: from, title: EQUAL_NOTE, equal: true };
  }
  return { text: `${from} → ${to}`, ...(reasons.length ? { title: reasons.join('\n') } : {}) };
}

const signedDeg = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export function simulationLabel(t: TiltSettings, offsetCount = 0, groupCount = 0): string {
  const base = `Simulated: Δe ${signedDeg(t.electricalDeg)}°, mech ${signedDeg(t.mechanicalDeg)}°`;
  const parts = [
    offsetCount > 0 ? `${offsetCount} file${offsetCount === 1 ? '' : 's'}` : '',
    groupCount > 0 ? `${groupCount} group${groupCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return parts.length ? `${base} + offsets on ${parts.join(', ')}` : base;
}

/** The non-zero parts of a file's offsets, e.g. "Δe +1°, mech +2°, az -30°". */
export function offsetLabel(o: SimSettings): string {
  return [
    o.electricalDeg ? `Δe ${signedDeg(o.electricalDeg)}°` : '',
    o.mechanicalDeg ? `mech ${signedDeg(o.mechanicalDeg)}°` : '',
    o.azimuthDeg ? `az ${signedDeg(o.azimuthDeg)}°` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/** The columns that say what tilt was applied to each row (the sliders plus the file's and its group's offsets). */
const TILT_COLUMNS = ['Electrical tilt Δ (°)', 'Mechanical tilt (°)'];
/** The column that says where each file points on the plot (the azimuth slider plus the file's and its group's offsets). */
const AZIMUTH_COLUMN = 'Azimuth pointing (°)';
/** A row's values under those columns. */
const simCells = (e: SimSettings, withTilt: boolean): string[] => [...(withTilt ? [String(e.electricalDeg), String(e.mechanicalDeg)] : []), String(e.azimuthDeg)];

export function toCsv(
  rows: MetricsRow[],
  gainUnit: GainUnit,
  fbWindowDeg: number,
  sim?: SimSettings | ((id: string) => SimSettings),
  uslsRangeDeg = 20,
  levelDb = 3,
  deltaVs?: string,
  deltaTilted = false,
  columns: readonly ColumnSpec[] = CSV_DEFAULT_COLUMNS,
  /** The 3D method the angular-region estimate was computed with; named in the headers of its columns. */
  method3d: MethodName = 'summation',
  /** The simulated values of the horizontal columns are of the cut at the horizon: their headers say so. */
  horizonCut = false,
  /** Some file is tilted. Without a tilt (the cut at the horizon alone) no header says "tilted": see `pairWords`. */
  tiltActive = true,
): string {
  const horizonOnly = horizonCut && !tiltActive;
  const simFor = typeof sim === 'function' ? sim : sim ? () => sim : undefined;
  // The difference view has one column per metric (the difference of the shown values), whatever the simulation.
  const tilted = deltaVs === undefined && (typeof sim === 'function' ? rows.some((r) => r.tilted) : sim !== undefined && isTilted(sim));
  // What was applied to each row is said in both views: the difference view's values are of simulated ones (`deltaTilted`).
  const tiltColumns = simFor !== undefined && (tilted || (deltaVs !== undefined && deltaTilted));
  // The azimuth only turns the drawing: it doubles no column, but where a file is turned the export says where it points.
  const turned = simFor !== undefined && rows.some((r) => simFor(r.id).azimuthDeg !== 0);
  const withSource = rows.some((r) => r.source !== r.file);
  // The Horizon level is one value per row (a file cut has none), so it has one column where the others have two.
  const paired = (c: ColumnSpec): boolean => tilted && c.key !== HORIZON_LEVEL_KEY;
  const metricHeader = columns.flatMap((c) => {
    const label = withMethod(c.key, columnLabel(c, fbWindowDeg, uslsRangeDeg, levelDb), method3d);
    if (c.key === HORIZON_LEVEL_KEY && deltaVs === undefined) return [`${label} ${methodNamed(HORIZON_TAG, method3d)} (${c.unit})`];
    if (!tilted) return [columnHeader(label, c.unit, deltaVs, deltaTilted, horizonTag(c.key, horizonCut && deltaTilted, method3d), horizonOnly, method3d)];
    // With no tilt the second value of a horizontal column is the horizon cut; the others are the simulated run's (equal to the file's).
    const second = horizonOnly ? (isHorizontal(c.key) ? methodNamed(AT_HORIZON_TAG, method3d) : 'simulated') : `tilted${horizonTag(c.key, horizonCut, method3d)}`;
    return [`${label} original (${c.unit})`, `${label} ${second} (${c.unit})`];
  });
  const header = [
    'File',
    ...(withSource ? ['Source file'] : []),
    'Group',
    ...(deltaVs !== undefined ? ['Row'] : []),
    'Frequency (MHz)',
    columnHeader('Gain', gainUnit, deltaVs, deltaTilted),
    ...metricHeader,
    ...(tiltColumns ? TILT_COLUMNS : []),
    ...(tiltColumns || turned ? [AZIMUTH_COLUMN] : []),
  ];
  const lines = rows.map((r) => [
    csvText(r.file),
    ...(withSource ? [csvText(r.source)] : []),
    groupCsv(r),
    ...[
      ...(deltaVs !== undefined ? [rowRole(r)] : []),
      String(r.freq),
      fmt(r.gain),
      ...columns.flatMap((c) =>
        paired(c)
          ? [fmt(cellOf(r, c.key).value, csvDecimals(c.key)), fmt(shown(r, c.key).value, csvDecimals(c.key))]
          : [fmt(shown(r, c.key).value, csvDecimals(c.key))],
      ),
      ...((tiltColumns || turned) && simFor ? simCells(simFor(r.id), tiltColumns) : []),
    ].map(csvCell),
  ]);
  return [header.map(csvCell), ...lines].map((l) => l.join(',')).join('\r\n') + '\r\n';
}

/** The text a table cell shows for a row and column (`original → tilted` under a simulation). */
export const cellText = (r: MetricsRow, key: TableColumn): string => rowCell(r, key).text;

/** What a row's cell shows (and its tooltip): the difference in the difference view, else the value (`original → tilted` under a simulation). */
export function rowCell(r: MetricsRow, key: TableColumn, words: PairWords = TILT_WORDS): { text: string; title?: string; equal?: true } {
  const cell = cellOf(r, key);
  if (r.isDelta) return { text: signedDecimals(cell.value, deltaDecimals(key, cell.value)), title: cell.reason };
  const tilted = tiltedOf(r, key);
  return formatCell(cell, tilted, tilted ? pairDecimals(key, cell.value, tilted.value) : shownDecimals(key), words);
}

/** Header text of a metric column: with a reference, the difference view says "Δ vs <name>". */
const columnHeader = (label: string, unit: string, deltaVs?: string, tilted = false, tag = '', horizonOnly = false, method3d: MethodName = 'summation'): string => {
  if (deltaVs === undefined) return `${label} (${unit})`;
  // With no tilt the differences are of horizon-cut values on the horizontal columns (tagged) and of the file's own elsewhere.
  if (horizonOnly) return `${label} Δ vs ${deltaVs}${tag ? ` ${methodNamed(AT_HORIZON_TAG, method3d)}` : ''} (${unit})`;
  return `${label} Δ vs ${deltaVs}${tilted && label !== 'Gain' ? `, tilted values${tag}` : ''} (${unit})`;
};

/** The "Row" column of the difference view's exports: which row is the baseline, so a "Δ vs …" column can be filtered. */
const rowRole = (r: MetricsRow): string => (r.isReference ? 'reference' : 'difference');

/** What the Gain cell shows: the value, or the signed difference in the difference view. */
export const gainText = (r: MetricsRow): string => (r.gain === null ? '—' : r.isDelta ? signedTwoDecimals(r.gain) : fixed(r.gain, 2));

function signedTwoDecimals(v: number): string {
  const rounded = Number(v.toFixed(2));
  return rounded === 0 ? '0.00' : rounded > 0 ? `+${rounded.toFixed(2)}` : rounded.toFixed(2);
}

type CopyColumn = { key: TableColumn; label: string; unit: string };

/** The values of one row as shown (file, group, MHz, gain, then the columns), tab-separated, no header. */
export function rowToTsv(r: MetricsRow, columns: readonly CopyColumn[], withRole = false): string {
  return [tsvText(r.file), groupTsv(r), ...(withRole ? [rowRole(r)] : []), String(r.freq), gainText(r), ...columns.map((c) => cellText(r, c.key))].join('\t');
}

/**
 * The visible table as text for a spreadsheet: a header row (the headers as shown) and a line per row in the
 * current order, tab-separated, with the values exactly as the cells show them.
 */
export function toTsv(
  rows: readonly MetricsRow[],
  columns: readonly CopyColumn[],
  gainUnit: GainUnit,
  fbWindowDeg: number,
  uslsRangeDeg = 20,
  levelDb = 3,
  deltaVs?: string,
  deltaTilted = false,
  /** The 3D method the angular-region estimate was computed with; named in the headers of its columns. */
  method3d: MethodName = 'summation',
  /** Tilted values are shown and those of the horizontal columns are of the cut at the horizon: their headers say so. */
  horizonCut = false,
  /** Some file is tilted. Without a tilt (the cut at the horizon alone) no header says "tilted": see `pairWords`. */
  tiltActive = true,
  /**
   * Each row's simulation settings. Used in the difference view under a simulation only: its cells are single
   * differences of simulated values, so the copied table says what was applied to each row (as the CSV does). Without
   * the difference view the table is copied as shown.
   */
  simFor?: (id: string) => SimSettings,
): string {
  const horizonOnly = horizonCut && !tiltActive;
  const withRole = deltaVs !== undefined;
  const tiltColumns = simFor !== undefined && deltaVs !== undefined && deltaTilted;
  // Without the difference view a cell reads `original → tilted`: the header says which cut the tilted value is of.
  const labelOf = (c: CopyColumn): string => {
    const label = withMethod(c.key, columnLabel(c, fbWindowDeg, uslsRangeDeg, levelDb), method3d);
    // (The Horizon level is a single value, not a pair: its header needs no such note.)
    if (deltaVs !== undefined || !horizonCut) return label;
    // (The Horizon level is a single value, not a pair: its header says only which reconstruction it is read from.)
    if (c.key === HORIZON_LEVEL_KEY) return `${label} [${methodFull(method3d)}]`;
    return isHorizontal(c.key) ? `${label} ${methodNamed(horizonOnly ? AT_HORIZON_TAG : '[tilted: horizon cut]', method3d)}` : label;
  };
  const header = [
    'File',
    'Group',
    ...(withRole ? ['Row'] : []),
    'MHz',
    columnHeader('Gain', gainUnit, deltaVs, deltaTilted),
    ...columns.map((c) => columnHeader(labelOf(c), c.unit, deltaVs, deltaTilted, horizonTag(c.key, horizonCut && deltaTilted, method3d), horizonOnly, method3d)),
    ...(tiltColumns ? [...TILT_COLUMNS, AZIMUTH_COLUMN] : []),
  ];
  const line = (r: MetricsRow): string => [rowToTsv(r, columns, withRole), ...(tiltColumns ? simCells(simFor(r.id), true) : [])].join('\t');
  return [header.map(tsvText).join('\t'), ...rows.map(line)].join('\r\n') + '\r\n';
}
