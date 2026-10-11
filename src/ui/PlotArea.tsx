import { memo, useDeferredValue, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, type CutView, type Dimension, type Layout3d, type MarkerKey, type PlotMode } from '../state/store';
import type { GroupView } from '../state/selectors';
import type { PatternMetrics } from '../core/analysis/metrics';
import { buildCutFigure, markerReadout } from './cutFigure';
import { bwMarkerLabel } from './bwLabel';
import { buildCutSeries, withReference } from './cutSeries';
import { FIGURE_THEMES, type Figure } from './figureTheme';
import { showFileLegend } from './legend';
import { PlotlyChart } from './PlotlyChart';
import { Pattern3D } from './Pattern3D';
import { SimulationBar } from './SimulationBar';
import { Seg } from './Seg';
import { PER_FILE_COLOURS, type FileStyle } from './colors';
import type { SimulationResult } from './useSimulation';

interface Props {
  groups: GroupView[];
  metrics: Map<string, PatternMetrics>;
  colors: Map<string, string>;
  /** Colour and line pattern of each shown file. */
  styles: Map<string, FileStyle>;
  sim: SimulationResult;
}

/** The marker names in display order; the first follows the beamwidth level of the settings. */
const markerLabels = (levelDb: number): Record<MarkerKey, string> => ({
  hpbw: bwMarkerLabel(levelDb),
  fb: 'F/B window',
  usls: 'Sidelobes',
  null: 'Null fill',
  peak: 'Beam direction',
  sector: 'Sector',
});

/** The names of the markers that are on, for the folded "Markers" control. */
const shownMarkers = (markers: Record<MarkerKey, boolean>, labels: Record<MarkerKey, string>): string => {
  const on = (Object.keys(labels) as MarkerKey[]).filter((k) => markers[k]).map((k) => labels[k]);
  return on.length > 0 ? on.join(' · ') : 'none';
};

interface CutPlotProps {
  id: 'h' | 'v';
  figure: Figure;
  readout: string[];
  target: string;
  traces: number;
  /** The file the figure emphasises (see `PlotlyChart` `previewBase`). */
  emphasised: string | null;
  /** More than ten files are shown: colours go by group, a shade per file. */
  byGroup: boolean;
  /** Label of the pinned reference file when it is drawn (it has no legend entry without a legend). */
  referenceLabel: string | null;
  mode: PlotMode;
}

/** One cut plot with the read-out of the highlighted file's marker values underneath. */
function CutPlot({ id, figure, readout, target, traces, emphasised, byGroup, referenceLabel, mode }: CutPlotProps) {
  const noLegend = traces > 0 && !showFileLegend(traces);
  return (
    <div className="plot-col">
      <PlotlyChart
        className="plot"
        figure={figure}
        testId={`plot-${id}`}
        toolbar={mode === 'polar' ? 'polar' : 'rect'}
        ariaLabel={`${id === 'h' ? 'Horizontal' : 'Vertical'} cut of the highlighted and visible patterns`}
        labelledExport={{ caption: target ? { file: target, items: readout } : undefined }}
        previewBase={emphasised}
      />
      <div className="readout" data-testid={`readout-${id}`}>
        {readout.length > 0 && (
          <p>
            <strong>{target}:</strong> {readout.join(' · ')}
          </p>
        )}
        {noLegend && (
          <p className="count">
            {traces} traces: colours as in the file panel (dashed = original){byGroup ? '; more than 10 files: one colour per group, a shade per file' : ''}; hover a trace for its name.
            {referenceLabel !== null && ` The thick dashed line in the text colour is the reference: ${referenceLabel}.`}
          </p>
        )}
      </div>
    </div>
  );
}

export const PlotArea = memo(function PlotArea({ groups, metrics, colors, styles, sim }: Props) {
  // Only the fields used here: subscribing to the whole view would re-render on every slider tick.
  const view = useStore(
    useShallow((s) => ({
      dimension: s.view.dimension,
      layout3d: s.view.layout3d,
      cut: s.view.cut,
      mode: s.view.mode,
      floorDb: s.view.floorDb,
      markers: s.view.markers,
      theme: s.view.theme,
      markersFolded: s.view.collapsed.markers,
    })),
  );
  const updateView = useStore((s) => s.updateView);
  const visible = useStore((s) => s.visible);
  const highlighted = useStore((s) => s.highlighted);
  const reference = useStore((s) => s.reference);
  const settings = useStore((s) => s.settings);

  const items = useMemo(() => groups.flatMap((g) => g.items).filter((i) => visible[i.pattern.id]), [groups, visible]);
  // The reference file is drawn whenever one is pinned, ticked or not, also when nothing else is ticked.
  const drawnItems = useMemo(() => withReference(items, groups.flatMap((g) => g.items), reference), [items, groups, reference]);
  const markerTarget =
    highlighted && visible[highlighted] ? highlighted : items.length === 1 ? items[0].pattern.id : null;
  const is3d = view.dimension === '3d';
  // Everything that decides which traces are drawn and how they look moves to the figure together, a moment after
  // a click: a checkbox is answered first, and the plots never show old traces with new colours or emphasis.
  const inputs = useMemo(() => ({ items: drawnItems, colors, styles, markerTarget, metrics, sim, reference }), [drawnItems, colors, styles, markerTarget, metrics, sim, reference]);
  const drawn = useDeferredValue(inputs);
  const updating = drawn !== inputs;
  const labels = markerLabels(settings.levelDb);

  const figures = useMemo(() => {
    if (is3d) return null;
    const common = {
      mode: view.mode,
      floorDb: view.floorDb,
      markers: view.markers,
      theme: FIGURE_THEMES[view.theme],
      levelDb: settings.levelDb,
      fbWindowDeg: settings.fbWindowDeg,
      sectorEdgeDeg: settings.sectorEdgeDeg,
      uslsRangeDeg: settings.uslsRangeDeg,
    };
    const make = (cut: 'H' | 'V') => {
      const options = {
        ...common,
        markerTarget: drawn.markerTarget,
        cut,
        series: buildCutSeries(drawn.items, drawn.sim, drawn.metrics, drawn.colors, cut, drawn.styles, drawn.reference),
      };
      const referenceLabel = options.series.find((x) => x.reference)?.label ?? null;
      return { referenceLabel, mode: view.mode, figure: buildCutFigure(options), readout: markerReadout(options), target: options.series.find((x) => x.id === drawn.markerTarget)?.label ?? '', traces: options.series.length, emphasised: options.series.some((x) => x.id === drawn.markerTarget) ? drawn.markerTarget : null };
    };
    return { h: make('H'), v: make('V') };
  }, [is3d, drawn, view.mode, view.floorDb, view.markers, view.theme, settings]);

  const byGroup = styles.size > PER_FILE_COLOURS;

  return (
    <section>
      <SimulationBar is3d={is3d} />
      <div className="controls">
        <Seg<Dimension>
          label="Dimension"
          value={view.dimension}
          options={[
            ['2d', '2D'],
            ['3d', '3D'],
          ]}
          onChange={(dimension) => updateView({ dimension })}
        />
        {is3d ? (
          <Seg<Layout3d>
            label="3D layout"
            value={view.layout3d}
            options={[
              ['grid', 'Side by side'],
              ['overlay', 'Overlay'],
            ]}
            onChange={(layout3d) => updateView({ layout3d })}
          />
        ) : (
          <>
            <Seg<CutView>
              label="Cut"
              value={view.cut}
              options={[
                ['H', 'Horizontal'],
                ['V', 'Vertical'],
                ['both', 'Both'],
              ]}
              onChange={(cut) => updateView({ cut })}
            />
            <Seg<PlotMode>
              label="Plot type"
              value={view.mode}
              options={[
                ['polar', 'Polar'],
                ['rect', 'Rectangular'],
              ]}
              onChange={(mode) => updateView({ mode })}
            />
            <button
              className="fold"
              aria-expanded={!view.markersFolded}
              aria-controls="marker-options"
              onClick={() => updateView({ collapsed: { ...useStore.getState().view.collapsed, markers: !view.markersFolded } })}
            >
              <span aria-hidden="true">{view.markersFolded ? '▸' : '▾'}</span> Markers
            </button>
            {view.markersFolded && <span className="count">{shownMarkers(view.markers, labels)}</span>}
            <div id="marker-options" className="marker-options" hidden={view.markersFolded}>
              {(Object.keys(labels) as MarkerKey[]).map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={view.markers[key]}
                    onChange={(e) => updateView({ markers: { ...view.markers, [key]: e.target.checked } })}
                  />
                  {labels[key]}
                </label>
              ))}
            </div>
          </>
        )}
      </div>
      {(is3d ? items.length === 0 : drawnItems.length === 0) ? (
        <p className="empty">Tick files in the left panel to plot them.</p>
      ) : is3d ? (
        <Pattern3D items={items} colors={colors} sim={sim} />
      ) : (
        <>
          {!markerTarget && (
            <p className="count">
              {highlighted
                ? 'The highlighted file is not ticked: tick it to see its analysis markers.'
                : 'Click a file in the panel or the table to show its analysis markers (Esc clears the highlight).'}
            </p>
          )}
          {updating && (
            <p className="count" data-testid="updating-2d">
              Updating the plots…
            </p>
          )}
          <div className="plots">
            {view.cut !== 'V' && figures && <CutPlot id="h" {...figures.h} byGroup={byGroup} />}
            {view.cut !== 'H' && figures && <CutPlot id="v" {...figures.v} byGroup={byGroup} />}
          </div>
        </>
      )}
    </section>
  );
});
