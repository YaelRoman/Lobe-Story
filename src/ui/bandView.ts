import { BAND_PARAMS, bandParamLabel, tiltText, type BandCell, type BandColumn } from '../core/analysis/bandParams';
import { MIN_SAMPLES } from '../core/analysis/bandStats';
import type { AnalysisSettings } from '../core/analysis/metrics';
import { sanitizeSubBands, subBandName, type BandDataset, type SubBand } from '../core/analysis/subBands';
import { FIRST_LOBE_RANGE } from '../core/analysis/sidelobes';
import { csvCell, csvText, tabSafe, tsvText } from './table';

/** What a table cell shows: `original → tilted` only where the two texts differ. */
export function cellDisplay(original: BandCell, tilted?: BandCell): { text: string; title: string; muted: boolean } {
  const shown = tilted ?? original;
  const muted = shown.state !== 'ok';
  if (!tilted || tilted.text === original.text) return { text: original.text, title: original.title, muted };
  return {
    text: `${original.text} → ${tilted.text}`,
    title: `original: ${original.title}\ntilted: ${tilted.title}`,
    muted,
  };
}

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
const f2 = (v: number | undefined): string => (v === undefined ? '' : v.toFixed(2));

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

/** The band statistics in long form: one line per antenna × sub-band × parameter (× state with a tilt simulation). */
export function bandCsv(sheets: readonly BandSheet[], settings: AnalysisSettings): string {
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
          lines.push(csvLine(sheet.label, 'tilted', tilted, p, tilted.cells[p.key], settings));
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
export function bandTsv(columns: readonly BandColumn[], tilted: readonly BandColumn[] | null, settings: AnalysisSettings): string {
  // Only the sub-band names are user text (formula-guarded); the labels and cells are computed, so they only lose tabs and line breaks.
  const header = ['Parameter', ...columns.map((c) => `${tsvText(c.subBand.name)} (${filesText(c.files)})`)];
  const lines = BAND_PARAMS.map((p) => [
    tabSafe(bandParamLabel(p, settings)),
    ...columns.map((c, i) => tabSafe(cellDisplay(c.cells[p.key], tilted?.[i].cells[p.key]).text)),
  ]);
  return [header, ...lines].map((l) => l.join('\t')).join('\r\n') + '\r\n';
}
