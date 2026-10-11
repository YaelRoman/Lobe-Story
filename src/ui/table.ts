import type { GainUnit, MetricResult, Pattern } from '../core/types';
import type { PatternMetrics } from '../core/analysis/metrics';
import type { GroupView } from '../state/selectors';
import { isTilted, type TiltSettings, type SimSettings } from '../core/analysis/tilt';
import { nameOf } from '../core/names';
import type { ColumnGroupKey } from '../state/store';

export type MetricColumn =
  | 'hHpbw' | 'vHpbw' | 'hBw10' | 'vBw10' | 'squint' | 'hPeak' | 'tilt' | 'vPeak' | 'tiltError'
  | 'fb180' | 'fbWindow' | 'usls' | 'nullFill'
  | 'tracking' | 'spr' | 'air' | 'rollOff' | 'du16' | 'du64' | 'du256'
  | 'dH' | 'dV' | 'dFb';

export const COLUMN_GROUPS: { key: ColumnGroupKey; label: string }[] = [
  { key: 'beam', label: 'Beam' },
  { key: 'fb', label: 'Front/back' },
  { key: 'sidelobes', label: 'Sidelobes' },
  { key: 'sector', label: 'Sector' },
  { key: 'declared', label: 'Declared Δ' },
];

export const METRIC_COLUMNS: { key: MetricColumn; label: string; unit: string; group: ColumnGroupKey }[] = [
  { key: 'hHpbw', label: 'H-HPBW', unit: '°', group: 'beam' },
  { key: 'vHpbw', label: 'V-HPBW', unit: '°', group: 'beam' },
  { key: 'hBw10', label: 'H-BW 10 dB', unit: '°', group: 'beam' },
  { key: 'vBw10', label: 'V-BW 10 dB', unit: '°', group: 'beam' },
  { key: 'squint', label: 'Squint', unit: '°', group: 'beam' },
  { key: 'hPeak', label: 'Peak az', unit: '°', group: 'beam' },
  { key: 'tilt', label: 'Tilt', unit: '°', group: 'beam' },
  { key: 'vPeak', label: 'Peak tilt', unit: '°', group: 'beam' },
  { key: 'tiltError', label: 'Tilt error', unit: '°', group: 'beam' },
  { key: 'fb180', label: 'F/B 180°', unit: 'dB', group: 'fb' },
  { key: 'fbWindow', label: 'F/B window', unit: 'dB', group: 'fb' },
  { key: 'usls', label: 'USLS', unit: 'dB', group: 'sidelobes' },
  { key: 'nullFill', label: 'Null fill', unit: 'dB', group: 'sidelobes' },
  { key: 'tracking', label: 'P2P tracking', unit: 'dB', group: 'sector' },
  { key: 'spr', label: 'SPR', unit: '%', group: 'sector' },
  { key: 'air', label: 'AIR', unit: 'dB', group: 'sector' },
  { key: 'rollOff', label: 'Roll-off', unit: 'dB', group: 'sector' },
  { key: 'du16', label: 'D/U 16QAM', unit: '°', group: 'sector' },
  { key: 'du64', label: 'D/U 64QAM', unit: '°', group: 'sector' },
  { key: 'du256', label: 'D/U 256QAM', unit: '°', group: 'sector' },
  { key: 'dH', label: 'ΔH-HPBW', unit: '°', group: 'declared' },
  { key: 'dV', label: 'ΔV-HPBW', unit: '°', group: 'declared' },
  { key: 'dFb', label: 'ΔF/B', unit: 'dB', group: 'declared' },
];

export function visibleColumns(groups: Record<ColumnGroupKey, boolean>): typeof METRIC_COLUMNS {
  return METRIC_COLUMNS.filter((c) => groups[c.group]);
}

/** Header text for a column; the F/B window label depends on the current setting. */
export function columnLabel(c: { key: MetricColumn; label: string }, fbWindowDeg: number): string {
  return c.key === 'fbWindow' ? `F/B ±${fbWindowDeg}°` : c.label;
}

const DU_DB: Partial<Record<MetricColumn, number>> = { du16: 15, du64: 20, du256: 25 };

/** Header tooltip for a column; the sector columns depend on the sector settings (E, S). */
export function columnTitle(
  key: MetricColumn,
  settings: { sectorEdgeDeg: number; siteSectors: number; uslsRangeDeg?: number },
): string | undefined {
  const e = settings.sectorEdgeDeg;
  switch (key) {
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
      return `Sector power ratio: power outside ±${e}° / power inside (co-pol)`;
    case 'air':
      return 'Azimuth interference ratio: 10·log10(inside/outside), co-pol only';
    case 'rollOff':
      return `Level at the ±${e}° sector edges below the peak (worse edge)`;
    case 'du16':
    case 'du64':
    case 'du256':
      return `Width around boresight where this pattern is ≥ ${DU_DB[key]} dB above the neighbouring sectors (${settings.siteSectors}-sector site)`;
    default:
      return undefined;
  }
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
    hBw10: m.hBw10,
    vBw10: m.vBw10,
    squint: m.squint,
    hPeak: m.hPeak,
    tilt: m.tilt,
    vPeak: m.vPeak,
    tiltError: m.tiltError,
    fb180: m.fb180,
    fbWindow: m.fbWindow,
    usls: m.usls,
    nullFill: m.nullFill,
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
