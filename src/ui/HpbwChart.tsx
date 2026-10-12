import { memo, useMemo } from 'react';
import { PlotBoundary } from './ErrorBoundary';
import type { Figure } from './figureTheme';
import type { ExportCaption } from './exportFigure';
import { useStore } from '../state/store';
import type { GroupView } from '../state/selectors';
import type { PatternMetrics } from '../core/analysis/metrics';
import { buildHpbwFigure, hpbwCaption, type HpbwSeries } from './hpbwFigure';
import { buildMetricFigure, coincidingNote, metricCaption, noValueNote, noValues, plottedFileIds, type LineSignature, type MetricSeries } from './metricFigure';
import { chartColumns, chartFitsData, columnLabel, COLUMN_GROUPS, followsHCut, HORIZON_LEVEL_COLUMN, METRIC_COLUMNS, metricValue, shownChartMetric, withMethod, type ColumnSpec, type TableColumn } from './table';
import type { Pattern } from '../core/types';
import { FIGURE_THEMES } from './figureTheme';
import { groupLook, PER_FILE_COLOURS } from './colors';
import { bwName } from './bwLabel';
import { nameOf } from '../core/names';
import { hasUsableFrequency } from '../core/gain';
import { withSimulated } from './exportFigure';
import { exportName, simulatedCaption, weightedHorizonNote } from './simSummary';
import { PlotlyChart } from './PlotlyChart';
import type { SimulationResult } from './useSimulation';

const DECLARED: Partial<Record<TableColumn, (p: Pattern) => number | undefined>> = {
  vHpbw: (p) => p.declared.vBeamwidth,
  fb180: (p) => p.declared.frontToBack,
};

/** The note under the frequency chart's heading for ticked files without a usable frequency. */
const leftOutText = (n: number): string =>
  `${n} ticked file${n === 1 ? ' has' : 's have'} no frequency above 0 MHz and ${n === 1 ? 'is' : 'are'} left out of this chart.`;

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
  // The Horizon level exists only at the horizon: while the cut is another one, the stored choice shows the beamwidths.
  const horizonCut = sim.hCut === 'horizon';
  const metric = shownChartMetric(useStore((s) => s.view.freqMetric), horizonCut);
  const isLevel = metric === HORIZON_LEVEL_COLUMN.key;
  const reference = useStore((s) => s.reference);
  const updateView = useStore((s) => s.updateView);
  const pickFile = useStore((s) => s.pickFile);
  // A metric read from the horizontal cut follows the cut at the horizon for every file, tilted or not; the two-panel
  // beamwidth chart has the horizontal beamwidth in it.
  const followsH = followsHCut(metric);
  // (The Horizon level has no original to draw: a file cut has none.)
  const simulated = !isLevel && (sim.tiltActive || (followsH && sim.simActive));
  // With no tilt on any file the faint lines are not "originals before a tilt": they are the file's own cut under the horizon cut.
  const fileCut = simulated && !sim.tiltActive;
  const labelOf = (c: ColumnSpec) => columnLabel(c, fbWindowDeg, uslsRangeDeg, levelDb);
  const menu = chartColumns(horizonCut);
  const column = menu.find((c) => c.key === metric) ?? METRIC_COLUMNS[0];
  // H-HPBW keeps the two-panel chart of the beamwidths (H above, V below); every other metric has one panel.
  const both = metric === 'hHpbw';

  const method3d = useStore((s) => s.view.method3d);
  const label = labelOf(column);
  // In the picture (axis title, caption) the angular-region estimate carries its 3D method, as its CSV header does.
  const plotLabel = withMethod(column.key, label, method3d);
  const vColumn = METRIC_COLUMNS.find((c) => c.key === 'vHpbw') ?? METRIC_COLUMNS[0];
  // The diamond is only mentioned when it is drawn: the reference file exists here and has metrics.
  const refDrawn = reference !== null && sim.metrics.has(reference) && groups.some((g) => g.items.some((i) => i.pattern.id === reference && hasUsableFrequency(i.pattern.frequencyMHz)));
  const leftOut = useMemo(() => groups.reduce((n, g) => n + g.items.filter((i) => visible[i.pattern.id] && !hasUsableFrequency(i.pattern.frequencyMHz)).length, 0), [groups, visible]);

  // The series are put together here; the figure itself is built inside the chart's error boundary (see `FrequencyPlot`).
  const { build, empty, coincide } = useMemo<{ build: (() => Figure) | null; empty: string | null; coincide: string | null }>(() => {
    const series: HpbwSeries[] = [];
    const single: MetricSeries[] = [];
    // Above ten visible files the files are coloured by group: the group's line takes the colour of its place among all groups (see colors.ts).
    const byGroup = groups.reduce((n, g) => n + g.items.filter((i) => visible[i.pattern.id] && hasUsableFrequency(i.pattern.frequencyMHz)).length, 0) > PER_FILE_COLOURS;
    groups.forEach((g, k) => {
      if (!g.items.some((i) => visible[i.pattern.id] && hasUsableFrequency(i.pattern.frequencyMHz))) return;
      const { color, symbol } = groupLook(k, byGroup);
      const points = (ms: Map<string, PatternMetrics>) =>
        g.items.filter(({ pattern }) => hasUsableFrequency(pattern.frequencyMHz)).map(({ pattern }) => {
          const m = ms.get(pattern.id);
          return {
            id: pattern.id,
            freq: pattern.frequencyMHz,
            h: m?.h.hpbw.value ?? null,
            v: m?.v.hpbw.value ?? null,
            declH: pattern.declared.hBeamwidth,
            declV: pattern.declared.vBeamwidth,
          };
        });
      const valuePoints = (ms: Map<string, PatternMetrics>) =>
        g.items.filter(({ pattern }) => hasUsableFrequency(pattern.frequencyMHz)).map(({ pattern }) => {
          const m = ms.get(pattern.id);
          const declared = DECLARED[metric]?.(pattern);
          return { id: pattern.id, freq: pattern.frequencyMHz, value: m ? metricValue(m, metric).value : null, ...(declared !== undefined ? { declared } : {}) };
        });
      const ghost = !isLevel && g.items.some((i) => (followsH ? sim.showsSimulatedH(i.pattern.id) : sim.isTiltedId(i.pattern.id)));
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
    const refMetrics = refItem && hasUsableFrequency(refItem.pattern.frequencyMHz) ? sim.metrics.get(refItem.pattern.id) : undefined;
    const refLabel = refItem ? nameOf(refItem.pattern) : '';
    const freq = refItem?.pattern.frequencyMHz ?? 0;
    if (both) {
      const ref = refMetrics ? { label: refLabel, point: { id: refItem?.pattern.id, freq, h: refMetrics.h.hpbw.value, v: refMetrics.v.hpbw.value } } : undefined;
      // A line is the same as another only when both its panels are (the vertical points are told apart by a negative frequency).
      const lines: LineSignature[] = series.filter((s) => !s.ghost).map((s) => ({ label: s.label, points: [...s.points.map((p) => ({ freq: p.freq, value: p.h })), ...s.points.map((p) => ({ freq: -p.freq, value: p.v }))] }));
      return { build: series.length ? () => buildHpbwFigure(series, FIGURE_THEMES[theme], levelDb, ref) : null, empty: null, coincide: coincidingNote(lines) };
    }
    const ref = refMetrics ? { label: refLabel, point: { id: refItem?.pattern.id, freq, value: metricValue(refMetrics, metric).value } } : undefined;
    if (!single.length) return { build: null, empty: null, coincide: null };
    // Nothing to draw at a number: say so (with the reasons the table's tooltips give) instead of an empty chart.
    if (noValues(single, ref)) {
      // Only the files the chart tried to draw: not those of hidden groups, nor files without a frequency.
      const reasons = plottedFileIds(groups, visible).map((id) => { const m = sim.metrics.get(id); return m ? metricValue(m, metric).reason : undefined; });
      return { build: null, empty: noValueNote(label, reasons), coincide: null };
    }
    return { build: () => buildMetricFigure(single, FIGURE_THEMES[theme], plotLabel, column.unit, ref, { fitToData: chartFitsData(metric) }), empty: null, coincide: coincidingNote(single.filter((s) => !s.ghost)) };
  }, [groups, metrics, visible, theme, sim, levelDb, metric, both, followsH, isLevel, label, plotLabel, column.unit, reference]);

  // The chart plots every file of a group that has a visible file, and the reference's diamond.
  const plottedIds = useMemo(
    () => [
      ...plottedFileIds(groups, visible),
      ...(refDrawn && reference !== null ? [reference] : []),
    ],
    [groups, visible, refDrawn, reference],
  );
  // A metric of the vertical cut does not depend on the horizontal cut chosen, and its picture does not name it.
  const exportSimulated = sim.simulatedAmong(plottedIds, followsH);
  const simulatedLine = exportSimulated ? simulatedCaption(followsH ? sim : { ...sim, hCut: undefined }, method3d, sim.offsetsAmong(plottedIds)) : undefined;
  const exportCaption = useMemo(
    () =>
      withSimulated(
        both ? hpbwCaption(levelDb, simulated, refDrawn, fileCut) : metricCaption(plotLabel, column.unit, simulated, refDrawn, Boolean(DECLARED[metric]), fileCut),
        simulatedLine,
        followsH ? weightedHorizonNote(sim.hCut, method3d) : undefined,
      ),
    [both, levelDb, simulated, fileCut, plotLabel, column.unit, refDrawn, metric, simulatedLine, followsH, sim.hCut, method3d],
  );

  const note = leftOut > 0 ? <p className="count" data-testid="freq-left-out">{leftOutText(leftOut)}</p> : null;
  if (!build && !empty) return note && <section>{note}</section>;
  const heading = both ? bwName(levelDb) : label;
  return (
    <section>
      <div className="freq-head">
        <h2>
          {heading} vs frequency (groups with a visible file{both || DECLARED[metric] ? '; hollow markers = declared' : ''})
          {simulated ? (fileCut ? " — faint lines: the file's own cut" : ' — faint lines = original') : ''}
          {refDrawn ? ' — diamond = reference' : ''}
        </h2>
        <div className="freq-metric">
          <label htmlFor="freq-metric">Metric</label>
          <select id="freq-metric" value={metric} onChange={(e) => updateView({ freqMetric: e.target.value as TableColumn })}>
            {COLUMN_GROUPS.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {menu.filter((c) => c.group === g.key).map((c) => (
                  <option key={c.key} value={c.key}>
                    {labelOf(c)} ({c.unit}){c.key === 'hHpbw' ? ` with ${labelOf(vColumn)}` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
      {note}
      {/* A figure that cannot be built or drawn fails in the chart's place: the heading and the Metric menu stay, and another metric or other files clear it. */}
      {build === null ? (
        <p className="count" role="status" data-testid="freq-no-value">{empty}</p>
      ) : (
      <PlotBoundary className="plot wide" resetKeys={[build]}>
        <FrequencyPlot
          build={build}
          ariaLabel={
            both
              ? `${levelDb === 3 ? 'Half-power beamwidth' : `Beamwidth at ${levelDb} dB`} against frequency, one line per group`
              : `${plotLabel} (${column.unit}) against frequency, one line per group`
          }
          caption={exportCaption}
          filename={exportName(both ? 'beamwidth-vs-frequency' : `${metric}-vs-frequency`, exportSimulated)}
          onPointClick={pickFile}
        />
      </PlotBoundary>
      )}
      {coincide && <p className="count" data-testid="freq-coincide">{coincide}</p>}
    </section>
  );
});

/** The frequency chart itself: builds the figure and draws it. */
function FrequencyPlot({ build, ariaLabel, caption, filename, onPointClick }: { build: () => Figure; ariaLabel: string; caption: ExportCaption | undefined; filename: string; onPointClick: (id: string) => void }) {
  const figure = useMemo(build, [build]);
  return <PlotlyChart className="plot wide" figure={figure} testId="plot-hpbw" toolbar="xy" ariaLabel={ariaLabel} labelledExport={{ caption, filename }} onPointClick={onPointClick} />;
}
