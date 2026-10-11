import { describe, expect, it } from 'vitest';
import type { Data } from 'plotly.js';
import { exportCaptionLines, exportFigure, EXPORT_WIDTH } from './exportFigure';
import type { Figure } from './figureTheme';
import { LEGEND } from './figureTheme';

type T = Record<string, unknown>;
const fileTrace = (i: number): T => ({ type: 'scatter', name: `f${i}`, meta: `full name ${i}`, x: [0], y: [0] });
const marker: T = { type: 'scatter', name: 'HPBW 65°', showlegend: false, x: [0], y: [0] };

const figure = (n: number): Figure => ({
  data: [...Array.from({ length: n }, (_, i) => fileTrace(i)), marker] as unknown as Data[],
  layout: {
    title: { text: 'Horizontal cut — HPBW 65.0°' },
    showlegend: false,
    legend: LEGEND,
    margin: { l: 50, r: 30, t: 50, b: 40 },
  },
});

describe('exportFigure', () => {
  it('turns the legend on for every file trace and keeps marker traces out of it', () => {
    const out = exportFigure(figure(12));
    expect(out.layout.showlegend).toBe(true);
    const traces = out.data as unknown as T[];
    expect(traces.slice(0, 12).every((t) => t.showlegend !== false)).toBe(true);
    expect(traces[12].showlegend).toBe(false);
  });

  it('draws file traces undimmed so the legend swatches stay readable', () => {
    const f = figure(2);
    (f.data[0] as unknown as T).opacity = 0.35;
    const out = exportFigure(f);
    expect((out.data[0] as unknown as T).opacity).toBeUndefined();
    expect((f.data[0] as unknown as T).opacity).toBe(0.35);
  });

  it('puts a compact legend to the right without a height cap', () => {
    const out = exportFigure(figure(12));
    const legend = out.layout.legend as T;
    expect(legend.orientation).toBe('v');
    expect(legend.xref).toBe('paper');
    expect(legend.x).toBeGreaterThanOrEqual(1);
    expect(legend.xanchor).toBe('left');
    expect(legend.maxheight).toBeUndefined();
    expect((legend.font as T).size).toBeLessThanOrEqual(12);
    expect(out.layout.margin?.r).toBeGreaterThanOrEqual(200);
    expect(out.layout.width).toBe(EXPORT_WIDTH);
  });

  it('gives every legend row room: height grows with the number of traces', () => {
    const small = exportFigure(figure(2)).layout.height ?? 0;
    const large = exportFigure(figure(72)).layout.height ?? 0;
    expect(small).toBeGreaterThanOrEqual(640);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeGreaterThanOrEqual(72 * 16);
  });

  it('adds the highlighted file and its marker values under the title', () => {
    const out = exportFigure(figure(2), { file: '2600 MHz · Alpha', items: ['HPBW 65.0°', 'Squint 2.0°'] });
    const title = (out.layout.title as { text: string }).text;
    expect(title).toContain('Horizontal cut — HPBW 65.0°');
    expect(title).toContain('2600 MHz · Alpha');
    expect(title).toContain('HPBW 65.0°');
    expect(title).toContain('Squint 2.0°');
    expect(out.layout.margin?.t).toBeGreaterThan(50);
  });

  it('leaves the title alone without a caption and does not mutate the input', () => {
    const f = figure(3);
    const before = JSON.stringify(f);
    const out = exportFigure(f);
    expect((out.layout.title as { text: string }).text).toBe('Horizontal cut — HPBW 65.0°');
    expect(JSON.stringify(f)).toBe(before);
    expect(f.layout.showlegend).toBe(false);
  });
});

describe('exportFigure for charts without a title or without file traces', () => {
  const hist: Figure = { data: [{ type: 'histogram', x: [1, 2, 3] }] as unknown as Data[], layout: { showlegend: false, margin: { l: 60, r: 20, t: 30, b: 50 } } };

  it('uses the caption title when the figure has none and prints the caption lines', () => {
    const out = exportFigure(hist, { title: 'Azimuth beamwidth — histogram', file: 'Antenna: A', items: ['Statistic: mean 3'] });
    const text = (out.layout.title as { text: string }).text;
    expect(text.startsWith('Azimuth beamwidth — histogram<br>')).toBe(true);
    expect(text).toContain('Antenna: A');
    expect(text).toContain('Statistic: mean 3');
  });

  it('draws no legend and keeps the right margin when there are no file traces', () => {
    const out = exportFigure(hist, { title: 't', items: [] });
    expect(out.layout.showlegend).toBe(false);
    expect(out.layout.margin?.r).toBe(20);
  });

  it('names legend entries by their full label and widens the margin for a long one', () => {
    const long = 'x'.repeat(80);
    const f: Figure = { data: [{ type: 'scatter', name: 'x…x', meta: long }] as unknown as Data[], layout: { margin: {} } };
    const out = exportFigure(f);
    expect((out.data[0] as unknown as T).name).toBe(long);
    expect(out.layout.margin?.r).toBeGreaterThan(280);
    expect(out.layout.margin?.r).toBeLessThanOrEqual(520);
  });
});

describe('exportCaptionLines', () => {
  it('wraps the values into lines of bounded length', () => {
    const items = Array.from({ length: 12 }, (_, i) => `D/U value number ${i}: 12.3°`);
    const lines = exportCaptionLines({ file: 'f', items });
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines.slice(1)) expect(l.length).toBeLessThanOrEqual(120);
    expect(lines.join(' ')).toContain('value number 11');
  });
  it('is empty without a file name and values', () => {
    expect(exportCaptionLines({ items: [] })).toEqual([]);
  });
  it('is just the file name when there are no values', () => {
    expect(exportCaptionLines({ file: 'f', items: [] })).toEqual(['f']);
  });
});
