import { describe, expect, it } from 'vitest';
import {
  buildMethodCompareFigure,
  compareAriaLabel,
  compareExportCaption,
  compareHeightPx,
  differenceText,
  methodDifference,
  stacksMethods,
  sideBySideHeight,
  COMPARED_METHODS,
} from './methodCompare';
import { linkedCameraUpdate } from './surfaceFigure';
import { FIGURE_THEMES } from './figureTheme';
import { exportFigure, exportCaptionLines } from './exportFigure';
import { reconstruct3d, type Surface3d } from '../core/analysis/pattern3d';
import { gridFrom, quadBeam } from '../test/synthetic';

const h = gridFrom(quadBeam(65));
const v = gridFrom(quadBeam(10));
const surfaces = { summation: reconstruct3d(h, v, 'summation'), weighted: reconstruct3d(h, v, 'weighted') };
const build = (over: Partial<Parameters<typeof buildMethodCompareFigure>[0]> = {}) =>
  buildMethodCompareFigure({ surfaces, selected: 'summation', floorDb: 40, theme: FIGURE_THEMES.light, ...over });
const traces = (f: { data: unknown[] }) => f.data as Record<string, unknown>[];
type Scene = { domain: { x: number[]; y: number[] }; camera: unknown; xaxis: { range: number[] } };

describe('buildMethodCompareFigure', () => {
  it('draws Summation and Weighted, in that order, each in a scene of its own', () => {
    const f = build();
    expect(COMPARED_METHODS).toEqual(['summation', 'weighted']);
    expect(traces(f).map((t) => [t.type, t.scene, t.name])).toEqual([
      ['surface', 'scene', 'Summation'],
      ['surface', 'scene2', 'Weighted'],
    ]);
  });

  it('gives both panels one colour scale: the same range and colours, one colour bar', () => {
    const t = traces(build({ floorDb: 30 }));
    for (const s of t) {
      expect(s.cmin).toBe(-30);
      expect(s.cmax).toBe(0);
      expect(s.colorscale).toBe('Viridis');
    }
    expect(t.map((s) => s.showscale)).toEqual([true, false]);
  });

  it('gives both panels the same camera and axes, and links them: turning one turns the other', () => {
    const l = build().layout as Record<string, Scene>;
    expect(l.scene.camera).toEqual(l.scene2.camera);
    expect(l.scene.xaxis.range).toEqual(l.scene2.xaxis.range);
    const camera = { eye: { x: 0.2, y: 2, z: 0.5 } };
    // As the page links them: the turned panel's own camera is written too (see `linkedCameraUpdate`).
    expect(linkedCameraUpdate({ 'scene2.camera': camera }, 2, true)).toEqual({ 'scene2.camera': camera, 'scene.camera': camera });
    expect(linkedCameraUpdate({ 'scene.camera': camera }, 2, true)).toEqual({ 'scene.camera': camera, 'scene2.camera': camera });
  });

  it('keeps the camera the user turned to across redraws', () => {
    expect(build().layout.uirevision).toBe('keep');
  });

  it('labels each panel with its method and says which one the numbers use', () => {
    const text = (f: ReturnType<typeof build>) => (f.layout.annotations as { text: string }[]).map((a) => a.text);
    expect(text(build())).toEqual(['<b>Summation</b> · used for the numbers', '<b>Weighted</b>']);
    expect(text(build({ selected: 'weighted' }))).toEqual(['<b>Summation</b>', '<b>Weighted</b> · used for the numbers']);
  });

  it('draws each method’s own surface', () => {
    const [sum, wtd] = traces(build());
    expect(sum.surfacecolor).not.toEqual(wtd.surfacecolor);
    const level = (s: Surface3d) => s.atten.map((row) => row.map((a) => Math.max(-a, -40)));
    expect(sum.surfacecolor).toEqual(level(surfaces.summation));
    expect(wtd.surfacecolor).toEqual(level(surfaces.weighted));
  });

  it('puts the panels side by side on a desktop and stacks them on a phone', () => {
    const scenes = (w?: number) => {
      const l = build({ viewportWidth: w }).layout as Record<string, Scene>;
      return [l.scene.domain, l.scene2.domain];
    };
    for (const w of [undefined, 1400, 800]) {
      const [a, b] = scenes(w);
      expect(a.x[1]).toBeLessThanOrEqual(b.x[0]);
      expect(a.y).toEqual(b.y);
    }
    for (const w of [390, 600]) {
      const [a, b] = scenes(w);
      expect(a.x).toEqual([0, 1]);
      expect(b.x).toEqual([0, 1]);
      expect(a.y[0]).toBeGreaterThanOrEqual(b.y[1]);
    }
    expect(stacksMethods(undefined)).toBe(false);
    expect(stacksMethods(800)).toBe(false);
    expect(stacksMethods(600)).toBe(true);
    // A phone's colour bar lies under the scenes.
    expect((traces(build({ viewportWidth: 390 }))[0].colorbar as { orientation?: string }).orientation).toBe('h');
  });

  it('keeps a side-by-side panel no taller than it is wide, so the box fits a narrow window, and leaves a wide one as the grid has it', () => {
    const height = (w?: number) => {
      const d = (build({ viewportWidth: w }).layout as Record<string, Scene>).scene.domain.y;
      return d[1] - d[0];
    };
    expect(height(1400)).toBeCloseTo(0.79, 9);
    expect(height(undefined)).toBeCloseTo(0.79, 9);
    expect(height(1000)).toBeLessThan(0.6);
    expect(height(1000)).toBeCloseTo(sideBySideHeight(1000), 9);
    // Both panels the same, under their titles.
    const l = build({ viewportWidth: 1000 }).layout as Record<string, Scene>;
    expect(l.scene.domain.y).toEqual(l.scene2.domain.y);
    expect(l.scene.domain.y[1]).toBeCloseTo(0.93, 9);
  });

  it('gives stacked panels a taller plot on a phone, and leaves the style sheet’s height elsewhere', () => {
    expect(compareHeightPx(undefined)).toBeUndefined();
    expect(compareHeightPx(1000)).toBeUndefined();
    expect(compareHeightPx(390)).toBeGreaterThanOrEqual(600);
  });

  it('exports both panels with their labels, and no legend (one file)', () => {
    const out = exportFigure(build(), compareExportCaption('2140 MHz · file', 'summation', 40, { maxDb: 3, meanDb: 1 }));
    expect(traces(out).map((t) => t.scene)).toEqual(['scene', 'scene2']);
    expect(out.layout.showlegend).toBe(false);
    expect(JSON.stringify(out.layout.annotations)).toContain('Summation');
    expect(JSON.stringify(out.layout.annotations)).toContain('Weighted');
  });
});

describe('methodDifference', () => {
  it('is zero for a surface against itself', () => {
    expect(methodDifference(surfaces.summation, surfaces.summation, 40)).toEqual({ maxDb: 0, meanDb: 0 });
  });

  it('gives the largest and the solid-angle mean difference, with levels below the floor taken as the floor', () => {
    const flat = (level: number): Surface3d => ({ az: [0, 90], el: [-90, 0, 90], atten: [0, 1, 2].map(() => [level, level]) });
    // 3 dB everywhere: max and mean 3.
    expect(methodDifference(flat(0), flat(3), 40)).toEqual({ maxDb: 3, meanDb: 3 });
    // Both below a 40 dB floor: no difference.
    expect(methodDifference(flat(45), flat(60), 40)).toEqual({ maxDb: 0, meanDb: 0 });
    // One row differs: the poles weigh nothing (cos 90° = 0), so a difference there leaves the mean at 0.
    const poles: Surface3d = { az: [0, 90], el: [-90, 0, 90], atten: [[10, 10], [0, 0], [10, 10]] };
    const d = methodDifference(flat(0), poles, 40);
    expect(d.maxDb).toBe(10);
    expect(d.meanDb).toBeCloseTo(0, 9);
  });

  it('counts the ±180° meridian once', () => {
    const level = (back: number): Surface3d => ({ az: [-180, 0, 180], el: [0], atten: [[back, 0, 0]] });
    // The −180° column differs and the 180° one (the same direction) does not: it weighs as one of two columns.
    expect(methodDifference(level(0), level(4), 40)).toEqual({ maxDb: 4, meanDb: 2 });
  });

  it('finds the two methods apart on a real reconstruction', () => {
    const d = methodDifference(surfaces.summation, surfaces.weighted, 40);
    expect(d.maxDb).toBeGreaterThan(1);
    expect(d.meanDb).toBeGreaterThan(0);
    expect(d.meanDb).toBeLessThan(d.maxDb);
  });

  it('refuses surfaces on different grids', () => {
    expect(() => methodDifference(surfaces.summation, { az: [0], el: [0], atten: [[0]] }, 40)).toThrow();
  });
});

describe('texts', () => {
  it('says how far apart the methods are, in dB with one decimal', () => {
    expect(differenceText({ maxDb: 12.345, meanDb: 2.06 }, 40)).toBe('The methods differ by up to 12.3 dB, 2.1 dB on average over the sphere (levels below the −40 dB floor count as the floor).');
  });

  it('names the panels in the order they are drawn, left/right or top/bottom', () => {
    expect(compareAriaLabel('summation', false)).toBe('3D radiation pattern, the two methods compared: Summation on the left (used for the numbers), Weighted on the right');
    expect(compareAriaLabel('weighted', true)).toBe('3D radiation pattern, the two methods compared: Summation on top, Weighted below (used for the numbers)');
  });

  it('captions the exported image with the file, both methods, which one the numbers use and how far apart they are', () => {
    const lines = exportCaptionLines(compareExportCaption('2140 MHz · file', 'weighted', 40, { maxDb: 3, meanDb: 1 })).join('\n');
    expect(lines).toContain('2140 MHz · file');
    expect(lines).toContain('Left: Summation; right: Weighted');
    expect(lines).toContain('The numbers use Weighted');
    expect(lines).toContain('up to 3.0 dB');
    expect(compareExportCaption('x', 'summation', 40, { maxDb: 3, meanDb: 1 }).title).toBe('3D radiation pattern, the two methods compared');
  });
});
