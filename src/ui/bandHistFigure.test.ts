import { describe, expect, it } from 'vitest';
import type { Annotations, PlotData, Shape } from 'plotly.js';
import { buildBandHistFigure } from './bandHistFigure';
import { FIGURE_THEMES } from './figureTheme';
import { PALETTE } from './colors';
import { doubleSided, meanOnly, singleSided } from '../core/analysis/bandStats';
import { BASTA_AZ_HPBW, BASTA_P2P_TRACKING } from '../test/bastaVectors';

const shapes = (f: { layout: { shapes?: unknown } }) => (f.layout.shapes ?? []) as Partial<Shape>[];
const notes = (f: { layout: { annotations?: unknown } }) => (f.layout.annotations ?? []) as Partial<Annotations>[];
const trace = (f: { data: unknown[] }) => f.data[0] as Partial<PlotData>;

describe('buildBandHistFigure', () => {
  it('draws the mean and both percentiles of a double-sided statistic', () => {
    const f = buildBandHistFigure(
      { values: BASTA_AZ_HPBW, stat: doubleSided(BASTA_AZ_HPBW, 'arithmetic'), label: 'Azimuth beamwidth', unit: '°' },
      FIGURE_THEMES.light,
    );
    expect(f.data).toHaveLength(1);
    expect(trace(f).type).toBe('histogram');
    expect(trace(f).x).toHaveLength(126);
    expect((trace(f).marker as { color: string }).color).toBe(PALETTE[0]);
    expect(f.layout.xaxis?.title).toEqual({ text: 'Azimuth beamwidth (°)' });
    expect(f.layout.yaxis?.title).toEqual({ text: 'Samples' });
    expect(f.layout.showlegend).toBe(false);
    const s = shapes(f);
    expect(s).toHaveLength(3);
    expect(s[0].x0).toBeCloseTo(65.130159, 4);
    expect(s[1].x0).toBeCloseTo(61.3625, 4);
    expect(s[2].x0).toBeCloseTo(69.4, 4);
    expect(s.map((x) => x.x1)).toEqual(s.map((x) => x.x0));
    expect(s.map((x) => x.line?.dash)).toEqual(['solid', 'dash', 'dash']);
    expect(s[0]).toMatchObject({ type: 'line', xref: 'x', yref: 'paper', y0: 0, y1: 1 });
    expect(s[0].line).toMatchObject({ color: FIGURE_THEMES.light.accent, width: 2 });
    expect(notes(f).map((a) => a.text)).toEqual(['mean', 'P6.7', 'P93.3']);
    expect(notes(f)[0]).toMatchObject({ y: 1, yref: 'paper', yanchor: 'bottom', showarrow: false });
    expect(notes(f).map((a) => a.x)).toEqual(s.map((x) => x.x0));
  });

  it('draws one solid line for a single-sided statistic', () => {
    const f = buildBandHistFigure(
      { values: BASTA_P2P_TRACKING, stat: singleSided(BASTA_P2P_TRACKING, 'max', 3), label: 'P2P tracking', unit: 'dB' },
      FIGURE_THEMES.light,
    );
    expect(shapes(f)).toHaveLength(1);
    expect(shapes(f)[0].x0).toBeCloseTo(2.724, 3);
    expect(shapes(f)[0].line?.dash).toBe('solid');
    expect(notes(f).map((a) => a.text)).toEqual(['P84']);
  });

  it('adds a dotted percentile line when the excursion rule changed the value', () => {
    const values = [10, 15, 15.5, 16, 16, 16.5, 17, 17, 17.5, 18, 18, 18.5];
    const f = buildBandHistFigure({ values, stat: singleSided(values, 'min', 3), label: 'F/B', unit: 'dB' }, FIGURE_THEMES.light);
    expect(shapes(f).map((s) => s.x0)).toEqual([expect.closeTo(13, 6), expect.closeTo(15.38, 6)]);
    expect(shapes(f).map((s) => s.line?.dash)).toEqual(['solid', 'dot']);
    expect(notes(f).map((a) => a.text)).toEqual(['spec', 'P16']);
  });

  it('draws the mean of a mean-only statistic', () => {
    const values = [16.9, 17, 17.1, 17.2];
    const f = buildBandHistFigure({ values, stat: meanOnly(values, 'power'), label: 'Gain', unit: 'dBi' }, FIGURE_THEMES.light);
    expect(shapes(f)).toHaveLength(1);
    expect(notes(f).map((a) => a.text)).toEqual(['mean']);
  });

  it('draws only the histogram without a statistic, and follows the theme', () => {
    const f = buildBandHistFigure({ values: [1, 2, 3], stat: null, label: 'x', unit: 'dB' }, FIGURE_THEMES.dark);
    expect(f.data).toHaveLength(1);
    expect(shapes(f)).toEqual([]);
    expect(notes(f)).toEqual([]);
    expect(f.layout.paper_bgcolor).toBe('#0d1117');
    expect(f.layout.font?.color).toBe(FIGURE_THEMES.dark.fg);
  });
});
