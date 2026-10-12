import { useCallback, useDeferredValue, useMemo, useRef } from 'react';
import { useStore } from '../state/store';
import type { Pattern } from '../core/types';
import type { AnalysisSettings, PatternMetrics, TaggedPattern } from '../core/analysis/metrics';
import {
  analyzeTilted,
  anyTilted,
  combineOffsets,
  effectiveFor,
  isTilted,
  tiltEach,
  type SimSettings,
  type TiltSettings,
} from '../core/analysis/tilt';
import { anySimulated, offsetCountsAmong } from './simSummary';

export interface SimulationResult {
  /** True when any loaded file is tilted (effective Δe or m non-zero). */
  tiltActive: boolean;
  /** Global tilt sliders. */
  tilt: TiltSettings;
  /** Global azimuth slider. */
  azimuthDeg: number;
  showOriginal: boolean;
  /** Number of files with offsets. */
  offsetCount: number;
  /** Number of custom groups with offsets. */
  groupOffsetCount: number;
  /** Effective settings of a file (global + its offsets). */
  effective(id: string): SimSettings;
  /** Whether any of these files (the ones a picture draws or an export lists) is simulated; see `anySimulated`. */
  simulatedAmong(ids: Iterable<string>): boolean;
  /** The per-file and per-group offsets among these files (what a picture shows, see `offsetCountsAmong`). */
  offsetsAmong(ids: Iterable<string>): { files: number; groups: number };
  /** Whether a file's effective tilt is non-zero. */
  isTiltedId(id: string): boolean;
  /** Tilted pattern per id (the original pattern for untilted files). */
  patterns: Map<string, Pattern>;
  /** Metrics of the tilted run (the original metrics when no file is tilted). */
  metrics: Map<string, PatternMetrics>;
}

/**
 * Derives a `Record<id, TiltSettings>` (electrical/mechanical only) from `offsets`, keeping the
 * same object identity across renders as long as `key` is unchanged — even when `offsets` itself
 * got a new identity (e.g. only an azimuth offset changed). `key` must capture exactly the parts
 * of `offsets` that should invalidate the result.
 */
function useStableByKey(offsets: Record<string, SimSettings>, key: string): Record<string, TiltSettings> {
  const cache = useRef<{ key: string; value: Record<string, TiltSettings> } | null>(null);
  if (!cache.current || cache.current.key !== key) {
    const value: Record<string, TiltSettings> = {};
    for (const id of Object.keys(offsets)) {
      value[id] = { electricalDeg: offsets[id].electricalDeg, mechanicalDeg: offsets[id].mechanicalDeg };
    }
    cache.current = { key, value };
  }
  return cache.current.value;
}

export function useSimulation(
  tagged: TaggedPattern[],
  metrics: Map<string, PatternMetrics>,
  settings: AnalysisSettings,
): SimulationResult {
  const live = useStore((s) => s.view.simulation);
  const method = useStore((s) => s.view.method3d);
  const membership = useStore((s) => s.membership);
  const customGroups = useStore((s) => s.customGroups);
  // Deferred so dragging a slider stays smooth while tilting/analysing catches up.
  const sim = useDeferredValue(live);
  const { electricalDeg, mechanicalDeg, azimuthDeg, showOriginal, offsets: fileOffsets, groupOffsets } = sim;

  const ids = useMemo(() => tagged.map((i) => i.pattern.id), [tagged]);
  const offsets = useMemo(
    () => combineOffsets(ids, fileOffsets, groupOffsets, membership),
    [ids, fileOffsets, groupOffsets, membership],
  );

  const tilt = useMemo(() => ({ electricalDeg, mechanicalDeg }), [electricalDeg, mechanicalDeg]);
  const global = useMemo(
    () => ({ electricalDeg, mechanicalDeg, azimuthDeg }),
    [electricalDeg, mechanicalDeg, azimuthDeg],
  );
  const effective = useCallback((id: string) => effectiveFor(global, offsets[id]), [global, offsets]);
  const isTiltedId = useCallback((id: string) => isTilted(effective(id)), [effective]);
  const simulatedAmong = useCallback((ids: Iterable<string>) => anySimulated(effective, ids), [effective]);
  const offsetsAmong = useCallback((ids: Iterable<string>) => offsetCountsAmong(ids, fileOffsets, groupOffsets, membership), [fileOffsets, groupOffsets, membership]);
  const tiltActive = useMemo(() => anyTilted(ids, global, offsets), [ids, global, offsets]);

  // A tilt-only view of the per-file settings, stable across an azimuth-only change (global or
  // per-file): used for tiltEach/analyzeTilted so `patterns`/`metrics` keep their Map identity
  // when only an azimuth moves (M2). `effective` (below) still carries azimuth, for rotation/CSV.
  const tiltOffsets = useStableByKey(
    offsets,
    Object.keys(offsets)
      .sort()
      .map((id) => `${id}:${offsets[id].electricalDeg}:${offsets[id].mechanicalDeg}`)
      .join('|'),
  );
  const tiltFor = useCallback(
    (id: string): TiltSettings => {
      const o = tiltOffsets[id];
      return {
        electricalDeg: electricalDeg + (o?.electricalDeg ?? 0),
        mechanicalDeg: mechanicalDeg + (o?.mechanicalDeg ?? 0),
      };
    },
    [electricalDeg, mechanicalDeg, tiltOffsets],
  );

  const tiltedItems = useMemo(
    () => (tiltActive ? tiltEach(tagged, tiltFor, method) : tagged),
    [tiltActive, tagged, tiltFor, method],
  );
  const tiltedMetrics = useMemo(
    () => (tiltActive ? analyzeTilted(tiltedItems, settings, tiltFor) : metrics),
    [tiltActive, tiltedItems, settings, tiltFor, metrics],
  );
  const patterns = useMemo(() => new Map(tiltedItems.map((i) => [i.pattern.id, i.pattern])), [tiltedItems]);
  const offsetCount = tagged.reduce((n, i) => n + (fileOffsets[i.pattern.id] ? 1 : 0), 0);
  const groupOffsetCount = customGroups.filter((g) => groupOffsets[g.id]).length;

  // Memoised so consumers' useMemo dependencies on `sim` only change when the simulation does.
  return useMemo(
    () => ({
      tiltActive,
      tilt,
      azimuthDeg,
      showOriginal,
      offsetCount,
      groupOffsetCount,
      effective,
      simulatedAmong,
      offsetsAmong,
      isTiltedId,
      patterns,
      metrics: tiltedMetrics,
    }),
    [
      tiltActive,
      tilt,
      azimuthDeg,
      showOriginal,
      offsetCount,
      groupOffsetCount,
      effective,
      simulatedAmong,
      offsetsAmong,
      isTiltedId,
      patterns,
      tiltedMetrics,
    ],
  );
}
