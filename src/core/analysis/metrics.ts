import type { MetricResult, Pattern, Tags } from '../types';
import { beamwidth, type BeamResult } from './beamwidth';
import { frontToBack } from './frontToBack';
import { toGrid, type Grid } from './grid';
import { elevationSidelobes, FIRST_LOBE_RANGE, horizontalSls, type LobeResult, type WindowResult } from './sidelobes';
import { DU_LEVELS, duAperture, rollOff, rollOffEdges, sectorPower } from './sector';
import { beamTracking, edgeTracking } from './tracking';
import { DBI_OVER_DBD, hasUsableFrequency } from '../gain';
import { angularRegionEfficiency, type AngularRegionEfficiency } from './are';
import type { Method3d } from './pattern3d';

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
  /** As `declaredReason`, for the two Δ-declared metrics read from the H cut only (H beamwidth, F/B): a pattern whose H cut is not the file's while its V cut is. */
  declaredHReason?: (pattern: Pattern) => string | undefined;
  /**
   * When set, the angular-region estimate (`are`) is computed, with this 3D reconstruction method. It is left out
   * otherwise ("Not computed"): it is the one metric that integrates over the sphere, and its columns are optional.
   */
  areMethod?: Method3d;
  /**
   * The estimate of a pattern whose intensity is not the reconstruction of its own two cuts (a mechanically tilted
   * copy, see `analyzeTilted`); `undefined` leaves the pattern to the two-cut estimate. Only asked with `areMethod`.
   */
  areModel?: (pattern: Pattern, grids: { h: Grid; v: Grid }, sectorEdgeDeg: number, method: Method3d) => AngularRegionEfficiency | undefined;
  /**
   * How far (dB) the maximum of a pattern's H cut lies below the pattern's 3D peak, for an H cut that does not pass
   * through the peak (a simulated horizon cut); `undefined` for a cut that does. With it, the dB levels read from the
   * H cut (F/B, H-SLS, roll-off, port-to-port tracking) are levels below the 3D peak; the beamwidths, the squint and
   * the peak azimuth are measured on the cut against its own maximum, and the power ratios (SPR, AIR, D/U) do not
   * depend on the reference.
   */
  hCutPeakDb?: (pattern: Pattern) => number | undefined;
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
  /** Angular region efficiency, Type A, estimated from the two cuts (after BASTA 7.2.4; see `are.ts`). */
  are: AngularRegionEfficiency;
  /**
   * Only for an H cut that does not pass through the 3D peak (a simulated horizon cut): how far its maximum lies
   * below that peak, in dB. The levels `fb180`, `fbWindow`, `hSls`, `rollOff`, `rollOffEdges` and the tracking
   * values then include it.
   */
  hCutPeakDb?: number;
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

const ARE_NOT_COMPUTED: AngularRegionEfficiency = (() => {
  const m = missing('Not computed');
  return { sector: m, spatial: m, lower: m };
})();

// The last angular-region estimate per pattern object. Patterns are immutable and keep their object across renders
// (tilted copies too, see `tiltPattern`), so a settings change that does not touch the estimate, or another file's
// tilt, does not integrate an unchanged file again.
const areCache = new WeakMap<Pattern, { key: string; value: AngularRegionEfficiency }>();

function areOf(
  pattern: Pattern,
  grids: { h: Grid; v: Grid },
  edgeDeg: number,
  method: Method3d,
  remember: boolean,
  model: AnalyzeOptions['areModel'],
): AngularRegionEfficiency {
  if (!remember) return model?.(pattern, grids, edgeDeg, method) ?? angularRegionEfficiency(grids.h, grids.v, edgeDeg, method);
  // The memo is keyed on what answered: a pattern the model answers for (a mechanically tilted copy) has another value
  // than its two cuts give, but one the model passes on (an untilted file in a tilted list) is the same as in the
  // untilted pass and shares its entry.
  const base = `${method}|${edgeDeg}`;
  const hit = areCache.get(pattern);
  if (model && hit?.key === `${base}|model`) return hit.value;
  const answered = model?.(pattern, grids, edgeDeg, method);
  if (answered) {
    areCache.set(pattern, { key: `${base}|model`, value: answered });
    return answered;
  }
  if (hit?.key === `${base}|cuts`) return hit.value;
  const value = angularRegionEfficiency(grids.h, grids.v, edgeDeg, method);
  areCache.set(pattern, { key: `${base}|cuts`, value });
  return value;
}

/**
 * The two-cut estimate of a pattern's own cuts, from the per-pattern memo `analyzeAll` uses (so a pattern already
 * analysed with this method and sector edge is not integrated again).
 */
export function angularRegionsOfCuts(pattern: Pattern, edgeDeg: number, method: Method3d): AngularRegionEfficiency {
  const key = `${method}|${edgeDeg}|cuts`;
  const hit = areCache.get(pattern);
  if (hit?.key === key) return hit.value;
  const grids = gridsFor(pattern);
  const value = angularRegionEfficiency(grids.h, grids.v, edgeDeg, method);
  areCache.set(pattern, { key, value });
  return value;
}

export function analyzePattern(
  item: TaggedPattern,
  s: AnalysisSettings = DEFAULT_SETTINGS,
  grids?: { h: Grid; v: Grid },
  opts: AnalyzeOptions = {},
): PatternMetrics {
  // Grids handed in by a caller need not be the pattern's own, so only the pattern's own grids use the per-pattern memo.
  return analyze(item, s, grids ?? gridsFor(item.pattern), opts, grids === undefined);
}

function analyze(
  item: TaggedPattern,
  s: AnalysisSettings,
  grids: { h: Grid; v: Grid },
  opts: AnalyzeOptions,
  ownGrids: boolean,
): PatternMetrics {
  const h = beamwidth(grids.h, s.levelDb);
  const v = beamwidth(grids.v, s.levelDb);
  const below = opts.hCutPeakDb?.(item.pattern);
  // A level read from the H grid (normalised to the cut's own maximum), referenced to the 3D peak.
  const lift = <T extends MetricResult>(r: T): T => (below === undefined || r.value === null ? r : { ...r, value: r.value + below });
  const fb0 = frontToBack(grids.h, s.fbWindowDeg);
  const fb = { fb180: lift(fb0.fb180), fbWindow: lift(fb0.fbWindow) };
  const edges = rollOffEdges(grids.h, s.sectorEdgeDeg);
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
  const declaredHReason = declaredReason ?? opts.declaredHReason?.(item.pattern);
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
    hSls: lift(horizontalSls(grids.h, s.sectorEdgeDeg)),
    beamTracking: missing('Not computed'),
    spr: power.spr,
    air: power.air,
    rollOff: lift(rollOff(grids.h, s.sectorEdgeDeg)),
    rollOffEdges: below === undefined ? edges : [edges[0] + below, edges[1] + below],
    du,
    delta: {
      hHpbw: declaredHReason ? missing(declaredHReason) : delta(h.hpbw, declared.hBeamwidth),
      vHpbw: declaredReason ? missing(declaredReason) : delta(v.hpbw, declared.vBeamwidth),
      fb: declaredHReason ? missing(declaredHReason) : delta(fb.fb180, declared.frontToBack),
    },
    are: opts.areMethod ? areOf(item.pattern, grids, s.sectorEdgeDeg, opts.areMethod, ownGrids, opts.areModel) : ARE_NOT_COMPUTED,
    ...(below === undefined ? {} : { hCutPeakDb: below }),
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
    const metrics = analyze(item, s, own, opts, true);
    const found = findTrackingPartner(item, items);
    if ('partner' in found) {
      const partnerGrid = grids.get(found.partner.pattern.id)!.h;
      // The grids are normalised to each cut's own maximum; a cut that lies below its 3D peak is put back there.
      const belowDelta = (metrics.hCutPeakDb ?? 0) - (opts.hCutPeakDb?.(found.partner.pattern) ?? 0);
      const sameGainDelta =
        (item.pattern.gain && found.partner.pattern.gain
          ? gainDbd(item.pattern.gain) - gainDbd(found.partner.pattern.gain)
          : 0) - belowDelta;
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
