import { memo, useMemo } from 'react';
import { useStore } from '../state/store';
import type { GroupView } from '../state/selectors';
import type { PatternMetrics } from '../core/analysis/metrics';
import { buildHpbwFigure, hpbwCaption, type HpbwSeries } from './hpbwFigure';
import { buildMetricFigure, metricCaption, type MetricSeries } from './metricFigure';
import { cellsOf, columnLabel, COLUMN_GROUPS, METRIC_COLUMNS, type MetricColumn } from './table';
import type { Pattern } from '../core/types';
import { FIGURE_THEMES } from './figureTheme';
import { groupLook, PER_FILE_COLOURS } from './colors';
import { bwName } from './bwLabel';
import { nameOf } from '../core/names';
import { PlotlyChart } from './PlotlyChart';
import type { SimulationResult } from './useSimulation';

const DECLARED: Partial<Record<MetricColumn, (p: Pattern) => number | undefined>> = {
  vHpbw: (p) => p.declared.vBeamwidth,
  fb180: (p) => p.declared.frontToBack,
};

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
  const levelDb = useStore((s) => s.settings.levelDb);
  const fbWindowDeg = useStore((s) => s.settings.fbWindowDeg);
  const uslsRangeDeg = useStore((s) => s.settings.uslsRangeDeg);
  const metric = useStore((s) => s.view.freqMetric);
  const reference = useStore((s) => s.reference);
  const updateView = useStore((s) => s.updateView);
  const simulated = sim.tiltActive;
  const labelOf = (c: (typeof METRIC_COLUMNS)[number]) => columnLabel(c, fbWindowDeg, uslsRangeDeg, levelDb);
  const column = METRIC_COLUMNS.find((c) => c.key === metric) ?? METRIC_COLUMNS[0];
  // H-HPBW keeps the two-panel chart of the beamwidths (H above, V below); every other metric has one panel.
  const both = metric === 'hHpbw';

  const label = labelOf(column);
  const vColumn = METRIC_COLUMNS.find((c) => c.key === 'vHpbw') ?? METRIC_COLUMNS[0];
  // The diamond is only mentioned when it is drawn: the reference file exists here and has metrics.
  const refDrawn = reference !== null && sim.metrics.has(reference) && groups.some((g) => g.items.some((i) => i.pattern.id === reference));

  const figure = useMemo(() => {
    const series: HpbwSeries[] = [];
    const single: MetricSeries[] = [];
    // Above ten visible files the files are coloured by group: the group's line takes the colour of its place among all groups (see colors.ts).
    const byGroup = groups.reduce((n, g) => n + g.items.filter((i) => visible[i.pattern.id]).length, 0) > PER_FILE_COLOURS;
    groups.forEach((g, k) => {
      if (!g.items.some((i) => visible[i.pattern.id])) return;
      const { color, symbol } = groupLook(k, byGroup);
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
      const valuePoints = (ms: Map<string, PatternMetrics>) =>
        g.items.map(({ pattern }) => {
          const m = ms.get(pattern.id);
          const declared = DECLARED[metric]?.(pattern);
          return { freq: pattern.frequencyMHz, value: m ? cellsOf(m)[metric].value : null, ...(declared !== undefined ? { declared } : {}) };
        });
      const ghost = g.items.some((i) => sim.isTiltedId(i.pattern.id));
      if (both) {
        if (ghost) series.push({ label: g.label, color, ghost: true, points: points(metrics) });
        series.push({ label: g.label, color, symbol, points: points(sim.metrics) });
      } else {
        if (ghost) single.push({ label: g.label, color, ghost: true, points: valuePoints(metrics) });
        single.push({ label: g.label, color, symbol, points: valuePoints(sim.metrics) });
      }
    });
    // The reference file's point (its value as plotted: the tilted one under a simulation), whether or not its group is shown.
    const refItem = reference === null ? undefined : groups.flatMap((g) => g.items).find((i) => i.pattern.id === reference);
    const refMetrics = refItem ? sim.metrics.get(refItem.pattern.id) : undefined;
    const refLabel = refItem ? nameOf(refItem.pattern) : '';
    const freq = refItem?.pattern.frequencyMHz ?? 0;
    if (both) {
      const ref = refMetrics ? { label: refLabel, point: { freq, h: refMetrics.h.hpbw.value, v: refMetrics.v.hpbw.value } } : undefined;
      return series.length ? buildHpbwFigure(series, FIGURE_THEMES[theme], levelDb, ref) : null;
    }
    const ref = refMetrics ? { label: refLabel, point: { freq, value: cellsOf(refMetrics)[metric].value } } : undefined;
    return single.length ? buildMetricFigure(single, FIGURE_THEMES[theme], label, column.unit, ref) : null;
  }, [groups, metrics, visible, theme, sim, levelDb, metric, both, label, column.unit, reference]);

  const exportCaption = useMemo(
    () => (both ? hpbwCaption(levelDb, simulated, refDrawn) : metricCaption(label, column.unit, simulated, refDrawn, Boolean(DECLARED[metric]))),
    [both, levelDb, simulated, label, column.unit, refDrawn, metric],
  );

  if (!figure) return null;
  const heading = both ? bwName(levelDb) : label;
  return (
    <section>
      <div className="freq-head">
        <h2>
          {heading} vs frequency (groups with a visible file{both || DECLARED[metric] ? '; hollow markers = declared' : ''})
          {sim.tiltActive ? ' — faint lines = original' : ''}
          {refDrawn ? ' — diamond = reference' : ''}
        </h2>
        <div className="freq-metric">
          <label htmlFor="freq-metric">Metric</label>
          <select id="freq-metric" value={metric} onChange={(e) => updateView({ freqMetric: e.target.value as MetricColumn })}>
            {COLUMN_GROUPS.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {METRIC_COLUMNS.filter((c) => c.group === g.key).map((c) => (
                  <option key={c.key} value={c.key}>
                    {labelOf(c)} ({c.unit}){c.key === 'hHpbw' ? ` with ${labelOf(vColumn)}` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
      <PlotlyChart
        className="plot wide"
        figure={figure}
        testId="plot-hpbw"
        ariaLabel={
          both
            ? `${levelDb === 3 ? 'Half-power beamwidth' : `Beamwidth at ${levelDb} dB`} against frequency, one line per group`
            : `${label} (${column.unit}) against frequency, one line per group`
        }
        labelledExport={{ caption: exportCaption, filename: both ? 'beamwidth-vs-frequency' : `${metric}-vs-frequency` }}
      />
    </section>
  );
});
