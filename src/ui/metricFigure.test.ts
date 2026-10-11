import { describe, expect, it } from 'vitest';
import type { PlotData } from 'plotly.js';
import { buildMetricFigure, metricAxisTitle, metricCaption, minSpanForUnit } from './metricFigure';
import { FIGURE_THEMES } from './figureTheme';

const traces = (f: { data: unknown[] }) => f.data as Partial<PlotData>[];

describe('buildMetricFigure', () => {
  const series = [
    { label: 'g1', color: '#111', points: [{ freq: 1700, value: 25 }, { freq: 1800, value: null }, { freq: 1900, value: 27, declared: 26 }] },
    { label: 'g2', color: '#222', points: [{ freq: 1700, value: 30 }] },
  ];

  it('draws one line per group with gaps for missing values, and declared markers', () => {
    const f = buildMetricFigure(series, FIGURE_THEMES.light, 'F/B 180°', 'dB');
    const t = traces(f);
    expect(t.map((x) => x.name)).toEqual(['g1', 'g1 declared', 'g2']);
    expect(t[0].x).toEqual([1700, 1800, 1900]);
    expect(t[0].y).toEqual([25, null, 27]);
    expect(t[1]).toMatchObject({ y: [26], marker: { symbol: 'circle-open' } });
  });

  it('titles the y axis with the label and unit', () => {
    const f = buildMetricFigure(series, FIGURE_THEMES.dark, 'F/B 180°', 'dB');
    expect(f.layout.yaxis?.title).toMatchObject({ text: 'F/B 180° (dB)' });
    expect(metricAxisTitle('SPR', '%')).toBe('SPR (%)');
  });

  it('keeps at least the unit span: 3 dB, 5 degrees', () => {
    const one = buildMetricFigure([{ label: 'a', color: '#1', points: [{ freq: 1800, value: 20 }] }], FIGURE_THEMES.light, 'F/B', 'dB');
    expect(one.layout.yaxis?.range).toEqual([18.5, 21.5]);
    const deg = buildMetricFigure([{ label: 'a', color: '#1', points: [{ freq: 1800, value: 2 }] }], FIGURE_THEMES.light, 'Squint', '°');
    expect(deg.layout.yaxis?.range).toEqual([-0.5, 4.5]);
    const wide = buildMetricFigure(series, FIGURE_THEMES.light, 'F/B', 'dB');
    expect(wide.layout.yaxis?.range).toBeUndefined();
    expect(minSpanForUnit('dB')).toBe(3);
    expect(minSpanForUnit('widgets')).toBeGreaterThan(0);
  });

  it('draws a ghost original line faint, without legend entry or declared markers', () => {
    const f = buildMetricFigure([{ ...series[0], ghost: true }, series[0]], FIGURE_THEMES.light, 'F/B', 'dB');
    const t = traces(f);
    expect(t[0]).toMatchObject({ opacity: 0.35, showlegend: false, name: 'g1 (original)' });
    expect(t.map((x) => x.name)).toEqual(['g1 (original)', 'g1', 'g1 declared']);
  });

  it('names the metric in the export caption', () => {
    const c = metricCaption('F/B 180°', 'dB', true);
    expect(c.title).toContain('F/B 180° (dB) against frequency');
    expect(c.items).toHaveLength(1);
    expect(metricCaption('F/B 180°', 'dB', false).items).toHaveLength(0);
  });
});

describe('the reference point', () => {
  it('adds one labelled diamond in the text colour and widens the minimum-span range around it', () => {
    const f = buildMetricFigure(
      [{ label: 'a', color: '#1', points: [{ freq: 1800, value: 20 }] }],
      FIGURE_THEMES.light,
      'F/B 180°',
      'dB',
      { label: 'ref.msi', point: { freq: 1900, value: 30 } },
    );
    const t = traces(f);
    expect(t.map((x) => x.name)).toEqual(['a', 'ref.msi (reference)']);
    expect(t[1]).toMatchObject({ mode: 'markers', x: [1900], y: [30], marker: { symbol: 'diamond', color: FIGURE_THEMES.light.fg } });
    // 20 and 30 span more than the minimum: automatic range.
    expect(f.layout.yaxis?.range).toBeUndefined();
    expect(metricCaption('F/B 180°', 'dB', false, true).items).toEqual(['Diamond: the reference file']);
  });
});
