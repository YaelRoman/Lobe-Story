import { describe, expect, it } from 'vitest';
import type { Legend, PlotData, Shape } from 'plotly.js';
import { buildHpbwFigure, hpbwCaption } from './hpbwFigure';
import { exportFigure } from './exportFigure';
import { buildCutBase, buildCutFigure, buildCutOverlay, markerCaption, markerReadout, verticalAngleTicks, type CutFigureOptions, type PlotSeries } from './cutFigure';
import { FIGURE_THEMES } from './figureTheme';
import { analyzePattern } from '../core/analysis/metrics';
import { tiltPattern } from '../core/analysis/tilt';
import { hBeamWithLobes, patternFrom, quadBeam, vBeamWithLobes, vFarLobes } from '../test/synthetic';
import { seriesIdOf, traceUid } from './traceUid';

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
  it('draws a series with a line pattern in that pattern, and an original dashed', () => {
    const [a] = series('a');
    const f = buildCutFigure(opts({ series: [{ ...a, lineDash: 'dot' }, { ...a, id: 'b', lineDash: 'longdash' }, { ...a, id: 'c', dash: true }] }));
    expect(traces(f).slice(0, 3).map((t) => t.line?.dash)).toEqual(['dot', 'longdash', 'dash']);
  });

  it('names the cone cut in the horizontal title only when a series is a mechanically tilted simulation', () => {
    const [h, v] = series('a');
    const title = (f: { layout: { title?: unknown } }) => (f.layout.title as { text: string }).text;
    const suffix = ' · cut through the tilted beam peak';
    expect(title(buildCutFigure(opts({ series: [h] })))).not.toContain(suffix);
    expect(title(buildCutFigure(opts({ series: [{ ...h, coneCut: true }] })))).toContain(suffix);
    expect(title(buildCutFigure(opts({ cut: 'V', series: [{ ...v, coneCut: true }] })))).not.toContain(suffix);
  });

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

  it('names the beamwidth after the level: HPBW at 3 dB, BW@x dB otherwise', () => {
    const markers = { ...NO_MARKERS, hpbw: true };
    const f = buildCutFigure(opts({ markers, markerTarget: 'a', levelDb: 10 }));
    const names = traces(f).map((t) => t.name);
    expect(names.some((n) => /^BW@10 dB \d/.test(n ?? ''))).toBe(true);
    expect(names.some((n) => /^HPBW/.test(n ?? ''))).toBe(false);
    expect(names).toContain('−10 dB');
    expect(String((f.layout.title as { text: string }).text)).toMatch(/^Horizontal cut — BW@10 dB /);
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
      expect(n).toContain('First USLS = USLS peak to 20° = USLS horizon to 20° 18.0 dB');
      expect(n).toContain('Null fill 22.0 dB');
      expect(n).toContain('First LSLS 15.0 dB');
      expect(n.filter((x) => x?.startsWith('USLS'))).toEqual([]);
    });

    it('marks merged lobes', () => {
      const n = nm(names('V', quadBeam(60), quadBeam(8, 6)));
      expect(n).toContain('First USLS (merged) = USLS peak to 20° = USLS horizon to 20° 28.9 dB');
      expect(n).toContain('Null fill (merged) = First LSLS (merged) 28.9 dB');
    });

    it('keeps differing values as separate markers', () => {
      const n = nm(names('V', quadBeam(60), vFarLobes));
      expect(n).toContain('First USLS (merged) 23.2 dB');
      expect(n).toContain('USLS peak to 20° = USLS horizon to 20° 18.0 dB');
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

describe('highlighted file emphasis', () => {
  const three = (): PlotSeries[] => ['a', 'b', 'c'].map((id) => ({ ...series('a')[0], id, label: id }));
  type Emph = Partial<PlotData> & { legendrank?: number };
  const byName = (f: { data: unknown[] }, name: string) => (f.data as Emph[]).find((t) => t.name === name)!;

  for (const mode of ['polar', 'rect'] as const) {
    it(`dims the other files and draws the highlighted one last at width 2.5 (${mode})`, () => {
      const f = buildCutFigure(opts({ mode, series: three(), markerTarget: 'b' }));
      const t = traces(f);
      expect(t.map((x) => x.name)).toEqual(['a', 'c', 'b']);
      expect(byName(f, 'b').opacity).toBeUndefined();
      expect(byName(f, 'b').line?.width).toBe(2.5);
      for (const n of ['a', 'c']) {
        expect(byName(f, n).opacity).toBeCloseTo(0.35);
        expect(byName(f, n).line?.width).toBe(1.5);
      }
    });

    it(`leaves every trace at full opacity and in order when nothing is highlighted (${mode})`, () => {
      const f = buildCutFigure(opts({ mode, series: three(), markerTarget: null }));
      expect(traces(f).map((x) => x.name)).toEqual(['a', 'b', 'c']);
      expect(traces(f).every((x) => x.opacity === undefined && x.line?.width === 1.5)).toBe(true);
    });
  }

  it('keeps the legend order of the series when the highlight moves a trace to the top', () => {
    const f = buildCutFigure(opts({ series: three(), markerTarget: 'a' }));
    expect(['a', 'b', 'c'].map((n) => byName(f, n).legendrank)).toEqual([0, 1, 2]);
  });

  it('does not dim anything when the highlighted id matches no series, and keeps the file’s own original trace bright', () => {
    const f = buildCutFigure(opts({ series: three(), markerTarget: 'zzz' }));
    expect(traces(f).every((x) => x.opacity === undefined)).toBe(true);
    const withOriginal = [...three(), { ...three()[0], id: 'a#original', label: 'a (original)', dash: true }];
    const g = buildCutFigure(opts({ series: withOriginal, markerTarget: 'a' }));
    expect(byName(g, 'a (original)').opacity).toBeUndefined();
    expect(byName(g, 'b').opacity).toBeCloseTo(0.35);
  });
});

describe('cut legend contents', () => {
  const many = (n: number): PlotSeries[] =>
    Array.from({ length: n }, (_, i) => ({ ...series('a')[0], id: `f${i}`, label: `${1800 + i} MHz · _${1800 + i}_X_CO_P45_08T_VeryLongAntennaModelName_Variant${i}.MSI` }));

  it('lists file traces with compact names up to 4, and hides the legend beyond that', () => {
    const f4 = buildCutFigure(opts({ series: many(4) }));
    expect(f4.layout.showlegend).toBe(true);
    for (const t of traces(f4)) {
      expect(t.showlegend).not.toBe(false);
      expect(t.name!.length).toBeLessThanOrEqual(34);
    }
    expect(buildCutFigure(opts({ series: many(5) })).layout.showlegend).toBe(false);
  });

  it('keeps the full file name in the hover label', () => {
    const [t] = traces(buildCutFigure(opts({ series: many(1) }))) as (Partial<PlotData> & { meta?: string })[];
    expect(t.hovertemplate).toContain('<extra>%{meta}</extra>');
    expect(t.meta).toBe('1800 MHz · _1800_X_CO_P45_08T_VeryLongAntennaModelName_Variant0.MSI');
  });

  it('keeps marker traces out of the legend (the read-out lists them)', () => {
    const s = series('a')[0];
    const f = buildCutFigure(opts({ series: [s], markerTarget: 'a', markers: { ...NO_MARKERS, hpbw: true, peak: true } }));
    const markerTraces = traces(f).slice(1);
    expect(markerTraces.length).toBeGreaterThan(0);
    expect(markerTraces.every((t) => t.showlegend === false)).toBe(true);
    const rect = buildCutFigure(opts({ mode: 'rect', series: [s], markerTarget: 'a', markers: { ...NO_MARKERS, fb: true } }));
    expect(traces(rect).slice(1).every((t) => t.showlegend === false)).toBe(true);
  });

  it('puts the polar radial tick labels on the empty (rear) side, never over the beam', () => {
    const radial = (over: Partial<CutFigureOptions>) => buildCutFigure(opts(over)).layout.polar?.radialaxis;
    expect(radial({ cut: 'H' })?.angle).toBe(270);
    expect(radial({ cut: 'H' })?.tickangle).toBe(0);
    expect(radial({ cut: 'H', rotationDeg: 30 })?.angle).toBe(240);
    expect(radial({ cut: 'H', rotationDeg: -30 })?.angle).toBe(300);
    expect(radial({ cut: 'H', series: [{ ...series('a')[0], rotationDeg: 300 }] })?.angle).toBe(330);
    expect(radial({ cut: 'V' })?.angle).toBe(270);
  });

  it('thins the radial ticks for a deep floor', () => {
    expect(buildCutFigure(opts({ floorDb: 40 })).layout.polar?.radialaxis?.dtick).toBe(10);
    expect(buildCutFigure(opts({ floorDb: 80 })).layout.polar?.radialaxis?.dtick).toBe(20);
  });
});

describe('markerReadout', () => {
  it('lists the values of the active markers of the target, nothing without a target', () => {
    const s = series('a')[0];
    const m = { ...NO_MARKERS, hpbw: true, peak: true };
    expect(markerReadout(opts({ series: [s], markerTarget: null, markers: m }))).toEqual([]);
    const r = markerReadout(opts({ series: [s], markerTarget: 'a', markers: m }));
    expect(r.some((x) => x.startsWith('HPBW '))).toBe(true);
    expect(r.some((x) => x.startsWith('Squint '))).toBe(true);
    expect(markerReadout(opts({ series: [s], markerTarget: 'a', markers: NO_MARKERS }))).toEqual([]);
  });
});

describe('vertical polar angle labels', () => {
  it('label the front side −90…+90 with positive below the horizon, the back side blank but for 180°', () => {
    const { tickvals, ticktext } = verticalAngleTicks();
    // Ticks sit at 0…330 on the circle (Plotly's positions); a signed angle a is at a mod 360.
    const at = (a: number) => ticktext[tickvals.indexOf((a + 360) % 360)];
    expect([-90, -60, -30, 0, 30, 60, 90].map(at)).toEqual(['−90°', '−60°', '−30°', '0°', '+30°', '+60°', '+90°']);
    expect([-150, -120, 120, 150].map(at)).toEqual(['', '', '', '']);
    expect(at(180)).toBe('180°');
    expect(tickvals).toHaveLength(12);
  });

  it('are on the vertical polar plot only, with "above / below horizon" hints; the horizontal polar and the rectangular plots are unchanged', () => {
    const [h, v] = series('a');
    const vf = buildCutFigure(opts({ cut: 'V', series: [v] }));
    expect(vf.layout.polar?.angularaxis?.ticktext).toContain('−30°');
    const hints = (vf.layout.annotations ?? []).map((x) => x.text);
    expect(hints).toEqual(['▲ above horizon', '▼ below horizon']);
    const hf = buildCutFigure(opts({ cut: 'H', series: [h] }));
    expect(hf.layout.polar?.angularaxis?.ticktext).toBeUndefined();
    expect(hf.layout.annotations ?? []).toEqual([]);
    // Room under the vertical circle for the "+90°" label (the legend sits at the bottom).
    expect(vf.layout.margin?.b).toBeGreaterThan(hf.layout.margin?.b ?? 0);
    const rf = buildCutFigure(opts({ cut: 'V', series: [v], mode: 'rect' }));
    expect(rf.layout.annotations ?? []).toEqual([]);
    expect(rf.layout.xaxis?.ticktext).toBeUndefined();
  });

  it('agree with the data: the traces and the hover text carry the same signed angle (positive below)', () => {
    const [, v] = series('a');
    const t = traces(buildCutFigure(opts({ cut: 'V', series: [v] })))[0];
    expect(Math.min(...(t.theta as number[]))).toBeLessThan(-170);
    expect(Math.max(...(t.theta as number[]))).toBe(180);
    expect(t.hovertemplate).toContain('%{theta:.0f}°');
  });
});

describe('read-out wording', () => {
  const [h, v] = series('a');
  it('joins labels that share one value with " = " and keeps " · " for the separate items (the page does the latter)', () => {
    const r = markerReadout(opts({ cut: 'V', series: [v], markerTarget: 'a', markers: { ...NO_MARKERS, usls: true } }));
    expect(r).toContain('First USLS = USLS peak to 20° = USLS horizon to 20° 18.0 dB');
    expect(r.some((x) => x.includes(' · '))).toBe(false);
  });

  it('replaces the two sector-edge items by one roll-off item with its value', () => {
    const r = markerReadout(opts({ series: [h], markerTarget: 'a', markers: { ...NO_MARKERS, sector: true } }));
    const roll = analyzePattern({ pattern: patternFrom(quadBeam(60), vBeamWithLobes, { id: 'a' }), tags: {} }).rollOff.value!;
    expect(r.filter((x) => x.startsWith('Sector edge'))).toEqual([]);
    expect(r).toContain(`Roll-off at ±60°: ${roll.toFixed(1)} dB`);
    expect(r.filter((x) => x.startsWith('Roll-off'))).toHaveLength(1);
    // The edge lines are still drawn.
    const names = traces(buildCutFigure(opts({ markers: { ...NO_MARKERS, sector: true }, markerTarget: 'a' }))).map((t) => t.name);
    expect(names).toContain('Sector edge +60°');
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

describe('beamwidth chart export', () => {
  const series = [
    { label: '+45 · 2°T', color: '#111', points: [{ freq: 1800, h: 60, v: 7 }] },
    { label: '-45 · 2°T', color: '#222', points: [{ freq: 1800, h: 61, v: 7 }] },
  ];

  it('gives each group one legend trace carrying its full name, so the labelled export lists the groups', () => {
    const f = buildHpbwFigure(series, FIGURE_THEMES.light);
    const metas = (f.data as unknown as { meta?: string }[]).map((t) => t.meta).filter(Boolean);
    expect(metas).toEqual(['+45 · 2°T', '-45 · 2°T']);
    const out = exportFigure(f, hpbwCaption(3, false));
    const legend = (out.data as unknown as { name?: string; showlegend?: boolean }[]).filter((t) => t.showlegend !== false).map((t) => t.name);
    expect(legend).toEqual(['+45 · 2°T', '-45 · 2°T']);
    const title = (out.layout.title as { text: string }).text;
    expect(title).toContain('H-HPBW and V-HPBW against frequency');
    expect(title).toContain('dashed lines: vertical');
  });

  it('follows the beamwidth level and mentions the original lines under a simulation', () => {
    const c = hpbwCaption(10, true);
    expect(c.title).toContain('H-BW@10 dB');
    expect(c.items.join(' ')).toContain('original');
  });
});

describe('the cut figure in two parts: what a highlight leaves alone, and what it changes', () => {
  const ALL = { hpbw: true, fb: true, usls: true, null: true, peak: true, sector: true };
  const three = (cut: 0 | 1): PlotSeries[] => ['a', 'b', 'c'].map((id) => ({ ...series('a')[cut], id, label: id }));
  const fileTraces = (f: { data: unknown[] }) => (f.data as { uid?: string }[]).filter((t) => typeof t.uid === 'string');

  for (const mode of ['polar', 'rect'] as const) {
    for (const cut of ['H', 'V'] as const) {
      it(`the base has every file trace plain and in series order, whoever is highlighted (${mode}, ${cut})`, () => {
        const o = opts({ mode, cut, series: three(cut === 'H' ? 0 : 1), markers: ALL, markerTarget: 'a' });
        const base = buildCutBase(o);
        expect(base.data).toHaveLength(3);
        expect(traces(base).map((t) => t.name)).toEqual(['a', 'b', 'c']);
        expect(traces(base).every((t) => t.opacity === undefined && t.line?.width === 1.5)).toBe(true);
        // Nothing of it depends on the highlighted file or on the markers.
        expect(buildCutBase({ ...o, markerTarget: 'c', markers: NO_MARKERS } as CutFigureOptions)).toEqual(base);
        expect(base).toEqual(buildCutFigure({ ...o, markers: NO_MARKERS, markerTarget: null }));
      });

      it(`base and overlay together are the complete figure: same markers after the file traces, same layout (${mode}, ${cut})`, () => {
        for (const markerTarget of ['b', null, 'zzz']) {
          const o = opts({ mode, cut, series: three(cut === 'H' ? 0 : 1), markers: ALL, markerTarget });
          const base = buildCutBase(o);
          const overlay = buildCutOverlay(o);
          const complete = buildCutFigure(o);
          expect(complete.data.slice(fileTraces(complete).length)).toEqual(overlay.data);
          expect(fileTraces(complete)).toHaveLength(base.data.length);
          expect({ ...base.layout, ...overlay.layout }).toEqual(complete.layout);
          expect(overlay.data.length > 0).toBe(markerTarget === 'b');
        }
      });
    }

    it(`the overlay's title names the highlighted file's beamwidth; without one it clears markers and shapes (${mode})`, () => {
      const title = (o: { layout: { title?: unknown } }) => (o.layout.title as { text: string }).text;
      const on = buildCutOverlay(opts({ mode, series: three(0), markers: ALL, markerTarget: 'b' }));
      const off = buildCutOverlay(opts({ mode, series: three(0), markers: ALL, markerTarget: null }));
      expect(title(on)).toMatch(/^Horizontal cut — HPBW \d+\.\d°$/);
      expect(title(off)).toBe('Horizontal cut');
      expect(off.data).toEqual([]);
      // A layout merge only replaces the keys it is given: the rectangular overlay always carries `shapes`, also empty.
      expect(off.layout.shapes).toEqual(mode === 'rect' ? [] : undefined);
      expect((on.layout.shapes ?? []).length > 0).toBe(mode === 'rect');
    });
  }
});

describe('the reference file in the cut plots', () => {
  const [a] = series('a');
  const base = { ...a, id: 'a', label: 'a' };
  const ref = { ...a, id: 'r', label: 'r (reference)', color: '#999999', reference: true };

  it('draws the reference last, thick and dashed in the theme text colour, never dimmed', () => {
    for (const theme of ['light', 'dark'] as const) {
      const f = buildCutFigure(opts({ series: [ref, base, { ...base, id: 'b', label: 'b' }], markerTarget: 'a', theme: FIGURE_THEMES[theme] }));
      const t = traces(f) as (Partial<PlotData> & { uid?: string })[];
      expect(t.map((x) => x.uid)).toEqual([traceUid('b'), traceUid('a'), traceUid('r', true)]);
      const r = t[2];
      expect(r.line).toMatchObject({ color: FIGURE_THEMES[theme].fg, dash: 'dash', width: 3.5 });
      expect(r.opacity).toBeUndefined();
      // The other files are dimmed around the highlighted one, the reference is not.
      expect(t[0].opacity).toBeLessThan(1);
      expect(t[1].line!.width).toBe(2.5);
    }
  });

  it('names it in the legend entry, the hover/export name and the read-out', () => {
    const f = buildCutFigure(opts({ series: [base, ref], markerTarget: 'r', markers: { ...NO_MARKERS, peak: true } }));
    const r = (traces(f) as (Partial<PlotData> & { meta?: string })[]).find((t) => t.name?.includes('(reference)'))!;
    expect(r.meta).toBe('r (reference)');
    const readout = markerReadout(opts({ series: [base, ref], markerTarget: 'r', markers: { ...NO_MARKERS, peak: true } }));
    expect(readout.length).toBeGreaterThan(0);
  });

  it('keeps the reference thick and bright when it is itself the highlighted file, and dims the others', () => {
    const f = buildCutFigure(opts({ series: [base, ref], markerTarget: 'r' }));
    const t = traces(f) as (Partial<PlotData> & { uid?: string })[];
    expect(t.find((x) => x.uid === traceUid('r', true))!.line!.width).toBe(3.5);
    expect(t.find((x) => x.uid === traceUid('a'))!.opacity).toBeLessThan(1);
  });

  it('gives every file trace a uid that is a plain CSS identifier, whatever the file id, and the same on every build', () => {
    const hostile = `quote'=<b>:(2).msi`;
    const make = () => buildCutFigure(opts({ series: [{ ...base, id: 'a (2).msi' }, { ...base, id: hostile }, { ...ref, id: 'r (1).msi' }], markerTarget: hostile }));
    const uids = (traces(make()) as { uid?: string }[]).map((t) => t.uid);
    expect(uids.filter((u) => u !== undefined)).toHaveLength(3);
    for (const u of uids) if (u !== undefined) expect(u).toMatch(/^[a-z][A-Za-z0-9_-]*$/);
    expect(uids.map((u) => seriesIdOf(u))).toEqual(['a (2).msi', hostile, 'r (1).msi']);
    expect((traces(make()) as { uid?: string }[]).map((t) => t.uid)).toEqual(uids);
  });

  it('is drawn on top in rectangular mode too, and counted for the legend', () => {
    const f = buildCutFigure(opts({ mode: 'rect', series: [ref, base] }));
    expect((traces(f) as { uid?: string }[]).map((t) => t.uid)).toEqual([traceUid('a'), traceUid('r', true)]);
    expect(f.data[1]).toMatchObject({ type: 'scatter' });
  });
});

describe('the reference point in the frequency charts', () => {
  it('adds a labelled diamond to the beamwidth chart, one per panel', () => {
    const f = buildHpbwFigure(
      [{ label: 'g1', color: '#111', points: [{ freq: 1700, h: 65, v: 8 }] }],
      FIGURE_THEMES.dark,
      3,
      { label: 'ref.msi', point: { freq: 1800, h: 70, v: null } },
    );
    const t = traces(f);
    const diamonds = t.filter((x) => (x.marker as { symbol?: string } | undefined)?.symbol === 'diamond');
    expect(diamonds).toHaveLength(2);
    expect(diamonds[0]).toMatchObject({ name: 'ref.msi (reference)', x: [1800], y: [70], yaxis: 'y' });
    expect(diamonds[1]).toMatchObject({ yaxis: 'y2', showlegend: false, y: [null] });
    expect((diamonds[0].marker as { color?: string }).color).toBe(FIGURE_THEMES.dark.fg);
    expect(f.layout.yaxis?.range).toBeUndefined();
    expect(hpbwCaption(3, false, true).items).toContain('Diamond: the reference file');
    expect(hpbwCaption(3, false).items).toEqual([]);
  });
});

describe('markerCaption and the export of a real cut figure', () => {
  const o = { levelDb: 3, fbWindowDeg: 30, sectorEdgeDeg: 60, uslsRangeDeg: 20 };
  const all = { hpbw: true, fb: true, usls: true, null: true, peak: true, sector: true };

  it('is empty when no marker is on, and lists only the markers that are on', () => {
    expect(markerCaption('H', NO_MARKERS, o)).toBeUndefined();
    expect(markerCaption('V', { ...NO_MARKERS, fb: true, sector: true }, o)).toBeUndefined();
    const line = markerCaption('H', { ...NO_MARKERS, hpbw: true, sector: true }, o)!;
    expect(line).toContain('dashed ring: the −3 dB level');
    expect(line).toContain('shaded wedge: the HPBW');
    expect(line).toContain('dash-dot rays: the sector edges (±60°)');
    expect(line).toContain('thick arcs: the D/U apertures');
    expect(line).not.toContain('F/B window');
    expect(line).not.toContain('dotted ray');
  });

  it('names the markers of the cut it is for', () => {
    const h = markerCaption('H', all, o)!;
    const v = markerCaption('V', all, o)!;
    expect(h).toContain('F/B window (180° ± 30°)');
    expect(h).toContain('H-SLS');
    expect(h).toContain('(squint)');
    expect(v).not.toContain('F/B window');
    expect(v).not.toContain('sector edges');
    expect(v).toContain('null fill');
    expect(v).toContain('(tilt)');
    expect(v).toContain('USLS peaks within 20°');
  });

  it('uses the words of the plot mode and says "highlighted" only for a highlighted file', () => {
    const rect = markerCaption('H', all, { ...o, mode: 'rect' })!;
    expect(rect).toContain('dashed line: the −3 dB level');
    expect(rect).toContain('shaded band: the HPBW');
    expect(rect).toContain('light band: the F/B window');
    expect(rect).toContain('dotted vertical line: the beam direction');
    expect(rect).toContain('dash-dot vertical lines: the sector edges');
    expect(rect).toContain('thick segments: the D/U apertures');
    for (const word of ['ring', 'wedge', 'ray', 'arc']) expect(rect).not.toContain(word);
    const polar = markerCaption('H', all, { ...o, mode: 'polar' })!;
    for (const word of ['ring', 'wedge', 'ray', 'arc']) expect(polar).toContain(word);
    expect(rect.startsWith('Markers of the highlighted file:')).toBe(true);
    expect(markerCaption('V', all, { ...o, highlighted: false })!.startsWith('Markers of the only ticked file:')).toBe(true);
  });

  it('a dark-theme cut figure exports without any dark colour, light and on white', () => {
    const dark = buildCutFigure(opts({ theme: FIGURE_THEMES.dark, markers: all, markerTarget: 'a', series: [series('a')[0]] }));
    const text = JSON.stringify(dark).toLowerCase();
    expect(text).toContain(FIGURE_THEMES.dark.bg);
    const out = exportFigure(dark, { items: [] }, 'dark');
    const exported = JSON.stringify(out).toLowerCase();
    for (const c of Object.values(FIGURE_THEMES.dark)) expect(exported).not.toContain(c.toLowerCase());
    expect(out.layout.paper_bgcolor).toBe('#ffffff');
    expect(JSON.stringify(dark).toLowerCase()).toBe(text);
  });
});
