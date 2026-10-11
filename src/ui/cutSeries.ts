import type { PatternMetrics, TaggedPattern } from '../core/analysis/metrics';
import { nameOf } from '../core/names';
import type { PlotSeries } from './cutFigure';
import type { SimulationResult } from './useSimulation';

/**
 * The 2D series of one cut: the (tilted) series of every item, then — only for files that are
 * tilted, when "Show original" is on — the dashed original series, so the legend lists live
 * traces first. Items without metrics are skipped.
 */
export function buildCutSeries(
  items: TaggedPattern[],
  sim: SimulationResult,
  originalMetrics: Map<string, PatternMetrics>,
  colors: Map<string, string>,
  cut: 'H' | 'V',
): PlotSeries[] {
  const rotation = (id: string) => (cut === 'H' ? sim.effective(id).azimuthDeg : 0);
  const series = (original: boolean): PlotSeries[] =>
    items.flatMap(({ pattern: orig }) => {
      if (original && !sim.isTiltedId(orig.id)) return [];
      const m = (original ? originalMetrics : sim.metrics).get(orig.id);
      if (!m) return [];
      const p = original ? orig : (sim.patterns.get(orig.id) ?? orig);
      return [
        {
          id: original ? `${orig.id}#original` : orig.id,
          label: `${orig.frequencyMHz} MHz · ${nameOf(orig)}${original ? ' (original)' : ''}`,
          color: colors.get(orig.id) ?? '#888888',
          cut: cut === 'H' ? p.horizontal : p.vertical,
          metrics: m,
          dash: original,
          rotationDeg: rotation(orig.id),
        },
      ];
    });
  return [...series(false), ...(sim.showOriginal ? series(true) : [])];
}
