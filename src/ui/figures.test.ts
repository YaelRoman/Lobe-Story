import { describe, expect, it } from 'vitest';
import type { PlotData, Shape } from 'plotly.js';
import { buildCutFigure, type CutFigureOptions, type PlotSeries } from './cutFigure';
import { buildHpbwFigure } from './hpbwFigure';
import { colorMap, PALETTE } from './colors';
import { FIGURE_THEMES } from './figureTheme';
import { analyzePattern } from '../core/analysis/metrics';
import { patternFrom, quadBeam, vBeamWithLobes } from '../test/synthetic';

const NO_MARKERS = { hpbw: false, fb: false, usls: false, null: false, peak: false };

function series(id: string, vOffset = 0): PlotSeries[] {
  const pattern = patternFrom(quadBeam(60), (a) => vBeamWithLobes(a) + vOffset, { id });
  const metrics = analyzePattern({ pattern, tags: {} });
  return [
    { id, label: `${id} H`, color: '#123456', cut: pattern.horizontal, metrics },
    { id, label: `${id} V`, color: '#123456', cut: pattern.vertical, metrics },
  ];
}

const opts = (over: Partial<CutFigureOptions>): CutFigureOptions => ({
  series: [series('a')[0]],
  cut: 'H',
  mode: 'polar',
  floorDb: 40,
  markers: NO_MARKERS,
  markerTarget: null,
  theme: FIGURE_THEMES.light,
  levelDb: 3,
  fbWindowDeg: 30,
  ...over,
});

const traces = (f: { data: unknown[] }) => f.data as Partial<PlotData>[];

describe('buildCutFigure', () => {
  it('draws one closed polar trace per series, clamped to the floor', () => {
    const f = buildCutFigure(opts({ floorDb: 20 }));
    const [t] = traces(f);
    expect(f.data).toHaveLength(1);
    expect(t.type).toBe('scatterpolar');
    expect(t.r).toHaveLength(361);
    expect(Math.min(...(t.r as number[]))).toBe(-20);
    expect(f.layout.polar?.angularaxis?.rotation).toBe(90);
    expect(f.layout.polar?.radialaxis?.range).toEqual([-20, 0]);
  });

  it('paints an opaque paper background matching the theme (dark-mode PNG export)', () => {
    const f = buildCutFigure(opts({ theme: FIGURE_THEMES.dark }));
    expect(f.layout.paper_bgcolor).toBe(FIGURE_THEMES.dark.bg);
  });

  it('puts the V-cut horizon on the right', () => {
    const f = buildCutFigure(opts({ cut: 'V', series: [series('a')[1]] }));
    expect(f.layout.polar?.angularaxis?.rotation).toBe(0);
    expect(f.layout.polar?.angularaxis?.direction).toBe('clockwise');
  });

  it('draws rectangular traces sorted from −179° to 180°', () => {
    const [t] = traces(buildCutFigure(opts({ mode: 'rect' })));
    expect(t.type).toBe('scatter');
    expect((t.x as number[])[0]).toBe(-179);
    expect((t.x as number[])[359]).toBe(180);
    expect((t.y as number[])[179]).toBeCloseTo(0);
  });

  it('unifies hover across traces in rectangular mode but not polar', () => {
    expect(buildCutFigure(opts({ mode: 'rect' })).layout.hovermode).toBe('x unified');
    expect(buildCutFigure(opts({ mode: 'polar' })).layout.hovermode).toBeUndefined();
  });

  it('draws markers only for the target series', () => {
    const markers = { ...NO_MARKERS, hpbw: true };
    expect(buildCutFigure(opts({ markers })).data).toHaveLength(1);
    const f = buildCutFigure(opts({ markers, markerTarget: 'a' }));
    const names = traces(f).map((t) => t.name);
    expect(names).toContain('HPBW 60.0°');
    const ring = traces(f).find((t) => t.name === '−3 dB')!;
    expect(new Set(ring.r as number[])).toEqual(new Set([-3]));
    expect(f.layout.title).toMatchObject({ text: 'Horizontal cut — HPBW 60.0°' });
  });

  it('draws the −3 dB ring relative to an offset cut’s own peak', () => {
    const f = buildCutFigure(
      opts({ cut: 'V', series: [series('b', 2)[1]], markers: { ...NO_MARKERS, hpbw: true }, markerTarget: 'b' }),
    );
    const ring = traces(f).find((t) => t.name === '−3 dB')!;
    expect(new Set(ring.r as number[])).toEqual(new Set([-5]));
  });

  it('marks USLS and the first null on the V cut', () => {
    const f = buildCutFigure(
      opts({ cut: 'V', series: [series('a')[1]], markers: { ...NO_MARKERS, usls: true, null: true }, markerTarget: 'a' }),
    );
    const names = traces(f).map((t) => t.name);
    expect(names).toContain('USLS 18.0 dB');
    expect(names).toContain('First null 22.0 dB');
  });

  it('splits the F/B window into two rectangles in rectangular mode', () => {
    const f = buildCutFigure(opts({ mode: 'rect', markers: { ...NO_MARKERS, fb: true }, markerTarget: 'a' }));
    const rects = (f.layout.shapes as Partial<Shape>[]).filter((s) => s.type === 'rect');
    expect(rects.map((s) => [s.x0, s.x1])).toEqual([
      [150, 180],
      [-180, -150],
    ]);
  });
});

describe('buildHpbwFigure', () => {
  it('draws H and V lines per group plus declared markers', () => {
    const f = buildHpbwFigure(
      [
        { label: 'g1', color: '#111', points: [{ freq: 1700, h: 65, v: 8, declH: 66, declV: 8.2 }, { freq: 1800, h: null, v: 7.5 }] },
        { label: 'g2', color: '#222', points: [{ freq: 1700, h: 64, v: 8.1 }] },
      ],
      FIGURE_THEMES.dark,
    );
    const t = traces(f);
    expect(t.map((x) => x.name)).toEqual(['g1', 'g1', 'g1 declared', 'g1 declared', 'g2', 'g2']);
    expect(t[0].y).toEqual([65, null]);
    expect(t[1].yaxis).toBe('y2');
    expect(t[2].marker).toMatchObject({ symbol: 'circle-open' });
  });
});

describe('simulation display options', () => {
  it('rotates the H cut by the azimuth', () => {
    const [t] = traces(buildCutFigure(opts({ mode: 'rect', rotationDeg: 30 })));
    const y = t.y as number[];
    const peak = y.indexOf(Math.max(...y));
    expect((t.x as number[])[peak]).toBe(30);
  });

  it('rotates markers but keeps antenna-frame labels', () => {
    const f = buildCutFigure(opts({ markers: { ...NO_MARKERS, peak: true }, markerTarget: 'a', rotationDeg: 30 }));
    const ray = traces(f).find((t) => t.name === 'Squint 0.0°')!;
    expect(ray.theta).toEqual([30, 30]);
  });

  it('keeps F/B rectangles inside −180…180 after rotation', () => {
    const f = buildCutFigure(
      opts({ mode: 'rect', markers: { ...NO_MARKERS, fb: true }, markerTarget: 'a', rotationDeg: 90 }),
    );
    const rects = (f.layout.shapes as Partial<Shape>[]).filter((s) => s.type === 'rect');
    expect(rects.map((s) => [s.x0, s.x1])).toEqual([[-120, -60]]);
  });

  it('draws dashed series', () => {
    const [s] = series('a');
    const [t] = traces(buildCutFigure(opts({ series: [{ ...s, dash: true }] })));
    expect(t.line).toMatchObject({ dash: 'dash' });
  });

  it('draws ghost HPBW series faint and without legend or declared markers', () => {
    const f = buildHpbwFigure(
      [{ label: 'g1', color: '#111', ghost: true, points: [{ freq: 1700, h: 65, v: 8, declH: 66 }] }],
      FIGURE_THEMES.light,
    );
    const t = traces(f);
    expect(t).toHaveLength(2);
    expect(t.map((x) => x.opacity)).toEqual([0.35, 0.35]);
    expect(t.map((x) => x.showlegend)).toEqual([false, false]);
    expect(t[0].name).toBe('g1 (original)');
  });

  it('rotates each series by its own rotation and markers by the target', () => {
    const [sa] = series('a');
    const [sb] = series('b');
    const f = buildCutFigure(
      opts({
        mode: 'rect',
        series: [{ ...sa, rotationDeg: 0 }, { ...sb, rotationDeg: 90 }],
        markers: { ...NO_MARKERS, peak: true },
        markerTarget: 'b',
      }),
    );
    const [ta, tb] = traces(f);
    const peakX = (t: (typeof ta)) => (t.x as number[])[(t.y as number[]).indexOf(Math.max(...(t.y as number[])))];
    expect(peakX(ta)).toBe(0);
    expect(peakX(tb)).toBe(90);
    const rays = (f.layout.shapes as Partial<Shape>[]).filter((s) => s.type === 'line' && s.yref === 'paper');
    expect(rays.map((s) => s.x0)).toEqual([90]);
  });
});

describe('colorMap', () => {
  it('assigns palette colours in order and wraps', () => {
    const ids = Array.from({ length: PALETTE.length + 1 }, (_, i) => `f${i}`);
    const m = colorMap(ids);
    expect(m.get('f0')).toBe(PALETTE[0]);
    expect(m.get(`f${PALETTE.length}`)).toBe(PALETTE[0]);
  });

  it('gives every id a distinct colour when there are no more ids than the palette', () => {
    const ids = Array.from({ length: PALETTE.length }, (_, i) => `f${i}`);
    const m = colorMap(ids);
    expect(new Set(m.values()).size).toBe(PALETTE.length);
  });
});
