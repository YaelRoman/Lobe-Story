import { describe, expect, it } from 'vitest';
import type { Data } from 'plotly.js';
import { exportCaptionLines, exportFigure, withCoinciding, withSimulated, CAPTION_LINE_EM, FOOT_ROOM_PX, TITLE_FIRST_LINE_EM, EXPORT_MAX_HEIGHT, EXPORT_WIDTH, LEGEND_ROW_PX } from './exportFigure';
import type { Figure } from './figureTheme';
import { FIGURE_THEMES, LEGEND } from './figureTheme';

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

describe('exports are light on white whatever the screen theme (D43)', () => {
  const dark = FIGURE_THEMES.dark;
  const light = FIGURE_THEMES.light;
  const themed: Figure = {
    data: [
      { type: 'scatter', name: 'f', meta: 'full', x: [0], y: [0], line: { color: '#123456' } },
      { type: 'scatter', name: 'ring', x: [0], y: [0], line: { color: dark.accent, dash: 'dash' }, marker: { color: dark.fg, line: { color: dark.bg } } },
    ] as unknown as Data[],
    layout: { paper_bgcolor: dark.bg, font: { color: dark.fg }, xaxis: { gridcolor: dark.grid }, title: { text: 'T' } },
  };

  it('replaces every colour of the dark theme by the light one and keeps the files’ own colours', () => {
    const out = exportFigure(themed, undefined, 'dark');
    const text = JSON.stringify(out).toLowerCase();
    for (const c of Object.values(dark)) expect(text).not.toContain(c.toLowerCase());
    expect(out.layout.paper_bgcolor).toBe('#ffffff');
    expect((out.layout.font as { color: string }).color).toBe(light.fg);
    expect((out.layout.xaxis as { gridcolor: string }).gridcolor).toBe(light.grid);
    expect(((out.data[0] as unknown as T).line as T).color).toBe('#123456');
    expect(((out.data[1] as unknown as T).line as T).color).toBe(light.accent);
  });

  it('leaves the on-screen figure untouched', () => {
    const before = JSON.stringify(themed);
    exportFigure(themed, undefined, 'dark');
    expect(JSON.stringify(themed)).toBe(before);
    expect(themed.layout.paper_bgcolor).toBe(dark.bg);
  });

  it('is white for a light screen as well, and when the figure sets no background', () => {
    expect(exportFigure({ data: [], layout: {} }, undefined, 'dark').layout.paper_bgcolor).toBe('#ffffff');
    expect(exportFigure({ data: [], layout: {} }).layout.paper_bgcolor).toBe('#ffffff');
  });
});

describe('export captions: markers and simulation lines', () => {
  it('prints the marker line and the simulation line after the values, each wrapped', () => {
    const lines = exportCaptionLines({ file: 'A', items: ['HPBW 65°'], markers: 'Markers: dashed ring', simulated: 'Simulated: electrical Δ 4°, mechanical 0°, azimuth 0°, summation method' });
    expect(lines).toEqual(['A', 'HPBW 65°', 'Markers: dashed ring', 'Simulated: electrical Δ 4°, mechanical 0°, azimuth 0°, summation method']);
  });

  it('a chart without a caption still gets the simulation line', () => {
    expect(withSimulated(undefined, 'Simulated: x')).toEqual({ items: [], simulated: 'Simulated: x' });
    expect(withSimulated({ items: ['a'] }, undefined)).toEqual({ items: ['a'] });
    const out = exportFigure({ data: [], layout: { title: { text: 'T' } } }, withSimulated(undefined, 'Simulated: x'));
    expect((out.layout.title as { text: string }).text).toContain('Simulated: x');
  });

  it('wraps a long marker line at spaces', () => {
    const long = `Markers: ${'word '.repeat(60)}end`;
    const lines = exportCaptionLines({ items: [], markers: long });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.length <= 110)).toBe(true);
    expect(lines.join(' ')).toBe(long);
  });
});

describe('the exported legend is never cut off without a word', () => {
  const listed = (f: Figure) => (f.data as unknown as T[]).filter((t) => typeof t.meta === 'string' && t.showlegend === true).length;
  const room = (f: Figure) => (f.layout.height ?? 0) - (f.layout.margin?.t ?? 0) - (f.layout.margin?.b ?? 0);

  it('the plot area is as high as the legend needs: 48 entries, with a caption above, all fit', () => {
    for (const n of [24, 48, 72, 120]) {
      const out = exportFigure(figure(n), { file: 'a', items: ['x'], markers: 'Markers of the highlighted file: …', simulated: 'Simulated: …' });
      expect(listed(out)).toBe(n);
      expect(room(out)).toBeGreaterThanOrEqual(n * LEGEND_ROW_PX + 20);
      expect((out.layout.title as { text: string }).text).not.toContain('more');
    }
  });

  it('beyond what an image can hold it lists what fits and says "+N more"', () => {
    const out = exportFigure(figure(500), { file: 'a', items: ['x'] });
    expect(out.layout.height).toBeLessThanOrEqual(EXPORT_MAX_HEIGHT);
    const shown = listed(out);
    expect(shown).toBeGreaterThan(300);
    expect(shown).toBeLessThan(500);
    expect(room(out)).toBeGreaterThanOrEqual(shown * LEGEND_ROW_PX + 20);
    expect((out.layout.title as { text: string }).text).toContain(`Legend: the first ${shown} of 500 traces, +${500 - shown} more are drawn but not listed`);
    // Every trace is still drawn.
    expect(out.data).toHaveLength(501);
  });
});

describe('the caption is laid out from the top edge (R4-07)', () => {
  type Title = { text: string; yref?: string; y?: number; yanchor?: string; pad?: { t?: number }; font?: { size?: number } };
  const title = (f: Figure) => f.layout.title as Title;
  const size = (f: Figure) => title(f).font?.size ?? 17;
  const captionLines = (f: Figure) => title(f).text.split('<br>').length - 1;
  /**
   * Where the title's first line starts, in px from the top edge. The library hangs a one-line title by its cap height
   * from `pad.t`; a title of several lines loses that shift and sits 0.7 em higher (measured in the browser), so its
   * pad has to carry it.
   */
  const textStart = (f: Figure) => (title(f).pad?.t ?? 0) - (captionLines(f) > 0 ? TITLE_FIRST_LINE_EM * size(f) : 0);
  /** Where the last line of the title block ends, in px from the top edge. */
  const textEnd = (f: Figure) => textStart(f) + size(f) + CAPTION_LINE_EM * size(f) * captionLines(f);
  const caption = (n: number) => ({ file: 'f', items: Array.from({ length: n - 1 }, (_, i) => `${'x'.repeat(100)} ${i}`) });

  it('hangs the title from the top of the image, not from the middle of the margin', () => {
    for (const lines of [0, 1, 6]) {
      const t = title(exportFigure(figure(2), lines ? caption(lines) : undefined));
      expect(t).toMatchObject({ yref: 'container', y: 1, yanchor: 'top' });
    }
    for (const lines of [0, 1, 6]) {
      const out = exportFigure(figure(2), lines ? caption(lines) : undefined);
      expect(textStart(out)).toBeGreaterThanOrEqual(6);
      expect(textStart(out)).toBeLessThanOrEqual(16);
    }
  });

  it('sizes the top margin from the number of caption lines: no empty band, and no line on the plot area', () => {
    for (const lines of [1, 3, 6, 10]) {
      const out = exportFigure(figure(2), caption(lines));
      expect(exportCaptionLines(caption(lines))).toHaveLength(lines);
      const t = out.layout.margin?.t ?? 0;
      expect(t).toBeGreaterThanOrEqual(textEnd(out));
      expect(t - textEnd(out)).toBeLessThanOrEqual(40);
    }
  });

  it('a figure without a title on screen gets room for the caption title too', () => {
    const bare: Figure = { data: [fileTrace(0)] as unknown as Data[], layout: { margin: { l: 60, r: 20, t: 20, b: 50 } } };
    for (const c of [{ title: 'A chart', items: [] }, { title: 'A chart', file: 'one', items: ['two'], simulated: 'Simulated: x', note: 'word '.repeat(40).trim() }]) {
      const out = exportFigure(bare, c);
      expect(out.layout.margin?.t).toBeGreaterThanOrEqual(textEnd(out) + 20);
      expect((out.layout.margin?.t ?? 0) - textEnd(out)).toBeLessThanOrEqual(60);
    }
  });

  it('keeps the room of labels drawn above the plot area (the histogram)', () => {
    const hist: Figure = { data: [], layout: { margin: { t: 58 }, annotations: [{ text: 'mean' }] } };
    const out = exportFigure(hist, { title: 'Histogram', file: 'a', items: ['b'] });
    expect(out.layout.margin?.t).toBeGreaterThanOrEqual(textEnd(out) + 58);
  });

  it('a figure with neither title nor caption keeps its margin', () => {
    const out = exportFigure({ data: [], layout: { margin: { t: 20 } } });
    expect(out.layout.margin?.t).toBe(20);
  });
});

describe('lines that coincide are said in the image', () => {
  it('prints the note as a wrapped line of its own after the values', () => {
    const note = `2 lines coincide: ${'+45 · 2°T = -45 · 2°T; '.repeat(8)}end.`;
    const lines = exportCaptionLines({ file: 'f', items: ['a'], coincide: note, simulated: 'Simulated: x' });
    expect(lines[0]).toBe('f');
    expect(lines[1]).toBe('a');
    expect(lines[lines.length - 1]).toBe('Simulated: x');
    expect(lines.slice(2, -1).join(' ')).toBe(note);
    expect(lines.every((l) => l.length <= 110)).toBe(true);
  });

  it('withCoinciding adds it to a caption and leaves a caption alone without one', () => {
    expect(withCoinciding({ items: ['a'] }, '2 lines coincide: A = B.')).toEqual({ items: ['a'], coincide: '2 lines coincide: A = B.' });
    expect(withCoinciding({ items: ['a'] }, null)).toEqual({ items: ['a'] });
    expect(withCoinciding(undefined, null)).toBeUndefined();
  });
});

describe('the foot line of an exported image', () => {
  type Note = { text: string; xref?: string; yref?: string; x?: number; y?: number; xanchor?: string; yanchor?: string; yshift?: number; showarrow?: boolean; font?: { size?: number; color?: string } };
  const notes = (f: Figure) => (f.layout.annotations ?? []) as unknown as Note[];
  const FOOT = 'Beamwidth level 3 dB · Sector edge ±60° · F/B window ±30° · 2026-10-13 · Lobe-Story';

  it('is one small line under the plot area, at the foot of the image', () => {
    const out = exportFigure(figure(2), undefined, 'light', FOOT);
    const foot = notes(out).filter((a) => a.text === FOOT);
    expect(foot).toHaveLength(1);
    expect(foot[0]).toMatchObject({ xref: 'paper', yref: 'paper', x: 0, y: 0, xanchor: 'left', yanchor: 'bottom', showarrow: false });
    expect(foot[0].font?.size).toBeLessThanOrEqual(11);
    // From the plot area's lower edge down to a few px above the image's.
    const b = out.layout.margin?.b ?? 0;
    expect(foot[0].yshift).toBeLessThan(0);
    expect(b + (foot[0].yshift ?? 0)).toBeGreaterThanOrEqual(2);
    expect(b + (foot[0].yshift ?? 0)).toBeLessThanOrEqual(8);
  });

  it('gets room of its own under what the figure draws below the plot area', () => {
    const without = exportFigure(figure(2));
    const withFoot = exportFigure(figure(2), undefined, 'light', FOOT);
    expect((withFoot.layout.margin?.b ?? 0) - (without.layout.margin?.b ?? 0)).toBeGreaterThanOrEqual(FOOT_ROOM_PX);
    // 72 legend rows make the image higher than the least height: the foot's room is added to it.
    expect((exportFigure(figure(72), undefined, 'light', FOOT).layout.height ?? 0) - (exportFigure(figure(72)).layout.height ?? 0)).toBeGreaterThanOrEqual(FOOT_ROOM_PX);
  });

  it('an x axis that makes its own room for labels and title keeps it: the margin is never less than they need', () => {
    const f: Figure = { data: [], layout: { margin: { b: 40 }, xaxis: { automargin: true, title: { text: 'Angle (°)' } } } };
    const out = exportFigure(f, undefined, 'light', FOOT);
    expect(out.layout.margin?.b).toBeGreaterThanOrEqual(60 + FOOT_ROOM_PX);
  });

  it('keeps the labels the figure has (the histogram’s line names), and is drawn in the light theme’s colours', () => {
    const hist: Figure = { data: [], layout: { font: { color: FIGURE_THEMES.dark.fg }, annotations: [{ text: 'mean', font: { color: FIGURE_THEMES.dark.fg } }] } };
    const out = exportFigure(hist, { title: 't', items: [] }, 'dark', FOOT);
    expect(notes(out).map((a) => a.text)).toEqual(['mean', FOOT]);
    expect(JSON.stringify(out).toLowerCase()).not.toContain(FIGURE_THEMES.dark.fg.toLowerCase());
  });

  it('without a foot line nothing is added', () => {
    const out = exportFigure(figure(2));
    expect(out.layout.annotations).toBeUndefined();
    expect(out.layout.margin?.b).toBe(40);
  });
});
