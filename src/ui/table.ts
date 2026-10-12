import type { GainUnit, MetricResult } from '../core/types';
import type { PatternMetrics } from '../core/analysis/metrics';
import type { GroupView } from '../state/selectors';
import { isTilted, type TiltSettings, type SimSettings } from '../core/analysis/tilt';
import { convertGain } from '../core/gain';
import { nameOf } from '../core/names';
import type { ColumnGroupKey } from '../state/store';
import type { Method3d } from '../core/analysis/pattern3d';
import { bwName } from './bwLabel';
import { fixed } from './fixed';
import { METRIC_KEYS, type MetricColumn } from '../state/metricKeys';

export { METRIC_KEYS, type MetricColumn, fixed };

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

const CSV_DEFAULT_COLUMNS = METRIC_COLUMNS.filter((c) => c.group !== ON_DEMAND_GROUP);

/** Whether the angular-region estimate has to be computed: its group is shown, or the frequency chart plots one of its columns. */
export function needsAngularRegions(groups: Record<ColumnGroupKey, boolean>, freqMetric: MetricColumn): boolean {
  return groups[ON_DEMAND_GROUP] || COLUMN_INFO[freqMetric].group === ON_DEMAND_GROUP;
}

const METHOD_NAME: Record<Method3d, string> = { summation: 'Summation', weighted: 'Weighted' };

/**
 * A column's label where its numbers leave the table (CSV and copied headers, the frequency chart's axis and caption):
 * the angular-region estimate carries the 3D method, which changes it by several points; every other label is as given.
 */
export function withMethod(key: MetricColumn, label: string, method: Method3d): string {
  return COLUMN_INFO[key].group === ON_DEMAND_GROUP ? `${label}, ${METHOD_NAME[method]}` : label;
}

/** The second half of the three angular-region tooltips: what kind of number this is. */
const areNote = (method: Method3d): string =>
  `Estimate from the two co-polar cuts, integrated over the 3D reconstruction (3D method: ${METHOD_NAME[method]}, chosen in the Simulation bar); not BASTA-compliant, which needs the measured full sphere and total power. Beam Type A (macro) only: — when V-HPBW is outside 0.5–25° or H-HPBW outside 50–130°`;

/** Header text for a column; the beamwidth, F/B window and USLS window labels depend on the current settings. */
export function columnLabel(c: { key: MetricColumn; label: string }, fbWindowDeg: number, uslsRangeDeg = 20, levelDb = 3): string {
  if (c.key === 'hHpbw') return `H-${bwName(levelDb)}`;
  if (c.key === 'vHpbw') return `V-${bwName(levelDb)}`;
  if (c.key === 'dH') return `H-${bwName(levelDb)} − decl.`;
  if (c.key === 'dV') return `V-${bwName(levelDb)} − decl.`;
  if (c.key === 'fbWindow') return `F/B ±${fbWindowDeg}°`;
  if (c.key === 'usls') return `USLS peak to ${uslsRangeDeg}°`;
  if (c.key === 'uslsHorizon') return `USLS horizon to ${uslsRangeDeg}°`;
  return c.label;
}

const DU_DB: Partial<Record<MetricColumn, number>> = { du16: 15, du64: 20, du256: 25 };

/** Header tooltip for a column; the sector columns depend on the sector settings (E, S). */
export function columnTitle(
  key: MetricColumn,
  settings: { sectorEdgeDeg: number; siteSectors: number; uslsRangeDeg?: number; lobeLimitFactor?: number; levelDb?: number; fbWindowDeg?: number; method3d?: Method3d },
): string | undefined {
  const e = settings.sectorEdgeDeg;
  const r = settings.uslsRangeDeg ?? 20;
  const f = settings.lobeLimitFactor ?? 1.78;
  const level = settings.levelDb ?? 3;
  const w = settings.fbWindowDeg ?? 30;
  const method = settings.method3d ?? 'summation';
  switch (key) {
    case 'hHpbw':
      return `Horizontal ${level === 3 ? 'half-power ' : ''}beamwidth (BASTA 6.1.6): distance between the two points ${level} dB below the peak of the azimuth cut`;
    case 'vHpbw':
      return `Vertical ${level === 3 ? 'half-power ' : ''}beamwidth (BASTA 6.1.6): distance between the two points ${level} dB below the peak of the elevation cut`;
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
      return `Sector efficiency (after BASTA 7.2.4): power in the service region (within ±${e}° of boresight, from half a V-HPBW above the beam peak down to 75° below the horizon) as a share of the power over the whole sphere. ${areNote(method)}`;
    case 'areSpatial':
      return `Spatial efficiency (after BASTA 7.2.4): power in the service region (within ±${e}° of boresight) as a share of the power in the service and interference regions together (all azimuths, from one V-HPBW above the beam peak, at most the horizon, down to 75° below the horizon). ${areNote(method)}`;
    case 'areLower':
      return `Lower region ratio (after BASTA 7.2.4): power from 75° below the horizon to straight down, all azimuths, as a share of the power over the whole sphere. ${areNote(method)}`;
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

const shown = (r: MetricsRow, key: MetricColumn): MetricResult => r.tilted?.[key] ?? r.cells[key];

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
    for (const { key } of METRIC_COLUMNS) {
      const mine = shown(r, key);
      const theirs = shown(ref, key);
      cells[key] =
        mine.value !== null && theirs.value !== null
          ? { value: mine.value - theirs.value }
          : { value: null, reason: mine.value === null ? (mine.reason ?? 'no value for this file') : 'the reference file has no value' };
    }
    const gain = r.gain !== null && ref.gain !== null ? r.gain - ref.gain : null;
    return { ...r, cells, gain, tilted: undefined, isDelta: true };
  });
}

export type SortKey = 'file' | 'group' | 'freq' | 'gain' | MetricColumn;
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
      return (row.tilted?.[key] ?? row.cells[key]).value;
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
export function sortIfShown(sort: SortState | null, columns: readonly { key: MetricColumn }[]): SortState | null {
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

const fmt = (v: number | null) => (v === null ? '' : fixed(v, 2));
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

const oneDecimal = (r: MetricResult) => (r.value === null ? '—' : fixed(r.value, 1));

/** A difference as shown: signed, one decimal ("+1.2", "−0.4" as "-0.4", "0.0" when it rounds to zero). */
export function signedOneDecimal(v: number | null): string {
  if (v === null) return '—';
  const rounded = Number(v.toFixed(1));
  return rounded === 0 ? '0.0' : rounded > 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}

export function formatCell(original: MetricResult, tilted?: MetricResult): { text: string; title?: string } {
  if (!tilted) return { text: oneDecimal(original), title: original.reason };
  const reasons = [
    original.reason ? `original: ${original.reason}` : '',
    tilted.reason ? `tilted: ${tilted.reason}` : '',
  ].filter(Boolean);
  return {
    text: `${oneDecimal(original)} → ${oneDecimal(tilted)}`,
    ...(reasons.length ? { title: reasons.join('\n') } : {}),
  };
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

export function toCsv(
  rows: MetricsRow[],
  gainUnit: GainUnit,
  fbWindowDeg: number,
  sim?: SimSettings | ((id: string) => SimSettings),
  uslsRangeDeg = 20,
  levelDb = 3,
  deltaVs?: string,
  deltaTilted = false,
  columns: readonly (typeof METRIC_COLUMNS)[number][] = CSV_DEFAULT_COLUMNS,
  /** The 3D method the angular-region estimate was computed with; named in the headers of its columns. */
  method3d: Method3d = 'summation',
): string {
  const simFor = typeof sim === 'function' ? sim : sim ? () => sim : undefined;
  // The difference view has one column per metric (the difference of the shown values), whatever the simulation.
  const tilted = deltaVs === undefined && (typeof sim === 'function' ? rows.some((r) => r.tilted) : sim !== undefined && isTilted(sim));
  const withSource = rows.some((r) => r.source !== r.file);
  const metricHeader = columns.flatMap((c) => {
    const label = withMethod(c.key, columnLabel(c, fbWindowDeg, uslsRangeDeg, levelDb), method3d);
    return tilted ? [`${label} original (${c.unit})`, `${label} tilted (${c.unit})`] : [columnHeader(label, c.unit, deltaVs, deltaTilted)];
  });
  const header = [
    'File',
    ...(withSource ? ['Source file'] : []),
    'Group',
    ...(deltaVs !== undefined ? ['Row'] : []),
    'Frequency (MHz)',
    columnHeader('Gain', gainUnit, deltaVs, deltaTilted),
    ...metricHeader,
    ...(tilted ? ['Electrical tilt Δ (°)', 'Mechanical tilt (°)', 'Azimuth (°)'] : []),
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
        tilted
          ? [fmt(r.cells[c.key].value), fmt((r.tilted?.[c.key] ?? r.cells[c.key]).value)]
          : [fmt(shown(r, c.key).value)],
      ),
      ...(tilted && simFor
        ? (() => {
            const e = simFor(r.id);
            return [String(e.electricalDeg), String(e.mechanicalDeg), String(e.azimuthDeg)];
          })()
        : []),
    ].map(csvCell),
  ]);
  return [header.map(csvCell), ...lines].map((l) => l.join(',')).join('\r\n') + '\r\n';
}

/** The text a table cell shows for a row and column (`original → tilted` under a simulation). */
export const cellText = (r: MetricsRow, key: MetricColumn): string => rowCell(r, key).text;

/** What a row's cell shows (and its tooltip): the difference in the difference view, else the value (`original → tilted` under a simulation). */
export function rowCell(r: MetricsRow, key: MetricColumn): { text: string; title?: string } {
  if (r.isDelta) return { text: signedOneDecimal(r.cells[key].value), title: r.cells[key].reason };
  return formatCell(r.cells[key], r.tilted?.[key]);
}

/** Header text of a metric column: with a reference, the difference view says "Δ vs <name>". */
const columnHeader = (label: string, unit: string, deltaVs?: string, tilted = false): string =>
  deltaVs === undefined ? `${label} (${unit})` : `${label} Δ vs ${deltaVs}${tilted && label !== 'Gain' ? ', tilted values' : ''} (${unit})`;

/** The "Row" column of the difference view's exports: which row is the baseline, so a "Δ vs …" column can be filtered. */
const rowRole = (r: MetricsRow): string => (r.isReference ? 'reference' : 'difference');

/** What the Gain cell shows: the value, or the signed difference in the difference view. */
export const gainText = (r: MetricsRow): string => (r.gain === null ? '—' : r.isDelta ? signedTwoDecimals(r.gain) : fixed(r.gain, 2));

function signedTwoDecimals(v: number): string {
  const rounded = Number(v.toFixed(2));
  return rounded === 0 ? '0.00' : rounded > 0 ? `+${rounded.toFixed(2)}` : rounded.toFixed(2);
}

type CopyColumn = { key: MetricColumn; label: string; unit: string };

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
  method3d: Method3d = 'summation',
): string {
  const withRole = deltaVs !== undefined;
  const header = [
    'File',
    'Group',
    ...(withRole ? ['Row'] : []),
    'MHz',
    columnHeader('Gain', gainUnit, deltaVs, deltaTilted),
    ...columns.map((c) => columnHeader(withMethod(c.key, columnLabel(c, fbWindowDeg, uslsRangeDeg, levelDb), method3d), c.unit, deltaVs, deltaTilted)),
  ];
  return [header.map(tsvText).join('\t'), ...rows.map((r) => rowToTsv(r, columns, withRole))].join('\r\n') + '\r\n';
}
