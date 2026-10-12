import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useStore, type SimulationState } from '../state/store';
import type { Pattern } from '../core/types';
import type { AnalysisSettings, PatternMetrics, TaggedPattern } from '../core/analysis/metrics';
import {
  analyzeTilted,
  anyTilted,
  combineOffsets,
  effectiveFor,
  isTilted,
  tiltEach,
  type HCutMode,
  type SimSettings,
  type TiltSettings,
} from '../core/analysis/tilt';
import { anySimulated, offsetCountsAmong } from './simSummary';
import { useHeldWhile } from './heldValue';
import { GRIP_PAUSE_MS, useSliderGrip } from './sliderHold';
import { noteShownSimulation, onCatchUp } from './simCurrent';

export interface SimulationResult {
  /** True when any loaded file is tilted (effective Δe or m non-zero). */
  tiltActive: boolean;
  /** Global tilt sliders. */
  tilt: TiltSettings;
  /** Global azimuth slider. */
  azimuthDeg: number;
  showOriginal: boolean;
  /**
   * True when `patterns` and `metrics` are a simulated run: a file is tilted, or the horizontal cut is the one at the
   * horizon (every file then shows its horizon cut, tilted or not).
   */
  simActive: boolean;
  /** Which horizontal cut the simulated files show (`patterns` and `metrics` are made with it). */
  hCut: HCutMode;
  /** Number of files with offsets. */
  offsetCount: number;
  /** Number of custom groups with offsets. */
  groupOffsetCount: number;
  /** Effective settings of a file (global + its offsets). */
  effective(id: string): SimSettings;
  /**
   * Whether any of these files (the ones a picture draws or an export lists) is simulated; see `anySimulated`. The
   * horizon cut makes every file simulated, except with `hCutCounts` false: for a picture that does not show the
   * horizontal cut (the vertical cut, the 3D view). An azimuth counts too (it turns the drawing), except with
   * `turnCounts` false: for what does not turn (the table, the statistics, the frequency chart, the vertical cut).
   */
  simulatedAmong(ids: Iterable<string>, hCutCounts?: boolean, turnCounts?: boolean): boolean;
  /** The per-file and per-group offsets among these files (what a picture shows, see `offsetCountsAmong`). */
  offsetsAmong(ids: Iterable<string>): { files: number; groups: number };
  /** Whether a file's effective tilt is non-zero. */
  isTiltedId(id: string): boolean;
  /** Whether a file shows a simulated horizontal cut: it is tilted, or the cut is the one at the horizon. */
  showsSimulatedH(id: string): boolean;
  /** Simulated pattern per id (the original pattern for a file that is not simulated). */
  patterns: Map<string, Pattern>;
  /** Metrics of the simulated run (the original metrics when there is none, see `simActive`). */
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

/** The sliders' state the simulation is made from, a moment behind the store's. */
export interface SettledSimulation {
  state: SimulationState;
  /** The store has a newer state: the plots and the table show an older simulation. */
  behind: boolean;
  /** The newer state is held back until the slider that is being dragged stops (see `followsDrag`). */
  waiting: boolean;
}

/**
 * The simulation state the plots and the table are made from. It follows the store's a render later (deferred), so a
 * slider's thumb and number are answered first. Where the page does not follow a drag (`follows` false: too many
 * files, see `followsDrag`), a gripped slider holds it back: the steps in between are dropped and the last one is
 * taken once, at release (for the arrow keys a moment after it, so that a run of taps is one) or when the slider has
 * stopped for a moment. Whatever is set without a grip (a number box,
 * Reset, undo, a loaded project) is followed at once, and the end state is the same either way.
 *
 * An export does not wait (see `catchUpSimulation`): it takes the store's state at once, in a render of its own that
 * neither the hold nor the deferral delays, and a hold that goes on starts again from there.
 */
export function useSettledSimulation(follows: boolean): SettledSimulation {
  const live = useStore((s) => s.view.simulation);
  const grip = useSliderGrip(!follows);
  const held = useHeldWhile(live, grip !== null, grip ? GRIP_PAUSE_MS[grip] : undefined);
  // Deferred so dragging a slider stays smooth while tilting/analysing catches up.
  const deferred = useDeferredValue(held.value);
  // The state an export asked for at once: used while it is still the store's.
  const [caughtUp, setCaughtUp] = useState<SimulationState | null>(null);
  const state = caughtUp === live ? live : deferred;
  const { handOn } = held;
  useEffect(
    () =>
      onCatchUp(() =>
        flushSync(() => {
          const now = useStore.getState().view.simulation;
          handOn(now);
          setCaughtUp(now);
        }),
      ),
    [handOn],
  );
  useLayoutEffect(() => {
    noteShownSimulation(state);
  }, [state]);
  useEffect(() => () => noteShownSimulation(null), []);
  return { state, behind: state !== live, waiting: held.waiting };
}

export function useSimulation(
  tagged: TaggedPattern[],
  metrics: Map<string, PatternMetrics>,
  settings: AnalysisSettings,
  /** Compute the angular-region estimate for the tilted files too (see `needsAngularRegions`). */
  withAngularRegions = false,
  /** The state to simulate (see `useSettledSimulation`); without one, the store's, a render later. */
  settled?: SimulationState,
): SimulationResult {
  const live = useStore((s) => s.view.simulation);
  const method = useStore((s) => s.view.method3d);
  const membership = useStore((s) => s.membership);
  const customGroups = useStore((s) => s.customGroups);
  // Deferred so dragging a slider stays smooth while tilting/analysing catches up. A settled state already is, and is
  // taken as it comes: deferring it again would add nothing, and would delay the one an export asked for at once.
  const deferred = useDeferredValue(live);
  const sim = settled ?? deferred;
  const { electricalDeg, mechanicalDeg, azimuthDeg, showOriginal, hCut, offsets: fileOffsets, groupOffsets } = sim;

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
  const showsSimulatedH = useCallback((id: string) => hCut === 'horizon' || isTilted(effective(id)), [hCut, effective]);
  const simulatedAmong = useCallback(
    (ids: Iterable<string>, hCutCounts = true, turnCounts = true) => anySimulated(effective, ids, hCutCounts && hCut === 'horizon', turnCounts),
    [effective, hCut],
  );
  const offsetsAmong = useCallback((ids: Iterable<string>) => offsetCountsAmong(ids, fileOffsets, groupOffsets, membership), [fileOffsets, groupOffsets, membership]);
  const tiltActive = useMemo(() => anyTilted(ids, global, offsets), [ids, global, offsets]);
  const simActive = tiltActive || hCut === 'horizon';

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
    () => (simActive ? tiltEach(tagged, tiltFor, method, hCut) : tagged),
    [simActive, tagged, tiltFor, method, hCut],
  );
  const tiltedMetrics = useMemo(
    () => (simActive ? analyzeTilted(tiltedItems, settings, tiltFor, withAngularRegions ? method : undefined) : metrics),
    [simActive, tiltedItems, settings, tiltFor, metrics, withAngularRegions, method],
  );
  const patterns = useMemo(() => new Map(tiltedItems.map((i) => [i.pattern.id, i.pattern])), [tiltedItems]);
  const offsetCount = tagged.reduce((n, i) => n + (fileOffsets[i.pattern.id] ? 1 : 0), 0);
  const groupOffsetCount = customGroups.filter((g) => groupOffsets[g.id]).length;

  // Memoised so consumers' useMemo dependencies on `sim` only change when the simulation does.
  return useMemo(
    () => ({
      tiltActive,
      simActive,
      tilt,
      azimuthDeg,
      showOriginal,
      hCut,
      offsetCount,
      groupOffsetCount,
      effective,
      simulatedAmong,
      offsetsAmong,
      isTiltedId,
      showsSimulatedH,
      patterns,
      metrics: tiltedMetrics,
    }),
    [
      tiltActive,
      simActive,
      tilt,
      azimuthDeg,
      showOriginal,
      hCut,
      offsetCount,
      groupOffsetCount,
      effective,
      simulatedAmong,
      offsetsAmong,
      isTiltedId,
      showsSimulatedH,
      patterns,
      tiltedMetrics,
    ],
  );
}
