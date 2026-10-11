import type { GainUnit, MetricResult, Pattern } from '../core/types';
import type { PatternMetrics } from '../core/analysis/metrics';
import type { GroupView } from '../state/selectors';
import { isTilted, type TiltSettings, type SimSettings } from '../core/analysis/tilt';
import { nameOf } from '../core/names';

export type MetricColumn =
  | 'hHpbw' | 'vHpbw' | 'fb180' | 'fbWindow' | 'usls' | 'nullFill'
  | 'squint' | 'tilt' | 'tiltError' | 'tracking' | 'dH' | 'dV' | 'dFb';

export const METRIC_COLUMNS: { key: MetricColumn; label: string; unit: string }[] = [
  { key: 'hHpbw', label: 'H-HPBW', unit: '°' },
  { key: 'vHpbw', label: 'V-HPBW', unit: '°' },
  { key: 'fb180', label: 'F/B 180°', unit: 'dB' },
  { key: 'fbWindow', label: 'F/B window', unit: 'dB' },
  { key: 'usls', label: 'USLS', unit: 'dB' },
  { key: 'nullFill', label: 'Null fill', unit: 'dB' },
  { key: 'squint', label: 'Squint', unit: '°' },
  { key: 'tilt', label: 'Tilt', unit: '°' },
  { key: 'tiltError', label: 'Tilt error', unit: '°' },
  { key: 'tracking', label: 'Tracking', unit: 'dB' },
  { key: 'dH', label: 'ΔH-HPBW', unit: '°' },
  { key: 'dV', label: 'ΔV-HPBW', unit: '°' },
  { key: 'dFb', label: 'ΔF/B', unit: 'dB' },
];

/** Header text for a column; the F/B window label depends on the current setting. */
export function columnLabel(c: { key: MetricColumn; label: string }, fbWindowDeg: number): string {
  return c.key === 'fbWindow' ? `F/B ±${fbWindowDeg}°` : c.label;
}

export interface MetricsRow {
  id: string;
  file: string;
  source: string;
  group: string;
  freq: number;
  gain: number | null;
  cells: Record<MetricColumn, MetricResult>;
  /** Only the cells that should show `original → tilted`; absent cells stay single values. */
  tilted?: Partial<Record<MetricColumn, MetricResult>>;
}

export function convertGain(gain: Pattern['gain'], unit: GainUnit): number | null {
  if (!gain) return null;
  if (gain.unit === unit) return gain.value;
  return unit === 'dBi' ? gain.value + 2.15 : gain.value - 2.15;
}

function cellsOf(m: PatternMetrics): Record<MetricColumn, MetricResult> {
  return {
    hHpbw: m.h.hpbw,
    vHpbw: m.v.hpbw,
    fb180: m.fb180,
    fbWindow: m.fbWindow,
    usls: m.usls,
    nullFill: m.nullFill,
    squint: m.squint,
    tilt: m.tilt,
    tiltError: m.tiltError,
    tracking: m.beamTracking,
    dH: m.delta.hHpbw,
    dV: m.delta.vHpbw,
    dFb: m.delta.fb,
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
        freq: pattern.frequencyMHz,
        gain: convertGain(pattern.gain, gainUnit),
        cells: cellsOf(m),
        ...(tilted ? { tilted } : {}),
      });
    }
  }
  return rows;
}

const fmt = (v: number | null) => (v === null ? '' : v.toFixed(2));
const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

const oneDecimal = (r: MetricResult) => (r.value === null ? '—' : r.value.toFixed(1));

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
): string {
  const simFor = typeof sim === 'function' ? sim : sim ? () => sim : undefined;
  const tilted = typeof sim === 'function' ? rows.some((r) => r.tilted) : sim !== undefined && isTilted(sim);
  const withSource = rows.some((r) => r.source !== r.file);
  const metricHeader = METRIC_COLUMNS.flatMap((c) => {
    const label = columnLabel(c, fbWindowDeg);
    return tilted ? [`${label} original (${c.unit})`, `${label} tilted (${c.unit})`] : [`${label} (${c.unit})`];
  });
  const header = [
    'File',
    ...(withSource ? ['Source file'] : []),
    'Group',
    'Frequency (MHz)',
    `Gain (${gainUnit})`,
    ...metricHeader,
    ...(tilted ? ['Electrical tilt Δ (°)', 'Mechanical tilt (°)', 'Azimuth (°)'] : []),
  ];
  const lines = rows.map((r) => [
    r.file,
    ...(withSource ? [r.source] : []),
    r.group,
    String(r.freq),
    fmt(r.gain),
    ...METRIC_COLUMNS.flatMap((c) =>
      tilted
        ? [fmt(r.cells[c.key].value), fmt((r.tilted?.[c.key] ?? r.cells[c.key]).value)]
        : [fmt(r.cells[c.key].value)],
    ),
    ...(tilted && simFor
      ? (() => {
          const e = simFor(r.id);
          return [String(e.electricalDeg), String(e.mechanicalDeg), String(e.azimuthDeg)];
        })()
      : []),
  ]);
  return [header, ...lines].map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
