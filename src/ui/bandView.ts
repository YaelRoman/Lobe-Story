import { BAND_PARAMS, bandParamLabel, cellOf, cellText, fineDecimals, pairDecimals, simulatedOnly, tiltText, type BandCell, type BandColumn, type BandParam, type BandParamKey } from '../core/analysis/bandParams';
import type { Method3d } from '../core/analysis/pattern3d';
import { MIN_SAMPLES } from '../core/analysis/bandStats';
import { bandDiff, type BandDiff } from '../core/analysis/bandCompare';
import type { AnalysisSettings } from '../core/analysis/metrics';
import { inSubBand, sanitizeSubBands, subBandName, type BandDataset, type SubBand } from '../core/analysis/subBands';
import { FIRST_LOBE_RANGE } from '../core/analysis/sidelobes';
import { fixed } from './fixed';
import { settingText } from './bwLabel';
import { AT_HORIZON_TAG, csvCell, csvText, formulaSafe, tabSafe, TILT_WORDS, tsvText, type PairWords } from './table';
import { hCutLabel } from './simSummary';
import type { HCutMode } from '../core/analysis/tilt';

/** The band parameters read from the horizontal cut: the ones the horizontal cut at the horizon changes. The rest are read from the vertical cut or declared, and are the file's own with no tilt. */
const BAND_FOLLOWS_H_CUT: ReadonlySet<BandParamKey> = new Set<BandParamKey>(['hHpbw', 'horizonLevel', 'squint', 'fbWindow', 'hSls', 'tracking', 'rollOff', 'air']);
export const bandFollowsHCut = (key: BandParamKey): boolean => BAND_FOLLOWS_H_CUT.has(key);

/**
 * How the histogram of a band parameter is marked: simulated (the "(tilted)" on screen, the `-simulated` file name, the
 * caption line) when a file is tilted or the parameter follows the horizontal cut and that cut is at the horizon; and
 * whether the caption line names the horizontal cut (only for a parameter that follows it).
 */
export function bandHistogramMarks(key: BandParamKey | undefined, simulatedAmong: (hCutCounts: boolean) => boolean): { simulated: boolean; namesHCut: boolean } {
  const namesHCut = key !== undefined && bandFollowsHCut(key);
  return { simulated: simulatedAmong(namesHCut), namesHCut };
}

/**
 * What a table cell shows: `original → tilted` only where the two texts differ. A row with its own decimals writes a
 * pair with as many more as it takes for neither value to read 0 when it is not (as the metrics table). A row of the
 * simulated cut alone (the Horizon level) shows its simulated value only, as the metrics table's single column.
 */
export function cellDisplay(original: BandCell, tilted?: BandCell, words: PairWords = TILT_WORDS): { text: string; title: string; muted: boolean } {
  const shown = tilted ?? original;
  const muted = shown.state !== 'ok';
  if (tilted && simulatedOnly(tilted.key)) return { text: tilted.text, title: tilted.title, muted };
  if (!tilted) return { text: original.text, title: original.title, muted };
  // A row with its own decimals is compared at the pair's precision: two values that differ there are not shown as one.
  const decimals = pairDecimals(original, tilted);
  const [from, to] = decimals === (original.decimals ?? 1) ? [original.text, tilted.text] : [cellText(original, decimals), cellText(tilted, decimals)];
  if (from === to) return { text: original.text, title: original.title, muted };
  return {
    text: `${from} → ${to}`,
    title: `${words.from}: ${original.title}\n${words.to}: ${tilted.title}`,
    muted,
  };
}

/** The sentence of the band note while a simulation is active: what a pair of values in a cell is. */
export const bandStateNote = (hCut: HCutMode, tiltActive: boolean): string =>
  hCut === 'horizon' && !tiltActive
    ? 'Horizontal cut at the horizon: cells show file cut → horizon cut where they differ.'
    : `Simulation active: cells show original → tilted where they differ (${hCutLabel(hCut)}).`;

/** The intro's sentence on the rows that are not BASTA Annex C parameters, or null while there are none. */
export function beyondAnnexNote(horizonLevel: boolean, angularRegions: boolean): string | null {
  if (horizonLevel && angularRegions) return 'The Horizon level and angular-region estimate rows are not BASTA parameters; they are summarised the same way.';
  if (horizonLevel) return 'The Horizon level row is not a BASTA parameter; it is summarised the same way.';
  if (angularRegions) return 'The angular-region estimate rows are not BASTA parameters; they are summarised the same way.';
  return null;
}

/** Shown under the table while some visible cell ends in `*`. */
export const ADJUSTED_LEGEND = '* adjusted by the 3 dB excursion rule (BASTA 12.2)';

export function anyAdjusted(columns: readonly BandColumn[], tilted?: readonly BandColumn[] | null): boolean {
  return [...columns, ...(tilted ?? [])].some((c) => Object.values(c.cells).some((cell) => cell?.adjusted === true));
}

export function largestDataset(datasets: readonly BandDataset[]): number {
  return datasets.reduce((m, d) => Math.max(m, d.items.length), 0);
}

/** What the band statistics say of a beamwidth level other than half power, else null. */
export function levelNote(levelDb: number): string | null {
  return levelDb === 3 ? null : `Beamwidth level is ${settingText(levelDb)} dB: the beamwidth, squint and tilt rows are not half-power values.`;
}

/** Warning for a first-lobe limit other than the standard one, else null. */
export function lobeLimitWarning(settings: AnalysisSettings): string | null {
  return settings.lobeLimitFactor === FIRST_LOBE_RANGE
    ? null
    : `First-lobe limit is ${settings.lobeLimitFactor} × V-HPBW, not the standard ${FIRST_LOBE_RANGE}: sidelobe and null-fill rows are non-standard.`;
}

/** "1 file" / "N files". */
export const filesText = (n: number): string => `${n} file${n === 1 ? '' : 's'}`;

/** The dataset shown when nothing is highlighted or chosen: the one with the most files (ties: the first). */
export function defaultDataset(datasets: readonly BandDataset[]): BandDataset | undefined {
  return datasets.reduce<BandDataset | undefined>((best, d) => (!best || d.items.length > best.items.length ? d : best), undefined);
}

export function hintText(largest: number): string {
  return `Band statistics need at least ${MIN_SAMPLES} files of one antenna (frequencies × tilts × ports). Largest set loaded: ${largest}.`;
}

/** A sub-band list after editing entry `index`; keeps an automatic name in step with its range. */
export function editSubBand(list: readonly SubBand[], index: number, patch: Partial<SubBand>): SubBand[] {
  const next = list.map((b) => ({ ...b }));
  const old = next[index];
  if (!old) return sanitizeSubBands(next);
  const merged = { ...old, ...patch };
  // An edit that would make the entry invalid (a typo such as 188000 MHz) must not delete it.
  if (sanitizeSubBands([merged]).length === 0) return sanitizeSubBands(list);
  if (patch.name === undefined && (old.name === '' || old.name === subBandName(old.minMHz, old.maxMHz))) {
    merged.name = subBandName(Math.min(merged.minMHz, merged.maxMHz), Math.max(merged.minMHz, merged.maxMHz));
  }
  next[index] = merged;
  return sanitizeSubBands(next);
}

/**
 * What the editor says when a typed limit crosses the other one (a minimum above the maximum, or the reverse): the
 * range is kept by swapping the two, which would otherwise happen without a word. Null for any other edit.
 */
export function swappedNote(index: number, old: SubBand | undefined, patch: Partial<SubBand>): string | null {
  if (!old) return null;
  const range = (a: number, b: number) => `${Math.min(a, b)}–${Math.max(a, b)} MHz`;
  if (patch.minMHz !== undefined && patch.minMHz > old.maxMHz) {
    return `Sub-band ${index + 1}: the minimum ${patch.minMHz} MHz is above the maximum ${old.maxMHz} MHz, so the two were swapped (${range(patch.minMHz, old.maxMHz)}).`;
  }
  if (patch.maxMHz !== undefined && patch.maxMHz < old.minMHz) {
    return `Sub-band ${index + 1}: the maximum ${patch.maxMHz} MHz is below the minimum ${old.minMHz} MHz, so the two were swapped (${range(patch.maxMHz, old.minMHz)}).`;
  }
  return null;
}

export function sameSubBands(a: readonly SubBand[], b: readonly SubBand[]): boolean {
  return a.length === b.length && a.every((x, i) => x.name === b[i].name && x.minMHz === b[i].minMHz && x.maxMHz === b[i].maxMHz);
}

/** What the band statistics say about their sub-bands. */
export interface SubBandsNote {
  userDefined: boolean;
  /** How many sub-bands the user defined (0 = automatic). */
  count: number;
  /** Files of the antenna whose frequency lies in none of the user's sub-bands: they are in no statistic. */
  outside: number;
  total: number;
  text: string;
}

/**
 * The state of the sub-bands for the antenna shown (`items`): automatic, or the user's own, and then how many of the
 * antenna's files fall in none of them. Automatic sub-bands cover every file, so nothing is counted for them.
 */
export function subBandsNote(items: readonly { pattern: { frequencyMHz: number } }[], user: readonly SubBand[]): SubBandsNote {
  const total = items.length;
  if (user.length === 0) return { userDefined: false, count: 0, outside: 0, total, text: 'Sub-bands are automatic.' };
  const outside = items.filter((i) => !user.some((b) => inSubBand(i.pattern.frequencyMHz, b))).length;
  const left = outside > 0 ? ` ${outside} of ${filesText(total)} ${outside === 1 ? 'is' : 'are'} in no sub-band.` : '';
  return { userDefined: true, count: user.length, outside, total, text: `Sub-bands: user-defined (${user.length}).${left}` };
}

export interface BandSheet {
  label: string;
  columns: BandColumn[];
  tilted?: BandColumn[];
}

const HEADER = [
  'Antenna', 'Sub-band', 'Min (MHz)', 'Max (MHz)', 'Parameter', 'Unit', 'Type', 'N', 'Statistic', 'Value',
  'Tolerance', 'Lower', 'Upper', 'Percentile', 'Min', 'Max', 'Mean', 'Counted as 22 dB', 'Adjusted',
];

const TYPE_LABEL = {
  double: 'double-sided',
  max: 'single-sided max',
  min: 'single-sided min',
  mean: 'mean',
  absolute: 'absolute',
} as const;

const GAIN_TILT_KEYS = new Set(['gainMinTilt', 'gainMidTilt', 'gainMaxTilt']);

/** The rows of a band CSV or copied table, and the 3D method an angular-region row names. */
export interface BandRowsOf {
  /** The rows the sheets were made with (`bandRows`); the Annex C list by default. */
  rows?: readonly BandParam[];
  method?: Method3d;
}

function csvLine(label: string, state: string | null, column: BandColumn, p: BandParam, cell: BandCell, settings: AnalysisSettings, method?: Method3d): string[] {
  const stat = cell.stat;
  // Two decimals, or the row's own (a lower region ratio of a few thousandths of a percent).
  const f2 = (v: number | undefined): string => (v === undefined ? '' : fixed(v, p.decimals?.csv ?? 2));
  const parameter = bandParamLabel(p, settings, method) + (GAIN_TILT_KEYS.has(p.key) && cell.tiltDeg !== undefined ? ` (${tiltText(cell.tiltDeg!)}°)` : '');
  const value = stat ? (stat.kind === 'double' || stat.kind === 'mean' ? stat.mean : stat.value) : undefined;
  const hasValues = cell.values.length > 0;
  const nameIndex = state === null ? 1 : 2;
  // Label and sub-band name are already guarded by `csvText`; the rest is plain CSV quoting.
  return [
    csvText(label),
    ...(state === null ? [] : [state]),
    csvText(column.subBand.name),
    String(column.subBand.minMHz),
    String(column.subBand.maxMHz),
    parameter,
    cell.unit,
    TYPE_LABEL[p.type],
    String(cell.n),
    cell.text,
    f2(value),
    f2(stat?.kind === 'double' ? stat.tolerance : undefined),
    f2(stat?.kind === 'double' ? stat.lower : undefined),
    f2(stat?.kind === 'double' ? stat.upper : undefined),
    f2(stat?.kind === 'max' || stat?.kind === 'min' ? stat.percentile : undefined),
    hasValues ? f2(Math.min(...cell.values)) : '',
    hasValues ? f2(Math.max(...cell.values)) : '',
    f2(stat?.kind === 'double' || stat?.kind === 'mean' ? stat.mean : undefined),
    String(cell.substituted),
    cell.adjusted ? 'yes' : '',
  ].map((f, i) => (i === 0 || i === nameIndex ? f : csvCell(f)));
}

/** The State of a tilted line while the simulated horizontal cut is the one at the horizon (comma-free). */
const TILTED_AT_HORIZON = 'tilted [H cut at the horizon]';

/** A difference line of the band CSV: B − A of each numeric column where both antennas have it; N and the 22 dB count stay empty (the two antenna lines have them). */
function diffCsvLine(label: string, state: string | null, column: BandColumn, p: BandParam, a: BandCell, b: BandCell, d: BandDiff, settings: AnalysisSettings, method?: Method3d): string[] {
  // A row with its own decimals: a small difference that is not zero gets as many more as it needs not to read 0.0000.
  const f2 = (v: number | undefined): string => (v === undefined ? '' : fixed(v, p.decimals ? fineDecimals(v, p.decimals.csv) : 2));
  const tilts = GAIN_TILT_KEYS.has(p.key) && a.tiltDeg !== undefined && b.tiltDeg !== undefined
    ? a.tiltDeg === b.tiltDeg ? ` (${tiltText(a.tiltDeg)}°)` : ` (A ${tiltText(a.tiltDeg)}°, B ${tiltText(b.tiltDeg)}°)`
    : '';
  const n = d.numbers;
  const nameIndex = state === null ? 1 : 2;
  return [
    csvText(label),
    ...(state === null ? [] : [state]),
    csvText(column.subBand.name),
    String(column.subBand.minMHz),
    String(column.subBand.maxMHz),
    bandParamLabel(p, settings, method) + tilts,
    d.unit,
    TYPE_LABEL[p.type],
    '',
    // A difference mostly starts with + or -: guarded like user text, so a spreadsheet does not read it as a formula.
    formulaSafe(d.text),
    f2(n.value),
    f2(n.tolerance),
    f2(n.lower),
    f2(n.upper),
    f2(n.percentile),
    f2(n.min),
    f2(n.max),
    f2(n.mean),
    '',
    d.adjusted ? 'yes' : '',
  ].map((f, i) => (i === 0 || i === nameIndex ? f : csvCell(f)));
}

/** Two antennas compared (same sub-bands): their difference lines are added to the band CSV. */
export interface BandCsvComparison {
  a: BandSheet;
  b: BandSheet;
}

/**
 * The band statistics in long form: one line per antenna × sub-band × parameter (× state with a tilt simulation).
 * With a comparison, a first column Row says `statistic` on those lines, and one `difference` line (B − A) per sub-band ×
 * parameter (× state) follows them; without one the CSV is as it always was.
 */
export function bandCsv(sheets: readonly BandSheet[], settings: AnalysisSettings, horizonCut = false, tiltActive = true, compare?: BandCsvComparison, { rows = BAND_PARAMS, method }: BandRowsOf = {}): string {
  // With no tilt on any file nothing is "tilted": the horizontal rows are of the horizon cut, the others the simulated run's (equal to the file's).
  const second = (key: BandParamKey): string =>
    horizonCut && !tiltActive ? (bandFollowsHCut(key) ? 'horizon cut' : 'simulated') : horizonCut && bandFollowsHCut(key) ? TILTED_AT_HORIZON : 'tilted';
  const withState = sheets.some((s) => s.tilted);
  const header = (withState ? [HEADER[0], 'State', ...HEADER.slice(1)] : HEADER).map(csvCell);
  const lines: string[][] = [header];
  /** The lines of `sheet`, of the columns `keep` lets through (all by default). */
  const write = (sheet: BandSheet, keep: (column: BandColumn) => boolean = () => true) => {
    sheet.columns.forEach((column, i) => {
      if (!keep(column)) return;
      for (const p of rows) {
        if (!withState) {
          lines.push(csvLine(sheet.label, null, column, p, cellOf(column, p.key), settings, method));
        } else {
          const tilted = (sheet.tilted ?? sheet.columns)[i];
          // The Horizon level has no original value (a file cut has none): its one line is of the horizon cut.
          if (!simulatedOnly(p.key)) lines.push(csvLine(sheet.label, 'original', column, p, cellOf(column, p.key), settings, method));
          // Only a parameter read from the horizontal cut is of the cut at the horizon; the others are tilted as in any mode.
          lines.push(csvLine(sheet.label, second(p.key), tilted, p, cellOf(tilted, p.key), settings, method));
        }
      }
    });
  };
  for (const sheet of sheets) write(sheet);
  if (compare) {
    const { a, b } = compare;
    // Every difference line is computed from two statistic lines of the same file: where the comparison's sub-bands are
    // not an antenna's own (automatic ones made over both antennas), its lines over them are written too.
    for (const side of [a, b]) {
      const own = sheets.find((sh) => sh.label === side.label)?.columns ?? [];
      write(side, (column) => !own.some((o) => sameSubBands([o.subBand], [column.subBand])));
    }
    const label = `${b.label} − ${a.label}`;
    const names = { a: a.label, b: b.label };
    const out = [['Row', ...lines[0]], ...lines.slice(1).map((l) => ['statistic', ...l])];
    a.columns.forEach((column, i) => {
      for (const p of rows) {
        const line = (state: string | null, ca: BandColumn, cb: BandColumn) =>
          out.push(['difference', ...diffCsvLine(label, state, column, p, cellOf(ca, p.key), cellOf(cb, p.key), bandDiff(cellOf(ca, p.key), cellOf(cb, p.key), names), settings, method)]);
        if (!withState) line(null, column, b.columns[i]);
        else {
          if (!simulatedOnly(p.key)) line('original', column, b.columns[i]);
          line(second(p.key), (a.tilted ?? a.columns)[i], (b.tilted ?? b.columns)[i]);
        }
      }
    });
    return out.map((l) => l.join(',')).join('\r\n') + '\r\n';
  }
  return lines.map((l) => l.join(',')).join('\r\n') + '\r\n';
}

/**
 * The band statistics table as shown, for a spreadsheet: a header row (Parameter, then each sub-band with its file
 * count) and a line per parameter with the cell text (`original → tilted` under a simulation). Tab-separated.
 */
export function bandTsv(columns: readonly BandColumn[], tilted: readonly BandColumn[] | null, settings: AnalysisSettings, horizonCut = false, tiltActive = true, { rows = BAND_PARAMS, method }: BandRowsOf = {}): string {
  // Only the sub-band names are user text (formula-guarded); the labels and cells are computed, so they only lose tabs and line breaks.
  const header = [tilted && horizonCut ? (tiltActive ? 'Parameter [tilted: H cut at the horizon]' : `Parameter ${AT_HORIZON_TAG}`) : 'Parameter', ...columns.map((c) => `${tsvText(c.subBand.name)} (${filesText(c.files)})`)];
  const lines = rows.map((p) => [
    tabSafe(bandParamLabel(p, settings, method)),
    ...columns.map((c, i) => tabSafe(cellDisplay(cellOf(c, p.key), tilted ? cellOf(tilted[i], p.key) : undefined).text)),
  ]);
  return [header, ...lines].map((l) => l.join('\t')).join('\r\n') + '\r\n';
}
