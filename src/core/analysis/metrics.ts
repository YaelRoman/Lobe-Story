import type { MetricResult, Pattern, Tags } from '../types';
import { beamwidth, type BeamResult } from './beamwidth';
import { frontToBack } from './frontToBack';
import { toGrid, type Grid } from './grid';
import { firstNullFill, usls } from './sidelobes';
import { beamTracking } from './tracking';

export interface AnalysisSettings {
  levelDb: number;
  fbWindowDeg: number;
  uslsRangeDeg: number;
  nullSearchDeg: number;
  trackingWindowDeg: number;
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
  levelDb: 3,
  fbWindowDeg: 30,
  uslsRangeDeg: 20,
  nullSearchDeg: 90,
  trackingWindowDeg: 60,
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
  fb180: MetricResult;
  fbWindow: MetricResult;
  usls: MetricResult;
  nullFill: MetricResult;
  beamTracking: MetricResult;
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
  const declared = item.pattern.declared;
  const declaredReason =
    typeof opts.declaredReason === 'function' ? opts.declaredReason(item.pattern.id) : opts.declaredReason;
  return {
    h,
    v,
    squint: h.direction,
    tilt,
    tiltError,
    fb180: fb.fb180,
    fbWindow: fb.fbWindow,
    usls: usls(grids.v, v, s.uslsRangeDeg),
    nullFill: firstNullFill(grids.v, v, s.nullSearchDeg),
    beamTracking: missing('Not computed'),
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
  const candidates = items.filter(
    (c) =>
      c !== item &&
      c.scope === item.scope &&
      c.tags.polarization === want &&
      c.tags.tiltDeg === t.tiltDeg &&
      c.tags.array === t.array &&
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
    metrics.beamTracking =
      'partner' in found
        ? beamTracking(own.h, grids.get(found.partner.pattern.id)!.h, s.trackingWindowDeg)
        : missing(found.reason);
    out.set(item.pattern.id, metrics);
  }
  return out;
}
