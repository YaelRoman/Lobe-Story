import { describe, expect, it } from 'vitest';
import { previewRestyle } from './hoverPreview';
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
