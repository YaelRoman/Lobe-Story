import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, type CutView, type Dimension, type Layout3d, type MarkerKey, type PlotMode } from '../state/store';
import type { GroupView } from '../state/selectors';
import type { PatternMetrics } from '../core/analysis/metrics';
import { buildCutFigure } from './cutFigure';
import { buildCutSeries } from './cutSeries';
import { FIGURE_THEMES } from './figureTheme';
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
  usls: 'USLS',
  null: 'First null',
  peak: 'Beam direction',
};

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
    };
    return {
      h: buildCutFigure({
        ...common,
        cut: 'H',
        series: buildCutSeries(items, sim, metrics, colors, 'H'),
      }),
      v: buildCutFigure({ ...common, cut: 'V', series: buildCutSeries(items, sim, metrics, colors, 'V') }),
    };
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
            {view.cut !== 'V' && figures && <PlotlyChart className="plot" figure={figures.h} testId="plot-h" />}
            {view.cut !== 'H' && figures && <PlotlyChart className="plot" figure={figures.v} testId="plot-v" />}
          </div>
        </>
      )}
    </section>
  );
});
