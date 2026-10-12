import type { PatternMetrics, TaggedPattern } from '../core/analysis/metrics';
import { nameOf } from '../core/names';
import type { PlotSeries } from './cutFigure';
import type { FileStyle } from './colors';
import type { SimulationResult } from './useSimulation';

/** A horizon cut whose maximum is more than this far below the 3D peak is a dot or a small circle at the centre of a polar plot. */
export const FAR_BELOW_PEAK_DB = 15;
export const FAR_BELOW_PEAK_NOTE = 'This cut is far below the peak; the rectangular view shows it better';

/** Whether one of the drawn files has a horizon cut whose maximum lies more than `FAR_BELOW_PEAK_DB` below its 3D peak. */
export function horizonCutFarBelowPeak(drawnIds: readonly string[], metrics: ReadonlyMap<string, { hCutPeakDb?: number }>): boolean {
  return drawnIds.some((id) => (metrics.get(id)?.hCutPeakDb ?? 0) > FAR_BELOW_PEAK_DB);
}

/** The non-solid line pattern of a file's style, if any. */
const lineDashOf = (style: FileStyle | undefined) => (style && style.dash !== 'solid' ? style.dash : undefined);

/** Which simulated horizontal cut a live series is, if any: the horizon cut (every file, tilted or not), else the cone cut of a mechanically tilted one. */
function simulatedCutFlag(sim: SimulationResult, id: string): { horizonCut?: true; coneCut?: true } {
  if (sim.hCut === 'horizon') return { horizonCut: true };
  return sim.effective(id).mechanicalDeg !== 0 ? { coneCut: true } : {};
}

/**
 * The 2D series of one cut: the (simulated) series of every item, then — only for files whose cut
 * is simulated, when "Show original" is on — the dashed original series, so the legend lists live
 * traces first. A horizon cut is simulated for every file; the vertical cut only for a tilted one.
 * Items without metrics are skipped.
 */
export function buildCutSeries(
  items: TaggedPattern[],
  sim: SimulationResult,
  originalMetrics: Map<string, PatternMetrics>,
  colors: Map<string, string>,
  cut: 'H' | 'V',
  styles?: Map<string, FileStyle>,
  /** The pinned reference file: its live series is flagged and named, and it has no dashed original (the reference is what the table's differences are taken from). */
  referenceId?: string | null,
): PlotSeries[] {
  const rotation = (id: string) => (cut === 'H' ? sim.effective(id).azimuthDeg : 0);
  const changed = (id: string) => (cut === 'H' ? sim.showsSimulatedH(id) : sim.isTiltedId(id));
  const series = (original: boolean): PlotSeries[] =>
    items.flatMap(({ pattern: orig }) => {
      if (original && (!changed(orig.id) || orig.id === referenceId)) return [];
      const m = (original ? originalMetrics : sim.metrics).get(orig.id);
      if (!m) return [];
      const p = original ? orig : (sim.patterns.get(orig.id) ?? orig);
      return [
        {
          id: original ? `${orig.id}#original` : orig.id,
          label: `${orig.frequencyMHz} MHz · ${nameOf(orig)}${original ? ' (original)' : orig.id === referenceId ? ' (reference)' : ''}`,
          color: colors.get(orig.id) ?? '#888888',
          cut: cut === 'H' ? p.horizontal : p.vertical,
          metrics: m,
          dash: original,
          ...(!original && orig.id === referenceId ? { reference: true } : {}),
          ...(!original && lineDashOf(styles?.get(orig.id)) ? { lineDash: lineDashOf(styles?.get(orig.id)) } : {}),
          rotationDeg: rotation(orig.id),
          ...(cut === 'H' && !original ? simulatedCutFlag(sim, orig.id) : {}),
        },
      ];
    });
  return [...series(false), ...(sim.showOriginal ? series(true) : [])];
}

/**
 * The items a 2D cut draws: the ticked ones, plus the pinned reference when it is not among them (also when nothing
 * else is ticked, so the reference is then drawn alone).
 */
export function withReference<T extends { pattern: { id: string } }>(ticked: T[], all: T[], referenceId: string | null): T[] {
  if (referenceId === null || ticked.some((i) => i.pattern.id === referenceId)) return ticked;
  const ref = all.find((i) => i.pattern.id === referenceId);
  return ref ? [...ticked, ref] : ticked;
}
