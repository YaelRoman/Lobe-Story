import { BAND_PARAMS, bandParamLabel, tiltText, type BandCell, type BandColumn, type BandParamKey } from '../core/analysis/bandParams';
import { MIN_SAMPLES } from '../core/analysis/bandStats';
import type { AnalysisSettings } from '../core/analysis/metrics';
import { sanitizeSubBands, subBandName, type BandDataset, type SubBand } from '../core/analysis/subBands';
import { FIRST_LOBE_RANGE } from '../core/analysis/sidelobes';
import { fixed } from './fixed';
import { AT_HORIZON_TAG, csvCell, csvText, tabSafe, TILT_WORDS, tsvText, type PairWords } from './table';
import { hCutLabel } from './simSummary';
import type { HCutMode } from '../core/analysis/tilt';

/** The band parameters read from the horizontal cut: the ones the horizontal cut at the horizon changes. The rest are read from the vertical cut or declared, and are the file's own with no tilt. */
const BAND_FOLLOWS_H_CUT: ReadonlySet<BandParamKey> = new Set<BandParamKey>(['hHpbw', 'squint', 'fbWindow', 'hSls', 'tracking', 'rollOff', 'air']);
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

/** What a table cell shows: `original → tilted` only where the two texts differ. */
export function cellDisplay(original: BandCell, tilted?: BandCell, words: PairWords = TILT_WORDS): { text: string; title: string; muted: boolean } {
  const shown = tilted ?? original;
  const muted = shown.state !== 'ok';
  if (!tilted || tilted.text === original.text) return { text: original.text, title: original.title, muted };
  return {
    text: `${original.text} → ${tilted.text}`,
    title: `${words.from}: ${original.title}\n${words.to}: ${tilted.title}`,
    muted,
  };
}

/** The sentence of the band note while a simulation is active: what a pair of values in a cell is. */
export const bandStateNote = (hCut: HCutMode, tiltActive: boolean): string =>
  hCut === 'horizon' && !tiltActive
    ? 'Horizontal cut at the horizon: cells show file cut → horizon cut where they differ.'
    : `Simulation active: cells show original → tilted where they differ (${hCutLabel(hCut)}).`;

/** Shown under the table while some visible cell ends in `*`. */
export const ADJUSTED_LEGEND = '* adjusted by the 3 dB excursion rule (BASTA 12.2)';

export function anyAdjusted(columns: readonly BandColumn[], tilted?: readonly BandColumn[] | null): boolean {
  return [...columns, ...(tilted ?? [])].some((c) => Object.values(c.cells).some((cell) => cell.adjusted));
}

export function largestDataset(datasets: readonly BandDataset[]): number {
  return datasets.reduce((m, d) => Math.max(m, d.items.length), 0);
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
const f2 = (v: number | undefined): string => (v === undefined ? '' : fixed(v, 2));

function csvLine(label: string, state: string | null, column: BandColumn, p: (typeof BAND_PARAMS)[number], cell: BandCell, settings: AnalysisSettings): string[] {
  const stat = cell.stat;
  const parameter = bandParamLabel(p, settings) + (GAIN_TILT_KEYS.has(p.key) && cell.tiltDeg !== undefined ? ` (${tiltText(cell.tiltDeg!)}°)` : '');
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

/** The band statistics in long form: one line per antenna × sub-band × parameter (× state with a tilt simulation). */
export function bandCsv(sheets: readonly BandSheet[], settings: AnalysisSettings, horizonCut = false, tiltActive = true): string {
  // With no tilt on any file nothing is "tilted": the horizontal rows are of the horizon cut, the others the simulated run's (equal to the file's).
  const second = (key: BandParamKey): string =>
    horizonCut && !tiltActive ? (bandFollowsHCut(key) ? 'horizon cut' : 'simulated') : horizonCut && bandFollowsHCut(key) ? TILTED_AT_HORIZON : 'tilted';
  const withState = sheets.some((s) => s.tilted);
  const header = (withState ? [HEADER[0], 'State', ...HEADER.slice(1)] : HEADER).map(csvCell);
  const lines: string[][] = [header];
  for (const sheet of sheets) {
    sheet.columns.forEach((column, i) => {
      for (const p of BAND_PARAMS) {
        if (!withState) {
          lines.push(csvLine(sheet.label, null, column, p, column.cells[p.key], settings));
        } else {
          const tilted = (sheet.tilted ?? sheet.columns)[i];
          lines.push(csvLine(sheet.label, 'original', column, p, column.cells[p.key], settings));
          // Only a parameter read from the horizontal cut is of the cut at the horizon; the others are tilted as in any mode.
          lines.push(csvLine(sheet.label, second(p.key), tilted, p, tilted.cells[p.key], settings));
        }
      }
    });
  }
  return lines.map((l) => l.join(',')).join('\r\n') + '\r\n';
}

/**
 * The band statistics table as shown, for a spreadsheet: a header row (Parameter, then each sub-band with its file
 * count) and a line per parameter with the cell text (`original → tilted` under a simulation). Tab-separated.
 */
export function bandTsv(columns: readonly BandColumn[], tilted: readonly BandColumn[] | null, settings: AnalysisSettings, horizonCut = false, tiltActive = true): string {
  // Only the sub-band names are user text (formula-guarded); the labels and cells are computed, so they only lose tabs and line breaks.
  const header = [tilted && horizonCut ? (tiltActive ? 'Parameter [tilted: H cut at the horizon]' : `Parameter ${AT_HORIZON_TAG}`) : 'Parameter', ...columns.map((c) => `${tsvText(c.subBand.name)} (${filesText(c.files)})`)];
  const lines = BAND_PARAMS.map((p) => [
    tabSafe(bandParamLabel(p, settings)),
    ...columns.map((c, i) => tabSafe(cellDisplay(c.cells[p.key], tilted?.[i].cells[p.key]).text)),
  ]);
  return [header, ...lines].map((l) => l.join('\t')).join('\r\n') + '\r\n';
}
