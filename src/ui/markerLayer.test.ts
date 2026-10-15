import { describe, expect, it } from 'vitest';
import type { Layout } from 'plotly.js';
import { CLEAR, dragView, MARKER_LAYER_FROM, markerLayerData, markerLayerLayout, reorderMoves, underLayerLayout, usesMarkerLayer, withView } from './markerLayer';
import { buildCutBase, buildCutOverlay, type CutFigureOptions, type PlotSeries } from './cutFigure';
import { FIGURE_THEMES } from './figureTheme';
import { analyzePattern } from '../core/analysis/metrics';
import { patternFrom, quadBeam, vBeamWithLobes } from '../test/synthetic';
import { polarViewReset, viewReset } from './chartToolbar';

const series: PlotSeries[] = ['a', 'b', 'c'].map((id, i) => {
  const p = patternFrom(quadBeam(60 + i), vBeamWithLobes, { id, frequencyMHz: 1700 + i });
  return { id, label: id, color: '#123456', cut: p.horizontal, metrics: analyzePattern({ pattern: p, tags: {} }) };
});
const options = (mode: 'polar' | 'rect', cut: 'H' | 'V' = 'H'): CutFigureOptions => ({
  series,
  cut,
  mode,
  floorDb: 40,
  markers: { hpbw: true, fb: true, usls: true, null: true, peak: true, sector: true },
  markerTarget: 'b',
  theme: FIGURE_THEMES.dark,
  levelDb: 3,
  fbWindowDeg: 30,
  sectorEdgeDeg: 60,
  uslsRangeDeg: 30,
});

type Axis = Record<string, unknown> & { tickfont?: { color?: string; size?: number }; title?: { text?: string; font?: { color?: string } } };
const polarOf = (layout: Partial<Layout>) => layout.polar as unknown as { bgcolor?: string; angularaxis: Axis; radialaxis: Axis };
const axisOf = (layout: Partial<Layout>, name: 'xaxis' | 'yaxis') => layout[name] as unknown as Axis;

/** The keys that place things on the plot (what both charts must agree on), without the colours and the grid. */
function geometry(layout: Partial<Layout>): unknown {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !/color$|^showgrid$|^zeroline$|^showline$|^annotations$|^title$|^shapes$|^showlegend$|^hovermode$|^dragmode$/.test(k))
        .map(([k, v]) => [k, strip(v)])
        // A font whose only key was its colour.
        .filter(([, v]) => !(v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)),
    );
  };
  return strip(layout);
}

describe('usesMarkerLayer', () => {
  it('keeps the markers among the traces for a few files and draws them apart from many on', () => {
    expect(usesMarkerLayer(MARKER_LAYER_FROM - 1)).toBe(false);
    expect(usesMarkerLayer(MARKER_LAYER_FROM)).toBe(true);
    expect(MARKER_LAYER_FROM).toBeGreaterThan(24);
    expect(MARKER_LAYER_FROM).toBeLessThanOrEqual(48);
  });
});

describe('underLayerLayout and markerLayerLayout', () => {
  for (const mode of ['polar', 'rect'] as const) {
    for (const cut of ['H', 'V'] as const) {
      const base = buildCutBase(options(mode, cut));
      const overlay = buildCutOverlay(options(mode, cut));
      const under = underLayerLayout(base.layout);
      const layer = markerLayerLayout(base.layout, overlay.layout, null);

      it(`${mode} ${cut}: both charts lay the plot out alike (same margins, ranges, ticks and angles)`, () => {
        expect(geometry(under)).toEqual(geometry(base.layout));
        expect(geometry(layer)).toEqual(geometry(base.layout));
      });

      it(`${mode} ${cut}: the chart under the layer draws the background and the grid but no axis line, label or title`, () => {
        expect(under.paper_bgcolor).toBe(base.layout.paper_bgcolor);
        expect(under.title).toBeUndefined();
        expect(under.annotations).toEqual(base.layout.annotations);
        if (mode === 'polar') {
          // A polar axis has a line and tick marks of its own.
          for (const axis of [polarOf(under).angularaxis, polarOf(under).radialaxis]) {
            expect(axis.showgrid).not.toBe(false);
            expect(axis.linecolor).toBe(CLEAR);
            expect(axis.tickcolor).toBe(CLEAR);
            expect(axis.tickfont?.color).toBe(CLEAR);
          }
          expect(polarOf(under).radialaxis.tickfont?.size).toBe(polarOf(base.layout).radialaxis.tickfont?.size);
        } else {
          for (const name of ['xaxis', 'yaxis'] as const) {
            const axis = axisOf(under, name);
            expect(axis.showgrid).not.toBe(false);
            // An x or y axis without a line or tick marks gets no colour for them: that would switch them on.
            expect(axis).not.toHaveProperty('linecolor');
            expect(axis).not.toHaveProperty('tickcolor');
            expect(axis.tickfont?.color).toBe(CLEAR);
            expect(axis.title?.font?.color).toBe(CLEAR);
            expect(axis.title?.text).toBe(axisOf(base.layout, name).title?.text);
          }
        }
      });

      it(`${mode} ${cut}: the layer draws the axes, the title and the marker shapes on a clear background, without grid or legend`, () => {
        expect(layer.paper_bgcolor).toBe(CLEAR);
        expect(layer.plot_bgcolor).toBe(CLEAR);
        expect(layer.showlegend).toBe(false);
        expect(layer.annotations).toEqual([]);
        expect(layer.title).toEqual(overlay.layout.title);
        expect(layer.shapes).toEqual(overlay.layout.shapes);
        if (mode === 'polar') {
          expect(polarOf(layer).bgcolor).toBe(CLEAR);
          for (const [axis, built] of [
            [polarOf(layer).angularaxis, polarOf(base.layout).angularaxis],
            [polarOf(layer).radialaxis, polarOf(base.layout).radialaxis],
          ]) {
            expect(axis.showgrid).toBe(false);
            expect(axis.linecolor).toBe(built.linecolor);
            expect(axis.tickfont?.color).toBe(built.tickfont?.color);
          }
        } else {
          for (const name of ['xaxis', 'yaxis'] as const) {
            expect(axisOf(layer, name).showgrid).toBe(false);
            expect(axisOf(layer, name).zeroline).toBe(false);
            expect(axisOf(layer, name).title).toEqual(axisOf(base.layout, name).title);
          }
        }
      });

      it(`${mode} ${cut}: the figure's own layout is left as it was`, () => {
        expect(base.layout).toEqual(buildCutBase(options(mode, cut)).layout);
      });
    }
  }

  it('the layer takes the view the chart under it shows now', () => {
    const base = buildCutBase(options('polar'));
    const view = { 'polar.radialaxis.range': [-30, 0], 'polar.radialaxis.angle': 200, 'polar.angularaxis.rotation': 45 };
    const layer = markerLayerLayout(base.layout, {}, view);
    expect(polarViewReset(layer)).toEqual(view);
    // And not the figure's.
    expect(polarOf(base.layout).radialaxis.range).toEqual([-40, 0]);
  });
});

describe('underLayerLayout of an x or y axis with a line and ticks', () => {
  it('clears the line and the ticks it has', () => {
    const under = underLayerLayout({ xaxis: { showline: true, ticks: 'outside' }, yaxis: { linecolor: '#000' } });
    expect(axisOf(under, 'xaxis')).toMatchObject({ showline: true, linecolor: CLEAR, ticks: 'outside', tickcolor: CLEAR });
    expect(axisOf(under, 'yaxis')).toMatchObject({ linecolor: CLEAR });
    expect(axisOf(under, 'yaxis')).not.toHaveProperty('tickcolor');
  });
});

describe('markerLayerData', () => {
  it('puts an empty trace of the plot\'s kind first, so the layer has axes without markers', () => {
    const polar = markerLayerData([], buildCutBase(options('polar')).layout);
    expect(polar).toHaveLength(1);
    expect(polar[0]).toMatchObject({ type: 'scatterpolar', r: [], theta: [], hoverinfo: 'skip', showlegend: false });
    const overlay = buildCutOverlay(options('rect'));
    const rect = markerLayerData(overlay.data, buildCutBase(options('rect')).layout);
    expect(rect[0]).toMatchObject({ type: 'scatter', x: [], y: [] });
    expect(rect.slice(1)).toEqual(overlay.data);
  });
});

describe('withView', () => {
  it('writes a relayout of dotted keys into a copy of the layout', () => {
    const layout = { xaxis: { range: [-180, 180], dtick: 30 }, yaxis: { range: [-40, 0] }, polar: { radialaxis: { range: [-40, 0], angle: 270 } } };
    const out = withView(layout, { 'xaxis.range': [-90, 90], 'yaxis.autorange': true, 'polar.radialaxis.angle': 10, 'polar.angularaxis.rotation': 90 });
    expect(out).toEqual({
      xaxis: { range: [-90, 90], dtick: 30 },
      yaxis: { autorange: true },
      polar: { radialaxis: { range: [-40, 0], angle: 10 }, angularaxis: { rotation: 90 } },
    });
    expect(layout.xaxis.range).toEqual([-180, 180]);
    expect(layout.polar.radialaxis.angle).toBe(270);
  });

  it('leaves out what the view does not say, and is the layout itself without a view', () => {
    const layout = { polar: { radialaxis: { range: [-40, 0], angle: 270 } } };
    expect(withView(layout, { 'polar.radialaxis.angle': undefined })).toEqual(layout);
    expect(withView(layout, null)).toBe(layout);
  });

  it('round-trips the view of a chart kind', () => {
    const layout = buildCutBase(options('rect')).layout;
    const view = viewReset('rect', { xaxis: { range: [-60, 60] }, yaxis: { range: [-20, 0] } });
    expect(viewReset('rect', withView(layout, view))).toEqual(view);
  });
});

describe('dragView', () => {
  const polar = { 'polar.radialaxis.range': [-40, 0], 'polar.radialaxis.angle': 270, 'polar.angularaxis.rotation': 90 };

  it('takes what a polar drag already shows: a turn, the level axis turned, an end of the level axis moved', () => {
    expect(dragView(polar, { 'polar.angularaxis.rotation': 120 })).toEqual({ ...polar, 'polar.angularaxis.rotation': 120 });
    expect(dragView(polar, { 'polar.radialaxis.angle': 200 })).toEqual({ ...polar, 'polar.radialaxis.angle': 200 });
    expect(dragView(polar, { 'polar.radialaxis.range[1]': 5 })).toEqual({ ...polar, 'polar.radialaxis.range': [-40, 5] });
    expect(polar['polar.radialaxis.range']).toEqual([-40, 0]);
  });

  it('leaves out a polar zoom box, which is drawn only when the drag ends', () => {
    expect(dragView(polar, { 'polar.radialaxis.range': [-30, -10] })).toEqual(polar);
  });

  it('keeps the view of an x and y chart as it is (a pan is in it, a zoom box is not drawn yet)', () => {
    const rect = { 'xaxis.range': [-90, 90], 'yaxis.range': [-40, 0] };
    expect(dragView(rect, { 'xaxis.range[0]': -30, 'xaxis.range[1]': 30 })).toBe(rect);
    expect(dragView(null, { 'xaxis.range[0]': -30 })).toBeNull();
  });
});

describe('reorderMoves', () => {
  const apply = (current: string[], moves: { id: string; before: string | null }[]) => {
    const out = [...current];
    for (const { id, before } of moves) {
      out.splice(out.indexOf(id), 1);
      out.splice(before === null ? out.length : out.indexOf(before), 0, id);
    }
    return out;
  };

  it('moves nothing when the order is right', () => {
    expect(reorderMoves(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([]);
  });

  it('brings one trace up under the last one in one move, and back in one move', () => {
    const up = reorderMoves(['a', 'b', 'c', 'ref'], ['a', 'c', 'b', 'ref']);
    expect(up).toHaveLength(1);
    expect(apply(['a', 'b', 'c', 'ref'], up)).toEqual(['a', 'c', 'b', 'ref']);
    const back = reorderMoves(['a', 'c', 'b', 'ref'], ['a', 'b', 'c', 'ref']);
    expect(back).toHaveLength(1);
    expect(apply(['a', 'c', 'b', 'ref'], back)).toEqual(['a', 'b', 'c', 'ref']);
  });

  it('moves a highlight from one trace to another in two moves', () => {
    const from = ['a', 'c', 'd', 'b'];
    const to = ['a', 'b', 'd', 'c'];
    const moves = reorderMoves(from, to);
    expect(moves.length).toBeLessThanOrEqual(2);
    expect(apply(from, moves)).toEqual(to);
  });

  it('reaches any order', () => {
    const from = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (const to of [['f', 'e', 'd', 'c', 'b', 'a'], ['b', 'a', 'd', 'c', 'f', 'e'], ['c', 'a', 'b', 'f', 'd', 'e']]) {
      expect(apply(from, reorderMoves(from, to))).toEqual(to);
    }
  });

  it('ignores what is drawn but not asked for, and what is asked for but not drawn', () => {
    const moves = reorderMoves(['a', 'x', 'b'], ['b', 'a', 'gone']);
    expect(apply(['a', 'x', 'b'], moves).filter((id) => id !== 'x')).toEqual(['b', 'a']);
  });
});
