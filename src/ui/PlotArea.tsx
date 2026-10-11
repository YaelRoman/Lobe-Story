import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, type CutView, type Dimension, type Layout3d, type MarkerKey, type PlotMode } from '../state/store';
import type { GroupView } from '../state/selectors';
import type { PatternMetrics } from '../core/analysis/metrics';
import { buildCutFigure, markerReadout } from './cutFigure';
import { buildCutSeries } from './cutSeries';
import { FIGURE_THEMES, type Figure } from './figureTheme';
import { showFileLegend } from './legend';
import { PlotlyChart } from './PlotlyChart';
import { Pattern3D } from './Pattern3D';
import { SimulationBar } from './SimulationBar';
import { Seg } from './Seg';
import type { SimulationResult } from './useSimulation';

interface Props {
  groups: GroupView[];
  metrics: Map<string, PatternMetrics>;
  colors: Map<string, string>;
  sim: SimulationResult;
}

const MARKER_LABELS: Record<MarkerKey, string> = {
  hpbw: '−3 dB / HPBW',
  fb: 'F/B window',
  usls: 'Sidelobes',
  null: 'Null fill',
  peak: 'Beam direction',
  sector: 'Sector',
};

/** The names of the markers that are on, for the folded "Markers" control. */
const shownMarkers = (markers: Record<MarkerKey, boolean>): string => {
  const on = (Object.keys(MARKER_LABELS) as MarkerKey[]).filter((k) => markers[k]).map((k) => MARKER_LABELS[k]);
  return on.length > 0 ? on.join(' · ') : 'none';
};

interface CutPlotProps {
  id: 'h' | 'v';
  figure: Figure;
  readout: string[];
  target: string;
  traces: number;
}

/** One cut plot with the read-out of the highlighted file's marker values underneath. */
function CutPlot({ id, figure, readout, target, traces }: CutPlotProps) {
  const noLegend = traces > 0 && !showFileLegend(traces);
  return (
    <div className="plot-col">
      <PlotlyChart
        className="plot"
        figure={figure}
        testId={`plot-${id}`}
        ariaLabel={`${id === 'h' ? 'Horizontal' : 'Vertical'} cut of the highlighted and visible patterns`}
        labelledExport={{ caption: target ? { file: target, items: readout } : undefined }}
      />
      <div className="readout" data-testid={`readout-${id}`}>
        {readout.length > 0 && (
          <p>
            <strong>{target}:</strong> {readout.join(' · ')}
          </p>
        )}
        {noLegend && (
          <p className="count">
            {traces} traces: colours as in the file panel (dashed = original); hover a trace for its name.
          </p>
        )}
      </div>
    </div>
  );
}

export const PlotArea = memo(function PlotArea({ groups, metrics, colors, sim }: Props) {
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
  const settings = useStore((s) => s.settings);

  const items = useMemo(() => groups.flatMap((g) => g.items).filter((i) => visible[i.pattern.id]), [groups, visible]);
  const markerTarget =
    highlighted && visible[highlighted] ? highlighted : items.length === 1 ? items[0].pattern.id : null;
  const is3d = view.dimension === '3d';

  const figures = useMemo(() => {
    if (is3d) return null;
    const common = {
      mode: view.mode,
      floorDb: view.floorDb,
      markers: view.markers,
      markerTarget,
      theme: FIGURE_THEMES[view.theme],
      levelDb: settings.levelDb,
      fbWindowDeg: settings.fbWindowDeg,
      sectorEdgeDeg: settings.sectorEdgeDeg,
      uslsRangeDeg: settings.uslsRangeDeg,
    };
    const make = (cut: 'H' | 'V') => {
      const options = { ...common, cut, series: buildCutSeries(items, sim, metrics, colors, cut) };
      return { figure: buildCutFigure(options), readout: markerReadout(options), target: options.series.find((x) => x.id === markerTarget)?.label ?? '', traces: options.series.length };
    };
    return { h: make('H'), v: make('V') };
  }, [is3d, items, metrics, colors, view.mode, view.floorDb, view.markers, view.theme, markerTarget, settings, sim]);

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
          <>
            <Seg<Layout3d>
              label="3D layout"
              value={view.layout3d}
              options={[
                ['grid', 'Side by side'],
                ['overlay', 'Overlay'],
              ]}
              onChange={(layout3d) => updateView({ layout3d })}
            />
          </>
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
            {view.markersFolded && <span className="count">{shownMarkers(view.markers)}</span>}
            {!view.markersFolded && (
              <div id="marker-options" className="marker-options">
              {(Object.keys(MARKER_LABELS) as MarkerKey[]).map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={view.markers[key]}
                    onChange={(e) => updateView({ markers: { ...view.markers, [key]: e.target.checked } })}
                  />
                  {MARKER_LABELS[key]}
                </label>
              ))}
              </div>
            )}
          </>
        )}
      </div>
      {items.length === 0 ? (
        <p className="empty">Tick files in the left panel to plot them.</p>
      ) : is3d ? (
        <Pattern3D items={items} colors={colors} sim={sim} />
      ) : (
        <>
          {!markerTarget && <p className="count">Click a file to show its analysis markers.</p>}
          <div className="plots">
            {view.cut !== 'V' && figures && <CutPlot id="h" {...figures.h} />}
            {view.cut !== 'H' && figures && <CutPlot id="v" {...figures.v} />}
          </div>
        </>
      )}
    </section>
  );
});
