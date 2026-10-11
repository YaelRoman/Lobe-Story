import { describe, expect, it } from 'vitest';
import { focusPreviews, hoverPreviews, ownTraces, previewRestyle, restyleDiff } from './hoverPreview';
import { exportFigure } from './exportFigure';
import type { Figure } from './figureTheme';
import { buildCutFigure, DIMMED_OPACITY, type PlotSeries } from './cutFigure';
import { FIGURE_THEMES } from './figureTheme';
import { analyzePattern } from '../core/analysis/metrics';
import { patternFrom, quadBeam, vBeamWithLobes } from '../test/synthetic';

const traces = (...ids: string[]): { uid?: string }[] => [...ids.map((uid) => ({ uid })), {}];

describe('previewRestyle', () => {
  it('is null when the plot has no file traces', () => {
    expect(previewRestyle([{}], 'a', null)).toBeNull();
  });

  it('with nothing hovered it gives the figure its own look: the highlighted trace thick, the others dimmed', () => {
    const r = previewRestyle(traces('a', 'b', 'c'), null, 'b')!;
    expect(r.indices).toEqual([0, 1, 2]);
    expect(r.update['line.width']).toEqual([1.5, 2.5, 1.5]);
    expect(r.update.opacity).toEqual([DIMMED_OPACITY, null, DIMMED_OPACITY]);
  });

  it('with nothing hovered and nothing highlighted nothing is thick or dimmed', () => {
    const r = previewRestyle(traces('a', 'b'), null, null)!;
    expect(r.update['line.width']).toEqual([1.5, 1.5]);
    expect(r.update.opacity).toEqual([null, null]);
  });

  it('a hovered file wins over the highlighted one', () => {
    const r = previewRestyle(traces('a', 'b', 'c'), 'c', 'b')!;
    expect(r.update['line.width']).toEqual([1.5, 1.5, 2.5]);
    expect(r.update.opacity).toEqual([DIMMED_OPACITY, DIMMED_OPACITY, null]);
  });

  it('a hovered file that is not drawn leaves the highlight emphasis alone', () => {
    expect(previewRestyle(traces('a', 'b'), 'zzz', 'a')).toEqual(previewRestyle(traces('a', 'b'), null, 'a'));
  });

  it('a highlighted file that is not drawn emphasises nothing, as the figure builder does', () => {
    expect(previewRestyle(traces('a', 'b'), null, 'zzz')).toEqual(previewRestyle(traces('a', 'b'), null, null));
  });

  it('the dashed original of the emphasised file stays bright but keeps the thin line', () => {
    const r = previewRestyle(traces('a', 'b', 'a#original', 'b#original'), 'b', null)!;
    expect(r.update['line.width']).toEqual([1.5, 2.5, 1.5, 1.5]);
    expect(r.update.opacity).toEqual([DIMMED_OPACITY, null, DIMMED_OPACITY, null]);
  });

  it('restores exactly what the figure builder draws for the highlighted file', () => {
    const series: PlotSeries[] = ['a', 'b', 'c'].map((id, i) => {
      const p = patternFrom(quadBeam(60), vBeamWithLobes, { id, frequencyMHz: 1700 + i });
      return { id, label: id, color: '#123456', cut: p.horizontal, metrics: analyzePattern({ pattern: p, tags: {} }), ...(i === 2 ? { dash: true } : {}) };
    });
    const opts = { cut: 'H' as const, mode: 'rect' as const, floorDb: 40, markers: { hpbw: false, fb: false, usls: false, null: false, peak: false, sector: false }, theme: FIGURE_THEMES.light, levelDb: 3, fbWindowDeg: 30, sectorEdgeDeg: 60, uslsRangeDeg: 30, series };
    const fig = buildCutFigure({ ...opts, markerTarget: 'b' });
    const r = previewRestyle(fig.data as { uid?: unknown }[], null, 'b')!;
    const drawn = fig.data.filter((t) => typeof (t as { uid?: unknown }).uid === 'string') as unknown as { line: { width: number }; opacity?: number }[];
    expect(r.update['line.width']).toEqual(drawn.map((t) => t.line.width));
    expect(r.update.opacity).toEqual(drawn.map((t) => t.opacity ?? null));
  });
});

describe('restyleDiff', () => {
  const at = (hovered: string | null, base: string | null = null) => previewRestyle(traces('a', 'b', 'c', 'd'), hovered, base);

  it('sends everything when nothing was applied yet', () => {
    expect(restyleDiff(null, at('b'))).toEqual(at('b'));
  });

  it('moving from one row to the next changes two traces only', () => {
    const r = restyleDiff(at('b'), at('c'))!;
    expect(r.indices).toEqual([1, 2]);
    expect(r.update['line.width']).toEqual([1.5, 2.5]);
    expect(r.update.opacity).toEqual([DIMMED_OPACITY, null]);
  });

  it('entering a row from no preview dims all the others (every trace changes), leaving it changes them back', () => {
    expect(restyleDiff(at(null), at('b'))!.indices).toEqual([0, 1, 2, 3]);
    expect(restyleDiff(at('b'), at(null))!.indices).toEqual([0, 1, 2, 3]);
  });

  it('leaving a row restores the highlight emphasis by changing only the traces that differ', () => {
    const r = restyleDiff(at('c', 'a'), at(null, 'a'))!;
    expect(r.indices).toEqual([0, 2]);
  });

  it('is null when nothing changes (same row again, or a hovered file that is not drawn)', () => {
    expect(restyleDiff(at('b'), at('b'))).toBeNull();
    expect(restyleDiff(at(null, 'a'), at('zzz', 'a'))).toBeNull();
  });

  it('resends everything when the traces changed under it (different indices)', () => {
    const other = previewRestyle(traces('a', 'b', 'c'), 'b', null);
    expect(restyleDiff(at('b'), other)).toEqual(other);
  });
});

describe('ownTraces (what the export is built from)', () => {
  it('a restyle of the drawn traces leaves the figure builder output, and so the export, untouched', () => {
    const figure = { data: [{ uid: 'a', meta: 'A', line: { width: 1.5 } }, { uid: 'b', meta: 'B', line: { width: 1.5 } }, { x: [1] }], layout: {} } as unknown as Figure;
    const pristine = JSON.stringify(exportFigure(figure));
    const drawn = ownTraces(figure.data as unknown as { uid?: string; line?: { width: number }; opacity?: number }[]);
    // What Plotly.restyle does to the objects it was handed: it sets them in place.
    drawn[0].line!.width = 2.5;
    drawn[1].opacity = DIMMED_OPACITY;
    expect(JSON.stringify(figure)).toBe(JSON.stringify({ data: [{ uid: 'a', meta: 'A', line: { width: 1.5 } }, { uid: 'b', meta: 'B', line: { width: 1.5 } }, { x: [1] }], layout: {} }));
    expect(JSON.stringify(exportFigure(figure))).toBe(pristine);
  });
});

describe('which input previews', () => {
  it('only a mouse pointer previews on hover, not touch or pen', () => {
    expect(hoverPreviews({ pointerType: 'mouse' })).toBe(true);
    expect(hoverPreviews({ pointerType: 'touch' })).toBe(false);
    expect(hoverPreviews({ pointerType: 'pen' })).toBe(false);
  });

  it('only a focus the browser marks as keyboard focus previews', () => {
    expect(focusPreviews({ matches: (q: string) => q === ':focus-visible' } as unknown as Element)).toBe(true);
    expect(focusPreviews({ matches: () => false } as unknown as Element)).toBe(false);
    expect(focusPreviews({ matches: () => { throw new SyntaxError('unsupported'); } } as unknown as Element)).toBe(true);
  });
});
