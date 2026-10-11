import { describe, expect, it } from 'vitest';
import type { Legend, PlotData, Shape } from 'plotly.js';
import { buildCutFigure, type CutFigureOptions, type PlotSeries } from './cutFigure';
import { buildHpbwFigure } from './hpbwFigure';
import { colorMap, PALETTE } from './colors';
import { FIGURE_THEMES } from './figureTheme';
import { analyzePattern } from '../core/analysis/metrics';
import { tiltPattern } from '../core/analysis/tilt';
import { hBeamWithLobes, patternFrom, quadBeam, vBeamWithLobes, vFarLobes } from '../test/synthetic';

const NO_MARKERS = { hpbw: false, fb: false, usls: false, null: false, peak: false, sector: false };

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
  sectorEdgeDeg: 60,
  uslsRangeDeg: 20,
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

  it('keeps a simulated H trace and its −3 dB marker within the axis range (never above 0 dB)', () => {
    // V peak 6° below the horizon; −6° of electrical tilt used to draw the H trace 7.5 dB above the peak.
    const pattern = patternFrom(quadBeam(65), vBeamWithLobes, { id: 't' });
    for (const method of ['summation', 'weighted'] as const) {
      const tilted = tiltPattern(pattern, { electricalDeg: -6, mechanicalDeg: 2.5 }, method);
      const metrics = analyzePattern({ pattern: tilted, tags: {} });
      const s: PlotSeries[] = [{ id: 't', label: 't', color: '#123456', cut: tilted.horizontal, metrics }];
      const over = { series: s, markerTarget: 't', markers: { ...NO_MARKERS, hpbw: true } };
      const polar = buildCutFigure(opts({ ...over, mode: 'polar' }));
      expect(polar.layout.polar?.radialaxis?.range).toEqual([-40, 0]);
      expect(Math.max(...(traces(polar)[0].r as number[]))).toBeCloseTo(0, 9);
      const ring = traces(polar).find((t) => t.name === '−3 dB')!;
      expect((ring.r as number[])[0]).toBeCloseTo(-3, 9);
      const rect = buildCutFigure(opts({ ...over, mode: 'rect' }));
      expect(rect.layout.yaxis?.range).toEqual([-40, 0]);
      expect(Math.max(...(traces(rect)[0].y as number[]))).toBeCloseTo(0, 9);
      const line = (rect.layout.shapes as Partial<Shape>[]).find((sh) => sh.type === 'line' && sh.yref === 'y')!;
      expect(line.y0).toBeCloseTo(-3, 9);
    }
  });

  it('widens the level range to the next 5 dB when a trace is above 0 dB (defence, e.g. a negative offset)', () => {
    const pattern = patternFrom((a) => quadBeam(60)(a) - 7.5, vBeamWithLobes, { id: 'n' });
    const metrics = analyzePattern({ pattern, tags: {} });
    const s: PlotSeries[] = [{ id: 'n', label: 'n', color: '#123456', cut: pattern.horizontal, metrics }];
    expect(buildCutFigure(opts({ series: s, mode: 'polar' })).layout.polar?.radialaxis?.range).toEqual([-40, 10]);
    expect(buildCutFigure(opts({ series: s, mode: 'rect' })).layout.yaxis?.range).toEqual([-40, 10]);
    const five = [{ ...s[0], cut: { ...pattern.horizontal, atten: pattern.horizontal.atten.map((v) => v + 2.5) } }];
    expect(buildCutFigure(opts({ series: five, mode: 'rect' })).layout.yaxis?.range).toEqual([-40, 5]);
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

  describe('sidelobe markers', () => {
    const on = { ...NO_MARKERS, usls: true, null: true };
    const names = (cut: 'H' | 'V', h: (a: number) => number, v: (a: number) => number, over: Partial<CutFigureOptions> = {}) => {
      const pattern = patternFrom(h, v, { id: 'a' });
      const metrics = analyzePattern({ pattern, tags: {} });
      const cutData = cut === 'H' ? pattern.horizontal : pattern.vertical;
      const f = buildCutFigure(
        opts({ cut, series: [{ id: 'a', label: 'a', color: '#123456', cut: cutData, metrics }], markers: on, markerTarget: 'a', ...over }),
      );
      return traces(f).slice(1);
    };
    const nm = (t: Partial<PlotData>[]) => t.map((x) => x.name);

    it('marks the elevation sidelobes, merging coinciding ones', () => {
      const n = nm(names('V', quadBeam(60), vBeamWithLobes));
      expect(n).toContain('First USLS · USLS peak to 20° · USLS horizon to 20° 18.0 dB');
      expect(n).toContain('Null fill 22.0 dB');
      expect(n).toContain('First LSLS 15.0 dB');
      expect(n.filter((x) => x?.startsWith('USLS'))).toEqual([]);
    });

    it('marks merged lobes', () => {
      const n = nm(names('V', quadBeam(60), quadBeam(8, 6)));
      expect(n).toContain('First USLS (merged) · USLS peak to 20° · USLS horizon to 20° 28.9 dB');
      expect(n).toContain('Null fill (merged) · First LSLS (merged) 28.9 dB');
    });

    it('keeps differing values as separate markers', () => {
      const n = nm(names('V', quadBeam(60), vFarLobes));
      expect(n).toContain('First USLS (merged) 23.2 dB');
      expect(n).toContain('USLS peak to 20° · USLS horizon to 20° 18.0 dB');
    });

    it('draws nothing for a null result', () => {
      const t = names('V', quadBeam(60), quadBeam(16, 0), { markers: { ...NO_MARKERS, usls: true } });
      expect(nm(t)).toEqual(['First USLS (merged) 28.8 dB']);
    });

    it('marks H-SLS on the H cut and applies the rotation', () => {
      const t = names('H', hBeamWithLobes, quadBeam(8), { markers: { ...NO_MARKERS, usls: true } });
      expect(nm(t)).toEqual(['H-SLS 12.0 dB']);
      expect((t[0] as { theta: number[] }).theta).toEqual([35]);
      const r = names('H', hBeamWithLobes, quadBeam(8), { markers: { ...NO_MARKERS, usls: true }, rotationDeg: 30 });
      expect((r[0] as { theta: number[] }).theta).toEqual([65]);
      expect(nm(names('H', quadBeam(60), quadBeam(8), { markers: { ...NO_MARKERS, usls: true } }))).toEqual([]);
    });

    it('draws the same names in rectangular mode', () => {
      const t = names('V', quadBeam(60), vBeamWithLobes, { mode: 'rect' });
      expect(t.every((x) => x.type === 'scatter')).toBe(true);
      expect(nm(t)).toContain('Null fill 22.0 dB');
    });
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

describe('sector marker', () => {
  const sector = { ...NO_MARKERS, sector: true };
  const arcNames = (f: { data: unknown[] }) => traces(f).map((t) => t.name).filter((n) => n?.startsWith('D/U'));

  it('draws edge lines and D/U bands in polar mode on the H cut', () => {
    const f = buildCutFigure(opts({ markers: sector, markerTarget: 'a' }));
    const names = traces(f).map((t) => t.name);
    expect(names).toContain('Sector edge +60°');
    expect(names).toContain('Sector edge −60°');
    expect(arcNames(f)).toHaveLength(3);
    expect(arcNames(f).map((n) => n!.split(' ')[1])).toEqual(['16QAM', '64QAM', '256QAM']);
    const edge = traces(f).find((t) => t.name === 'Sector edge −60°')!;
    expect(edge.theta).toEqual([-60, -60]);
  });

  it('draws the bands as lines near the top in rectangular mode, edges as shapes', () => {
    const f = buildCutFigure(opts({ mode: 'rect', markers: sector, markerTarget: 'a' }));
    const bar = traces(f).find((t) => t.name?.startsWith('D/U 16QAM'))!;
    expect(bar.type).toBe('scatter');
    expect(new Set(bar.y as number[])).toEqual(new Set([-40 * 0.03]));
    const lines = (f.layout.shapes as Partial<Shape>[]).filter((s) => s.type === 'line');
    expect(lines.map((s) => s.x0).sort((p, q) => Number(p) - Number(q))).toEqual([-60, 60]);
  });

  it('applies to the H cut only and only for the target, honouring rotation', () => {
    const v = buildCutFigure(opts({ cut: 'V', series: [series('a')[1]], markers: sector, markerTarget: 'a' }));
    expect(v.data).toHaveLength(1);
    expect(buildCutFigure(opts({ markers: sector })).data).toHaveLength(1);
    const f = buildCutFigure(opts({ markers: sector, markerTarget: 'a', rotationDeg: 30, sectorEdgeDeg: 45 }));
    expect(traces(f).find((t) => t.name === 'Sector edge +45°')!.theta).toEqual([75, 75]);
  });

  const withDu = (edges: [number, number] | null, rot = 0) => {
    const base = series('a')[0];
    const r = edges
      ? { value: edges[1] - edges[0], edges, angle: (edges[0] + edges[1]) / 2 }
      : { value: null, reason: 'x' };
    const metrics = { ...base.metrics, du: { qam16: r, qam64: r, qam256: r } };
    return { ...base, metrics, rotationDeg: rot };
  };
  const bar16 = (f: { data: unknown[] }) => traces(f).find((t) => t.name?.startsWith('D/U 16QAM'))!;

  it('uses the aperture edges, not angle +/- value/2, for the arcs', () => {
    const f = buildCutFigure(opts({ series: [withDu([-20, 50])], markers: sector, markerTarget: 'a' }));
    const th = bar16(f).theta as number[];
    expect(th[0]).toBe(-20);
    expect(th[th.length - 1]).toBe(50);
  });

  it('keeps one polar arc and splits the rectangular bar at the seam for a wrapped aperture', () => {
    const s = withDu([-300, 10]);
    const polar = buildCutFigure(opts({ series: [s], markers: sector, markerTarget: 'a' }));
    expect(bar16(polar).theta).toHaveLength(311);
    const rect = buildCutFigure(opts({ mode: 'rect', series: [s], markers: sector, markerTarget: 'a' }));
    const x = bar16(rect).x as (number | null)[];
    expect(x.filter((v) => v === null)).toHaveLength(1);
    const gap = x.indexOf(null);
    expect(x[gap - 1]).toBe(180);
    expect(x[gap + 1]).toBe(-179);
    expect(x[0]).toBe(60);
    expect(x[x.length - 1]).toBe(10);
  });

  it('draws a full ring/bar for 360 degrees without a stray point at +180', () => {
    const s = withDu([-180, 180]);
    const rect = buildCutFigure(opts({ mode: 'rect', series: [s], markers: sector, markerTarget: 'a' }));
    const x = bar16(rect).x as (number | null)[];
    expect(x).not.toContain(null);
    expect(x[0]).toBe(-180);
    expect(x[x.length - 1]).toBe(180);
    const polar = buildCutFigure(opts({ series: [s], markers: sector, markerTarget: 'a' }));
    expect((bar16(polar).theta as number[]).length).toBe(361);
  });

  it('draws no arc but still the edge lines when the aperture is null', () => {
    const f = buildCutFigure(opts({ series: [withDu(null)], markers: sector, markerTarget: 'a' }));
    expect(arcNames(f)).toHaveLength(0);
    expect(traces(f).map((t) => t.name)).toContain('Sector edge +60°');
  });

  it('gives edge lines a dash style distinct from the beam-direction ray', () => {
    const f = buildCutFigure(opts({ markers: { ...sector, peak: true }, markerTarget: 'a' }));
    const edge = traces(f).find((t) => t.name === 'Sector edge +60°')!;
    const beam = traces(f).find((t) => t.name?.startsWith('Squint'))!;
    expect(edge.line!.dash).toBe('dashdot');
    expect(beam.line!.dash).not.toBe(edge.line!.dash);
  });

  it('starts the D/U bars one slot in so none sits on the plot edge', () => {
    const f = buildCutFigure(opts({ mode: 'rect', markers: sector, markerTarget: 'a' }));
    const ys = ['16QAM', '64QAM', '256QAM'].map((q) => new Set(traces(f).find((t) => t.name?.startsWith(`D/U ${q}`))?.y as number[]));
    for (const y of ys) expect([...y][0]).toBeLessThan(0);
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

describe('legend placement', () => {
  const expectBottomLegend = (legend: (Partial<Legend> & { maxheight?: number }) | undefined) => {
    expect(legend?.yref).toBe('container');
    expect(legend?.y).toBe(0);
    expect(legend?.yanchor).toBe('bottom');
    expect(legend?.orientation).toBe('h');
    expect(legend?.maxheight).toBeGreaterThan(0);
    expect(legend?.maxheight).toBeLessThanOrEqual(0.25);
  };

  it('keeps the cut legend below the axis title in both modes and caps its height', () => {
    const rect = buildCutFigure(opts({ mode: 'rect' }));
    expectBottomLegend(rect.layout.legend);
    expect(rect.layout.xaxis?.automargin).toBe(true);
    expectBottomLegend(buildCutFigure(opts({ mode: 'polar' })).layout.legend);
  });

  it('keeps the HPBW legend below the frequency title and caps its height', () => {
    const f = buildHpbwFigure([{ label: 'a', color: '#123456', points: [{ freq: 1800, h: 65, v: 8 }] }], FIGURE_THEMES.light);
    expectBottomLegend(f.layout.legend);
    expect(f.layout.xaxis?.automargin).toBe(true);
  });
});
