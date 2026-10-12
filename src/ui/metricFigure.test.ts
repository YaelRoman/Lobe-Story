import { describe, expect, it } from 'vitest';
import type { PlotData } from 'plotly.js';
import { buildMetricFigure, metricAxisTitle, metricCaption, minSpanForUnit, noValueNote, noValues, coincidingNote, plottedFileIds } from './metricFigure';
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

  it('explains the hollow markers only for a metric that has declared values', () => {
    expect(metricCaption('Squint', '°', false).file).toBe('Squint in °: one line per group');
    expect(metricCaption('F/B 180°', 'dB', false, false, true).file).toContain('hollow markers: values declared in the file');
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

describe('no value for the metric', () => {
  const pt = (value: number | null, declared?: number) => ({ freq: 1800, value, ...(declared !== undefined ? { declared } : {}) });

  it('is true only when no point, declared value or reference point has a number', () => {
    expect(noValues([{ label: 'g', color: '#1', points: [pt(null), pt(null)] }])).toBe(true);
    expect(noValues([])).toBe(true);
    expect(noValues([{ label: 'g', color: '#1', points: [pt(null), pt(3)] }])).toBe(false);
    expect(noValues([{ label: 'g', color: '#1', points: [pt(null, 12)] }])).toBe(false);
    expect(noValues([{ label: 'g', color: '#1', points: [pt(null)] }], { label: 'r', point: pt(4) })).toBe(false);
    expect(noValues([{ label: 'g', color: '#1', points: [pt(null)] }], { label: 'r', point: pt(null) })).toBe(true);
  });

  it('says which metric has no value and why, each reason once', () => {
    expect(noValueNote('H-SLS', ['no sidelobe above the main beam', undefined, 'no sidelobe above the main beam'])).toBe(
      'No file has a value for H-SLS: no sidelobe above the main beam.',
    );
    expect(noValueNote('SPR', [undefined])).toBe('No file has a value for SPR.');
    expect(noValueNote('F/B', ['a', 'b'])).toBe('No file has a value for F/B: a; b.');
  });
});

describe('coincidingNote', () => {
  const line = (label: string, ...v: (number | null)[]) => ({ label, points: v.map((value, i) => ({ freq: 1700 + 100 * i, value })) });

  it('names lines that are exactly on top of each other, joined with " = "', () => {
    expect(coincidingNote([line('+45 · 2°T', 20, 21), line('-45 · 2°T', 20, 21), line('+45 · 5°T', 22, 23)])).toBe('2 lines coincide: +45 · 2°T = -45 · 2°T.');
    expect(coincidingNote([line('A', 1, 2), line('B', 1, 2), line('C', 1, 2), line('D', 5, 6), line('E', 5, 6)])).toBe('3 lines coincide: A = B = C; 2 lines coincide: D = E.');
  });

  it('is null when every line differs, and ignores lines without a number and tiny float noise only below 1e-6', () => {
    expect(coincidingNote([line('A', 1, 2), line('B', 1, 2.1)])).toBeNull();
    expect(coincidingNote([line('A', null, null), line('B', null, null)])).toBeNull();
    expect(coincidingNote([line('A', 1, null), line('B', 1, 2)])).toBeNull();
    expect(coincidingNote([line('A', 1, 2), line('B', 1.0000000001, 2)])).toBe('2 lines coincide: A = B.');
    expect(coincidingNote([])).toBeNull();
  });

  it('keeps the note short when there are many sets', () => {
    const many = ['a', 'b', 'c', 'd'].flatMap((x, i) => [line(`${x}1`, i, i), line(`${x}2`, i, i)]);
    expect(coincidingNote(many)).toBe('2 lines coincide: a1 = a2; 2 lines coincide: b1 = b2; 2 lines coincide: c1 = c2; 1 more set.');
  });
});

describe('file ids on the points', () => {
  const ids = [
    { label: 'g1', color: '#111', points: [{ freq: 1700, value: 25, id: 'a' }, { freq: 1800, value: null, id: 'b' }, { freq: 1900, value: 27, declared: 26, id: 'c' }] },
  ];
  it('puts each point\'s file id in customdata of the line, the declared markers and the reference diamond; a ghost line has none', () => {
    const f = buildMetricFigure([...ids, { ...ids[0], ghost: true }], FIGURE_THEMES.light, 'F/B', 'dB', { label: 'r', point: { freq: 1800, value: 3, id: 'ref' } });
    const t = f.data as { name?: string; customdata?: unknown; mode?: string }[];
    expect(t[0].customdata).toEqual(['a', 'b', 'c']);
    expect(t[1].customdata).toEqual(['c']); // declared marker of c
    expect(t[2].customdata).toBeUndefined(); // ghost
    expect(t[3].customdata).toEqual(['ref']);
  });
});

describe('plottedFileIds', () => {
  const item = (id: string, frequencyMHz: number) => ({ pattern: { id, frequencyMHz } });
  const groups = [
    { items: [item('a', 1710), item('b', 1800), item('zero', 0)] },
    { items: [item('c', 2100), item('d', 2200)] },
    { items: [item('e', 0), item('f', 2600)] },
  ];

  it('lists the usable-frequency files of the groups that have a visible file with one', () => {
    expect(plottedFileIds(groups, { a: true })).toEqual(['a', 'b']);
    expect(plottedFileIds(groups, { a: true, d: true })).toEqual(['a', 'b', 'c', 'd']);
    expect(plottedFileIds(groups, {})).toEqual([]);
  });

  it('never lists a file without a frequency, and a visible one does not make its group plotted', () => {
    expect(plottedFileIds(groups, { zero: true })).toEqual([]);
    expect(plottedFileIds(groups, { e: true })).toEqual([]);
    expect(plottedFileIds(groups, { e: true, f: true })).toEqual(['f']);
  });
});
