import { BAND_PARAMS, bandParamLabel, type BandCell, type BandColumn } from '../core/analysis/bandParams';
import { MIN_SAMPLES } from '../core/analysis/bandStats';
import type { AnalysisSettings } from '../core/analysis/metrics';
import { sanitizeSubBands, subBandName, type BandDataset, type SubBand } from '../core/analysis/subBands';
import { csvCell } from './table';

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

export function hintText(largest: number): string {
  return `Band statistics need at least ${MIN_SAMPLES} files of one antenna (frequencies × tilts × ports). Largest set loaded: ${largest}.`;
}

/** A sub-band list after editing entry `index`; keeps an automatic name in step with its range. */
export function editSubBand(list: readonly SubBand[], index: number, patch: Partial<SubBand>): SubBand[] {
  const next = list.map((b) => ({ ...b }));
  const old = next[index];
  if (!old) return sanitizeSubBands(next);
  const merged = { ...old, ...patch };
  if (patch.name === undefined && (old.name === '' || old.name === subBandName(old.minMHz, old.maxMHz))) {
    merged.name = subBandName(Math.min(merged.minMHz, merged.maxMHz), Math.max(merged.minMHz, merged.maxMHz));
  }
  next[index] = merged;
  return sanitizeSubBands(next);
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
  const parameter = bandParamLabel(p, settings) + (GAIN_TILT_KEYS.has(p.key) && cell.tiltDeg !== undefined ? ` (${cell.tiltDeg}°)` : '');
  const value = stat ? (stat.kind === 'double' || stat.kind === 'mean' ? stat.mean : stat.value) : undefined;
  const hasValues = cell.values.length > 0;
  return [
    label,
    ...(state === null ? [] : [state]),
    column.subBand.name,
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
  ];
}

/** The band statistics in long form: one line per antenna × sub-band × parameter (× state with a tilt simulation). */
export function bandCsv(sheets: readonly BandSheet[], settings: AnalysisSettings): string {
  const withState = sheets.some((s) => s.tilted);
  const header = withState ? [HEADER[0], 'State', ...HEADER.slice(1)] : HEADER;
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
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
