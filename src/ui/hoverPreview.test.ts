import { describe, expect, it } from 'vitest';
import { appliedAfterRedraw, createRedrawGate, focusPreviews, hoverPreviews, ownTraces, previewRestyle, restyleDiff } from './hoverPreview';
import { exportFigure } from './exportFigure';
import type { Figure } from './figureTheme';
import { buildCutBase, buildCutFigure, DIMMED_OPACITY, type PlotSeries } from './cutFigure';
import { FIGURE_THEMES } from './figureTheme';
import { traceUid } from './traceUid';
import { analyzePattern } from '../core/analysis/metrics';
import { patternFrom, quadBeam, vBeamWithLobes } from '../test/synthetic';

/** File traces as the figure builder marks them ("r#reference": the reference file r), then a trace that is not a file's. */
const traces = (...ids: string[]): { uid?: string }[] => [
  ...ids.map((id) => ({ uid: id.endsWith('#reference') ? traceUid(id.slice(0, -'#reference'.length), true) : traceUid(id) })),
  {},
];

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

describe('ownTraces with a look (how a highlight reaches a newly drawn figure)', () => {
  it('hands the traces over already in that look, so a new figure is not drawn plain first and restyled after', () => {
    const data = [{ uid: traceUid('a'), line: { width: 1.5, color: '#111' } }, { uid: traceUid('b'), line: { width: 1.5 } }, { x: [1] }];
    const drawn = ownTraces(data as { uid?: string; x?: number[]; line?: { width: number; color?: string }; opacity?: number }[], previewRestyle(data, null, 'b'));
    expect(drawn.map((t) => [t.line?.width, t.opacity])).toEqual([[1.5, DIMMED_OPACITY], [2.5, undefined], [undefined, undefined]]);
    expect(drawn[0].line?.color).toBe('#111');
    // The builder's own traces stay as built.
    expect(data.map((t) => [t.line?.width, 'opacity' in t])).toEqual([[1.5, false], [1.5, false], [undefined, false]]);
  });

  it('an opacity of null in the look is the default: no opacity key is left on the trace', () => {
    const data = [{ uid: traceUid('a'), opacity: 0.35, line: { width: 2.5 } }];
    const [t] = ownTraces(data, previewRestyle(data, null, null));
    expect('opacity' in t).toBe(false);
    expect(t.line.width).toBe(1.5);
  });

  it('the figure without a highlight plus the highlight restyle looks as the complete figure does, trace by trace', () => {
    const pattern = patternFrom(quadBeam(60), vBeamWithLobes, { id: 'a' });
    const metrics = analyzePattern({ pattern, tags: {} });
    const one = (id: string, extra: Partial<PlotSeries> = {}): PlotSeries => ({ id, label: id, color: '#123456', cut: pattern.horizontal, metrics, ...extra });
    const series = [one('a'), one('b'), one('c'), one('r', { reference: true }), one('b#original', { dash: true })];
    const options = { series, cut: 'H' as const, floorDb: 40, theme: FIGURE_THEMES.light, levelDb: 3, fbWindowDeg: 30, sectorEdgeDeg: 60, uslsRangeDeg: 20 };
    const markers = { hpbw: true, fb: true, usls: true, null: true, peak: true, sector: true };
    const byUid = (ts: unknown[]) => [...(ts as { uid?: string }[])].filter((t) => typeof t.uid === 'string').sort((p, q) => (p.uid! < q.uid! ? -1 : 1));
    for (const mode of ['polar', 'rect'] as const) {
      for (const target of ['b', 'r', null]) {
        const base = buildCutBase({ ...options, mode });
        const complete = buildCutFigure({ ...options, mode, markers, markerTarget: target });
        expect(byUid(ownTraces(base.data, previewRestyle(base.data as { uid?: unknown }[], null, target)))).toEqual(byUid(complete.data));
      }
    }
  });
});

describe('which input previews', () => {
  it('a mouse or a pen previews on hover, touch does not', () => {
    expect(hoverPreviews({ pointerType: 'mouse' })).toBe(true);
    expect(hoverPreviews({ pointerType: 'pen' })).toBe(true);
    expect(hoverPreviews({ pointerType: 'touch' })).toBe(false);
  });

  it('only a focus the browser marks as keyboard focus previews', () => {
    expect(focusPreviews({ matches: (q: string) => q === ':focus-visible' } as unknown as Element)).toBe(true);
    expect(focusPreviews({ matches: () => false } as unknown as Element)).toBe(false);
    expect(focusPreviews({ matches: () => { throw new SyntaxError('unsupported'); } } as unknown as Element)).toBe(true);
  });
});

describe('the reference trace in a preview', () => {
  it('keeps its width and brightness when another file is previewed, and previews as its own file', () => {
    const data = traces('a', 'r#reference', 'b');
    const other = previewRestyle(data, 'b', 'a')!;
    expect(other.update['line.width']).toEqual([1.5, 3.5, 2.5]);
    expect(other.update.opacity).toEqual([DIMMED_OPACITY, null, null]);
    // The reference file highlighted (its trace is the reference one): the others dim around it, as the figure builder drew them.
    const own = previewRestyle(data, null, 'r')!;
    expect(own.update['line.width']).toEqual([1.5, 3.5, 1.5]);
    expect(own.update.opacity).toEqual([DIMMED_OPACITY, null, DIMMED_OPACITY]);
    expect(previewRestyle(data, 'r', 'a')!.update.opacity).toEqual([DIMMED_OPACITY, null, DIMMED_OPACITY]);
  });
});

describe('appliedAfterRedraw', () => {
  it('is the figure\'s own look, or unknown when a restyle was sent during the redraw', () => {
    const own = previewRestyle(traces('a', 'b'), null, 'a');
    expect(appliedAfterRedraw(own, false)).toBe(own);
    // The target ended while the redraw was pending: the drawn traces may still carry it, so the next diff must be complete.
    const stale = appliedAfterRedraw(own, true);
    expect(stale).toBeNull();
    expect(restyleDiff(stale, previewRestyle(traces('a', 'b'), null, 'a'))).toEqual(own);
  });
});

describe('createRedrawGate', () => {
  it('lets only the latest redraw settle, however the redraws overlap', () => {
    const gate = createRedrawGate();
    const first = gate.start();
    expect(gate.isLatest(first)).toBe(true);
    const second = gate.start();
    expect(gate.isLatest(first)).toBe(false);
    expect(gate.isLatest(second)).toBe(true);
    // A third redraw supersedes the second as well, and a late finish of an older one never becomes the latest again.
    const third = gate.start();
    expect([first, second, third].map(gate.isLatest)).toEqual([false, false, true]);
    expect(new Set([first, second, third]).size).toBe(3);
  });
  it('keeps the gates of two plots apart', () => {
    const a = createRedrawGate();
    const b = createRedrawGate();
    const n = a.start();
    b.start();
    b.start();
    expect(a.isLatest(n)).toBe(true);
  });
});
