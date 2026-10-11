import { memo, useMemo } from 'react';
import { useStore } from '../state/store';
import type { GroupView } from '../state/selectors';
import type { PatternMetrics } from '../core/analysis/metrics';
import { buildHpbwFigure, type HpbwSeries } from './hpbwFigure';
import { FIGURE_THEMES } from './figureTheme';
import { PALETTE } from './colors';
import { PlotlyChart } from './PlotlyChart';
import type { SimulationResult } from './useSimulation';

export const HpbwChart = memo(function HpbwChart({
  groups,
  metrics,
  sim,
}: {
  groups: GroupView[];
  metrics: Map<string, PatternMetrics>;
  colors: Map<string, string>;
  sim: SimulationResult;
}) {
  const visible = useStore((s) => s.visible);
  const theme = useStore((s) => s.view.theme);

  const figure = useMemo(() => {
    const series: HpbwSeries[] = [];
    groups
      .filter((g) => g.items.some((i) => visible[i.pattern.id]))
      .forEach((g, k) => {
        const color = PALETTE[k % PALETTE.length];
        const points = (ms: Map<string, PatternMetrics>) =>
          g.items.map(({ pattern }) => {
            const m = ms.get(pattern.id);
            return {
              freq: pattern.frequencyMHz,
              h: m?.h.hpbw.value ?? null,
              v: m?.v.hpbw.value ?? null,
              declH: pattern.declared.hBeamwidth,
              declV: pattern.declared.vBeamwidth,
            };
          });
        if (g.items.some((i) => sim.isTiltedId(i.pattern.id)))
          series.push({ label: g.label, color, ghost: true, points: points(metrics) });
        series.push({ label: g.label, color, points: points(sim.metrics) });
      });
    return series.length ? buildHpbwFigure(series, FIGURE_THEMES[theme]) : null;
  }, [groups, metrics, visible, theme, sim]);

  if (!figure) return null;
  return (
    <section>
      <h2>
        HPBW vs frequency (groups with a visible file; hollow markers = declared)
        {sim.tiltActive ? ' — faint lines = original' : ''}
      </h2>
      <PlotlyChart className="plot wide" figure={figure} testId="plot-hpbw" ariaLabel="Half-power beamwidth against frequency, one line per group" />
    </section>
  );
});
