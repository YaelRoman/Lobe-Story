import { describe, expect, it } from 'vitest';
import type { PlotData, Shape } from 'plotly.js';
import { buildCutBase, buildCutFigure, buildCutOverlay, regionCaptionOf, type CutFigureOptions, type PlotSeries } from './cutFigure';
import { exportCaptionLines, exportFigure } from './exportFigure';
import { FIGURE_THEMES } from './figureTheme';
import { analyzePattern } from '../core/analysis/metrics';
import { typeARegions } from '../core/analysis/are';
import { patternFrom, quadBeam } from '../test/synthetic';
import { horizontalCutSpans, REGION_OPACITY, REGION_STYLE, regionCaptionText, verticalCutSpans } from './regionShading';

const NO_MARKERS = { hpbw: false, fb: false, usls: false, null: false, peak: false, sector: false };
const ALL = { hpbw: true, fb: true, usls: true, null: true, peak: true, sector: true };

/** A file with a 65° azimuth beam and an 8° elevation beam 6° below the horizon (a Type A beam), analysed with its estimate. */
function file(id: string, vPeak = 6): [PlotSeries, PlotSeries] {
  const pattern = patternFrom(quadBeam(65, 0, 25), quadBeam(8, vPeak, 20), { id });
  const metrics = analyzePattern({ pattern, tags: {} }, undefined, undefined, { areMethod: 'summation' });
  return [
    { id, label: `${id} file`, color: '#123456', cut: pattern.horizontal, metrics },
    { id, label: `${id} file`, color: '#123456', cut: pattern.vertical, metrics },
  ];
}

const opts = (over: Partial<CutFigureOptions>): CutFigureOptions => ({
  series: [file('a')[0]],
  cut: 'H',
  mode: 'polar',
  floorDb: 40,
  markers: NO_MARKERS,
  markerTarget: 'a',
  theme: FIGURE_THEMES.light,
  levelDb: 3,
  fbWindowDeg: 30,
  sectorEdgeDeg: 60,
  uslsRangeDeg: 20,
  regions: true,
  ...over,
});

const shaded = (data: unknown[]) => (data as Partial<PlotData>[]).filter((t) => typeof t.name === 'string' && t.name.endsWith(' region'));
const shadedShapes = (shapes: unknown) => ((shapes ?? []) as Partial<Shape>[]).filter((s) => s.name?.endsWith(' region'));

describe('region shading in the cut figure', () => {
  const [h, v] = file('a');
  const regions = v.metrics.are.regions!;

  it('the test file has an estimate and its regions', () => {
    expect(v.metrics.are.sector.value).not.toBeNull();
    expect(regions.serviceStartDeg).toBeCloseTo(2, 1);
  });

  it('polar: a filled wedge per region span, first in the overlay (under the markers), out of hover, clicks and legend', () => {
    for (const [cut, s, spans] of [['V', v, verticalCutSpans(regions)], ['H', h, horizontalCutSpans(regions, false, 0)]] as const) {
      const overlay = buildCutOverlay(opts({ cut, series: [s], markers: ALL }));
      const wedges = shaded(overlay.data);
      expect(wedges).toHaveLength(spans.length);
      expect(overlay.data.slice(0, wedges.length)).toEqual(wedges);
      expect(overlay.data.length).toBeGreaterThan(wedges.length);
      wedges.forEach((w, k) => {
        expect(w.type).toBe('scatterpolar');
        expect(w.fill).toBe('toself');
        expect(w.hoverinfo).toBe('skip');
        expect(w.showlegend).toBe(false);
        expect(w.opacity).toBe(REGION_OPACITY);
        expect(w.fillcolor).toBe(REGION_STYLE[spans[k].region].colour);
        const theta = w.theta as number[];
        expect(theta[0]).toBe(spans[k].from);
        expect(theta[theta.length - 1]).toBe(spans[k].to);
        // From the centre (the floor) out to 0 dB.
        expect((w.r as number[])[0]).toBe(-40);
        expect(Math.max(...(w.r as number[]))).toBe(0);
      });
    }
  });

  it('rectangular: full-height bands between the grid and the traces, before the marker shapes', () => {
    const overlay = buildCutOverlay(opts({ cut: 'V', mode: 'rect', series: [v], markers: ALL }));
    const shapes = overlay.layout.shapes as Partial<Shape>[];
    const bands = shadedShapes(shapes);
    // The upper region and the interference behind the antenna run across ±180°: two pieces each.
    expect(bands.length).toBeGreaterThanOrEqual(verticalCutSpans(regions).length);
    expect(shapes.slice(0, bands.length)).toEqual(bands);
    expect(shapes.length).toBeGreaterThan(bands.length);
    for (const b of bands) {
      expect(b).toMatchObject({ type: 'rect', xref: 'x', yref: 'paper', y0: 0, y1: 1, layer: 'between', opacity: REGION_OPACITY });
      expect(b.x0!).toBeGreaterThanOrEqual(-180);
      expect(b.x1!).toBeLessThanOrEqual(180);
    }
    // Together they cover the axis once.
    expect(bands.reduce((sum, b) => sum + (Number(b.x1) - Number(b.x0)), 0)).toBeCloseTo(360, 9);
    expect(shaded(overlay.data)).toHaveLength(0);
  });

  it('only while asked for and only for the marker target; the files\' base figure never has it', () => {
    for (const mode of ['polar', 'rect'] as const) {
      const on = opts({ mode, cut: 'V', series: [v], markers: ALL });
      const off = buildCutOverlay({ ...on, regions: false });
      expect(shaded(off.data)).toHaveLength(0);
      expect(shadedShapes(off.layout.shapes)).toHaveLength(0);
      expect(buildCutOverlay({ ...on, regions: undefined })).toEqual(off);
      const none = buildCutOverlay({ ...on, markerTarget: null });
      expect(shaded(none.data)).toHaveLength(0);
      expect(shadedShapes(none.layout.shapes)).toHaveLength(0);
      expect(buildCutBase(on)).toEqual(buildCutBase({ ...on, regions: false }));
      // The markers are as they were.
      expect(buildCutOverlay(on).data.slice(shaded(buildCutOverlay(on).data).length)).toEqual(off.data);
    }
  });

  it('follows the regions the table values were integrated over (a tilted beam\'s), the azimuth and the horizon cut', () => {
    const tilted: PlotSeries = { ...v, metrics: { ...v.metrics, are: { ...v.metrics.are, regions: typeARegions(10, 8, 60) } } };
    const service = shaded(buildCutOverlay(opts({ cut: 'V', series: [tilted] })).data).find((t) => t.fillcolor === REGION_STYLE.service.colour)!;
    expect((service.theta as number[])[0]).toBe(6);
    // Turned with the azimuth of the horizontal cut.
    const turned = shaded(buildCutOverlay(opts({ series: [{ ...h, rotationDeg: 30 }] })).data).find((t) => t.fillcolor === REGION_STYLE.service.colour)!;
    expect((turned.theta as number[])[0]).toBe(-30);
    expect(regionCaptionText(regionCaptionOf(opts({ series: [{ ...h, rotationDeg: 30 }] }))!)).toContain('of the pointing direction (30°), drawn −30° to 90°');
    // A horizon cut of a beam whose service region starts below the horizon is interference all round.
    const [hSteep] = file('s', 14);
    const horizon = shaded(buildCutOverlay(opts({ series: [{ ...hSteep, horizonCut: true }], markerTarget: 's' })).data);
    expect(horizon.map((t) => t.fillcolor)).toEqual([REGION_STYLE.interference.colour]);
  });

  it('is in the exported image as on screen (same colours whatever the screen theme), never in its legend', () => {
    for (const theme of ['light', 'dark'] as const) {
      const figure = buildCutFigure(opts({ cut: 'V', series: [v], theme: FIGURE_THEMES[theme], markers: ALL }));
      const out = exportFigure(figure, { file: 'a', items: [] }, theme);
      const wedges = shaded(out.data);
      expect(wedges).toEqual(shaded(figure.data));
      expect(wedges.every((w) => w.showlegend === false)).toBe(true);
    }
  });

  it('a caption names the file and the bounds, or says why nothing is shaded', () => {
    expect(regionCaptionOf(opts({ regions: false }))).toBeUndefined();
    expect(regionCaptionOf(opts({ markerTarget: null }))).toBeUndefined();
    const c = regionCaptionOf(opts({ cut: 'V', series: [v] }))!;
    expect(c.lead).toContain('a file');
    expect(c.items.map((i) => i.region)).toEqual(['upper', 'interference', 'service', 'lower']);
    const noEstimate: PlotSeries = { ...v, metrics: { ...v.metrics, are: { sector: { value: null, reason: 'Not a Type A (macro) beam' }, spatial: { value: null }, lower: { value: null } } } };
    const why = regionCaptionOf(opts({ cut: 'V', series: [noEstimate] }))!;
    expect(why.items).toEqual([]);
    expect(why.lead).toContain('Not a Type A (macro) beam');
    expect(shaded(buildCutOverlay(opts({ cut: 'V', series: [noEstimate] })).data)).toHaveLength(0);
  });
});

describe('the region caption in the exported image', () => {
  it('is a line of its own after the markers line, before the simulation line', () => {
    const lines = exportCaptionLines({ file: 'a', items: ['HPBW 65.0°'], markers: 'Markers of the highlighted file: …', regions: 'Tinted: angular regions (est.) of a: service (green) within ±60°.', simulated: 'Simulated: Δe +2°' });
    expect(lines).toEqual(['a', 'HPBW 65.0°', 'Markers of the highlighted file: …', 'Tinted: angular regions (est.) of a: service (green) within ±60°.', 'Simulated: Δe +2°']);
  });
});
