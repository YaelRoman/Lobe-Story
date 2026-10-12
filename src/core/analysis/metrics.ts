import type { MetricResult, Pattern, Tags } from '../types';
import { beamwidth, type BeamResult } from './beamwidth';
import { frontToBack } from './frontToBack';
import { toGrid, type Grid } from './grid';
import { elevationSidelobes, FIRST_LOBE_RANGE, horizontalSls, type LobeResult, type WindowResult } from './sidelobes';
import { DU_LEVELS, duAperture, rollOff, rollOffEdges, sectorPower } from './sector';
import { beamTracking, edgeTracking } from './tracking';
import { DBI_OVER_DBD, hasUsableFrequency } from '../gain';

export interface AnalysisSettings {
  levelDb: number;
  fbWindowDeg: number;
  uslsRangeDeg: number;
  /** First-lobe limit in × V-HPBW (BASTA 12.5: 1.78); a lobe further from the peak is reported as merged. */
  lobeLimitFactor: number;
  sectorEdgeDeg: number;
  siteSectors: number;
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
  levelDb: 3,
  fbWindowDeg: 30,
  uslsRangeDeg: 20,
  lobeLimitFactor: FIRST_LOBE_RANGE,
  sectorEdgeDeg: 60,
  siteSectors: 3,
};

export interface TaggedPattern {
  pattern: Pattern;
  tags: Tags;
  /** Custom group id; beam-tracking partners are only searched within the same scope. */
  scope?: string;
  /** Source path when this instance is a copy; keeps a duplicate from stealing its source's beam-tracking partner. */
  copyOf?: string;
}

export interface AnalyzeOptions {
  /** Added to the nominal tilt tag before computing tilt error (simulated tilt); a function gives a per-pattern value. */
  nominalOffsetDeg?: number | ((id: string) => number);
  /** When set (or returning a reason), the Δ-declared metrics are null with this reason; a function gives a per-pattern value. */
  declaredReason?: string | ((id: string) => string | undefined);
}

export interface PatternMetrics {
  h: BeamResult;
  v: BeamResult;
  squint: MetricResult;
  tilt: MetricResult;
  tiltError: MetricResult;
  /** The tilt tag plus the simulated offset that `tiltError` is measured against; undefined without a tilt tag. */
  nominalTiltDeg?: number;
  /** BASTA 6.1.6 with X = 10: beamwidth 10 dB below the cut's own peak. */
  hBw10: MetricResult;
  vBw10: MetricResult;
  /** BASTA 6.1.4 beam direction: angle of the strongest co-pol level. */
  hPeak: MetricResult;
  vPeak: MetricResult;
  fb180: MetricResult;
  fbWindow: MetricResult;
  /** BASTA 7.8.4.3: highest upper sidelobe from the peak to `uslsRangeDeg` above it. */
  usls: WindowResult;
  /** BASTA 7.8.3: level of the first null below the main beam (12.5.2). */
  nullFill: LobeResult;
  /** BASTA 7.8.4.2: first upper sidelobe. */
  firstUsls: LobeResult;
  /** BASTA 7.8.4.5 on the elevation cut: highest upper sidelobe from the horizon to `uslsRangeDeg` above it. */
  uslsHorizon: WindowResult;
  /** BASTA 7.8.4.4: highest upper sidelobe from the peak to the zenith. */
  uslsMax: WindowResult;
  /** First lower sidelobe suppression (elevation-cut form of 7.2.11). */
  firstLsls: LobeResult;
  /** BASTA 7.8.4.1 on the azimuth cut: highest sidelobe inside the sector. */
  hSls: MetricResult;
  beamTracking: MetricResult;
  spr: MetricResult;
  air: MetricResult;
  rollOff: MetricResult;
  /** Level below the peak at [−edge, +edge]: the two samples per file of the band statistics. */
  rollOffEdges: [number, number];
  /** Port-to-port difference at [−edge, +edge] against the ± partner; absent without a partner. */
  trackingEdges?: { partnerId: string; values: [number, number] };
  du: Record<'qam16' | 'qam64' | 'qam256', MetricResult & { edges?: [number, number] }>;
  delta: { hHpbw: MetricResult; vHpbw: MetricResult; fb: MetricResult };
}

const missing = (reason: string): MetricResult => ({ value: null, reason });

function delta(computed: MetricResult, declared: number | undefined): MetricResult {
  if (declared === undefined) return missing('Not declared in file');
  if (computed.value === null) return missing(computed.reason ?? 'Not computed');
  return { value: computed.value - declared };
}

export function gridsFor(p: Pattern): { h: Grid; v: Grid } {
  return { h: toGrid(p.horizontal), v: toGrid(p.vertical) };
}

export function analyzePattern(
  item: TaggedPattern,
  s: AnalysisSettings = DEFAULT_SETTINGS,
  grids = gridsFor(item.pattern),
  opts: AnalyzeOptions = {},
): PatternMetrics {
  const h = beamwidth(grids.h, s.levelDb);
  const v = beamwidth(grids.v, s.levelDb);
  const fb = frontToBack(grids.h, s.fbWindowDeg);
  const tilt = v.direction;
  const offset =
    typeof opts.nominalOffsetDeg === 'function'
      ? opts.nominalOffsetDeg(item.pattern.id)
      : (opts.nominalOffsetDeg ?? 0);
  const nominal = item.tags.tiltDeg === undefined ? undefined : item.tags.tiltDeg + offset;
  const tiltError =
    nominal === undefined
      ? missing('Nominal tilt unknown')
      : tilt.value === null
        ? missing(tilt.reason ?? 'Tilt undefined')
        : { value: tilt.value - nominal };
  const power = sectorPower(grids.h, s.sectorEdgeDeg);
  const du = Object.fromEntries(
    DU_LEVELS.map((l) => {
      return [l.key, { ...duAperture(grids.h, l.db, s.siteSectors) }];
    }),
  ) as PatternMetrics['du'];
  const declared = item.pattern.declared;
  const declaredReason =
    typeof opts.declaredReason === 'function' ? opts.declaredReason(item.pattern.id) : opts.declaredReason;
  return {
    h,
    v,
    squint: h.direction,
    tilt,
    tiltError,
    nominalTiltDeg: nominal,
    hBw10: beamwidth(grids.h, 10).hpbw,
    vBw10: beamwidth(grids.v, 10).hpbw,
    hPeak: { value: h.peakAngle },
    vPeak: { value: v.peakAngle },
    fb180: fb.fb180,
    fbWindow: fb.fbWindow,
    ...elevationSidelobes(grids.v, s.uslsRangeDeg, s.lobeLimitFactor),
    hSls: horizontalSls(grids.h, s.sectorEdgeDeg),
    beamTracking: missing('Not computed'),
    spr: power.spr,
    air: power.air,
    rollOff: rollOff(grids.h, s.sectorEdgeDeg),
    rollOffEdges: rollOffEdges(grids.h, s.sectorEdgeDeg),
    du,
    delta: declaredReason
      ? {
          hHpbw: missing(declaredReason),
          vHpbw: missing(declaredReason),
          fb: missing(declaredReason),
        }
      : {
          hHpbw: delta(h.hpbw, declared.hBeamwidth),
          vHpbw: delta(v.hpbw, declared.vBeamwidth),
          fb: delta(fb.fb180, declared.frontToBack),
        },
  };
}

const OPPOSITE: Record<string, string> = { '+45': '-45', '-45': '+45' };

function portsPair(a?: string, b?: string): boolean {
  if (!a || !b || !/^\d+$/.test(a) || !/^\d+$/.test(b)) return true;
  const lo = Math.min(Number(a), Number(b));
  const hi = Math.max(Number(a), Number(b));
  return lo % 2 === 1 && hi === lo + 1;
}

export function findTrackingPartner(
  item: TaggedPattern,
  items: TaggedPattern[],
): { partner: TaggedPattern } | { reason: string } {
  const t = item.tags;
  const want = t.polarization ? OPPOSITE[t.polarization] : undefined;
  if (!want) return { reason: 'Polarization is not ±45' };
  if (t.tiltDeg === undefined) return { reason: 'Nominal tilt unknown' };
  const p = item.pattern;
  if (!hasUsableFrequency(p.frequencyMHz)) return { reason: 'Frequency unknown' };
  const candidates = items.filter(
    (c) =>
      c !== item &&
      c.scope === item.scope &&
      c.tags.polarization === want &&
      c.tags.tiltDeg === t.tiltDeg &&
      c.tags.array === t.array &&
      hasUsableFrequency(c.pattern.frequencyMHz) &&
      Math.abs(c.pattern.frequencyMHz - p.frequencyMHz) < 0.5 &&
      (c.pattern.make === undefined || p.make === undefined || c.pattern.make === p.make) &&
      portsPair(t.port, c.tags.port),
  );
  if (candidates.length === 0) return { reason: 'No opposite-polarization partner loaded' };
  if (candidates.length > 1) {
    // A duplicate's own copy-of-the-partner shouldn't steal its source's partner (and vice versa):
    // narrow to candidates on the same side of "is a copy" as `item` before giving up as ambiguous.
    const matching = candidates.filter((c) => !!c.copyOf === !!item.copyOf);
    if (matching.length === 1) return { partner: matching[0] };
    return { reason: `Ambiguous: ${candidates.length} possible partners` };
  }
  return { partner: candidates[0] };
}

const gainDbd = (g: NonNullable<Pattern['gain']>): number => (g.unit === 'dBi' ? g.value - DBI_OVER_DBD : g.value);

export function analyzeAll(
  items: TaggedPattern[],
  s: AnalysisSettings = DEFAULT_SETTINGS,
  opts: AnalyzeOptions = {},
): Map<string, PatternMetrics> {
  const grids = new Map(items.map((i) => [i.pattern.id, gridsFor(i.pattern)]));
  const out = new Map<string, PatternMetrics>();
  for (const item of items) {
    const own = grids.get(item.pattern.id)!;
    const metrics = analyzePattern(item, s, own, opts);
    const found = findTrackingPartner(item, items);
    if ('partner' in found) {
      const partnerGrid = grids.get(found.partner.pattern.id)!.h;
      const sameGainDelta =
        item.pattern.gain && found.partner.pattern.gain
          ? gainDbd(item.pattern.gain) - gainDbd(found.partner.pattern.gain)
          : 0;
      metrics.beamTracking = beamTracking(own.h, partnerGrid, s.sectorEdgeDeg, sameGainDelta);
      metrics.trackingEdges = {
        partnerId: found.partner.pattern.id,
        values: edgeTracking(own.h, partnerGrid, s.sectorEdgeDeg, sameGainDelta),
      };
    } else {
      metrics.beamTracking = missing(found.reason);
    }
    out.set(item.pattern.id, metrics);
  }
  return out;
}
