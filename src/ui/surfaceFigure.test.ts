import { describe, expect, it } from 'vitest';
import {
  buildSurfaceFigure,
  gridColumns,
  linkedCameraUpdate,
  MAX_3D,
  MAX_3D_OVERLAY,
  sceneId,
  toCartesian,
  type SurfaceSeries,
} from './surfaceFigure';
import { FIGURE_THEMES } from './figureTheme';
import { reconstruct3d } from '../core/analysis/pattern3d';
import { gridFrom, quadBeam } from '../test/synthetic';

const surface = reconstruct3d(gridFrom(quadBeam(65)), gridFrom(quadBeam(10)), 'summation');
const series = (n: number): SurfaceSeries[] =>
  Array.from({ length: n }, (_, k) => ({ id: `f${k}`, label: `file ${k}`, color: `#00000${k}`, surface }));
const traces = (f: { data: unknown[] }) => f.data as Record<string, unknown>[];

describe('toCartesian', () => {
  const c = toCartesian(surface, 40);
  const row = (el: number) => surface.el.indexOf(el);
  const col = (az: number) => surface.az.indexOf(az);

  it('puts boresight on +x at the full radius', () => {
    expect(c.x[row(0)][col(0)]).toBeCloseTo(40, 9);
    expect(c.y[row(0)][col(0)]).toBeCloseTo(0, 9);
    expect(c.z[row(0)][col(0)]).toBeCloseTo(0, 9);
    expect(c.level[row(0)][col(0)]).toBeCloseTo(0, 9);
  });

  it('puts +90° azimuth on −y and downtilt below the horizon', () => {
    expect(c.y[row(0)][col(90)]).toBeLessThan(0);
    expect(Math.abs(c.x[row(0)][col(90)])).toBeLessThan(1e-9);
    expect(c.z[row(6)][col(0)]).toBeLessThan(0);
    expect(c.text[row(6)][col(30)]).toBe('az 30°, el 6°');
  });

  it('clamps beyond the floor to the origin', () => {
    expect(c.x[row(90)][col(0)]).toBeCloseTo(0, 9);
    expect(c.z[row(90)][col(0)]).toBeCloseTo(0, 9);
    expect(c.level[row(90)][col(0)]).toBe(-40);
  });
});

describe('buildSurfaceFigure', () => {
  const theme = FIGURE_THEMES.light;

  it('lays out one scene per file side by side', () => {
    const f = buildSurfaceFigure({ series: series(3), layout: 'grid', floorDb: 40, theme });
    const t = traces(f);
    expect(t.map((x) => x.scene)).toEqual(['scene', 'scene2', 'scene3']);
    expect(t.map((x) => x.showscale)).toEqual([true, false, false]);
    expect(t.every((x) => x.cmin === -40 && x.cmax === 0)).toBe(true);
    const layout = f.layout as Record<string, { domain?: { x: number[]; y: number[] } }>;
    expect(layout.scene3.domain!.x).toEqual([0, 0.5]);
    expect((f.layout.annotations ?? []).map((a) => a.text)).toEqual(['file 0', 'file 1', 'file 2']);
    expect(f.layout.uirevision).toBe('keep');
  });

  it('overlays all files in one scene', () => {
    const f = buildSurfaceFigure({ series: series(2), layout: 'overlay', floorDb: 40, theme });
    const t = traces(f);
    expect(t.map((x) => x.scene)).toEqual(['scene', 'scene']);
    expect(t.map((x) => x.opacity)).toEqual([0.5, 0.5]);
    expect(t[1].colorscale).toEqual([
      [0, '#000001'],
      [1, '#000001'],
    ]);
    expect(t[0].showlegend).toBe(true);
    expect((f.layout as Record<string, unknown>).scene2).toBeUndefined();
  });

  it(`caps the grid layout at ${MAX_3D} files`, () => {
    expect(buildSurfaceFigure({ series: series(8), layout: 'grid', floorDb: 40, theme }).data).toHaveLength(MAX_3D);
  });

  it(`draws up to ${MAX_3D_OVERLAY} files in the overlay layout, beyond ${MAX_3D}, and no more`, () => {
    expect(buildSurfaceFigure({ series: series(8), layout: 'overlay', floorDb: 40, theme }).data).toHaveLength(8);
    expect(buildSurfaceFigure({ series: series(MAX_3D_OVERLAY + 5), layout: 'overlay', floorDb: 40, theme }).data).toHaveLength(MAX_3D_OVERLAY);
  });
});

describe('grid helpers and camera linking', () => {
  it('chooses grid columns and scene ids', () => {
    expect([1, 2, 4, 5, 6].map(gridColumns)).toEqual([1, 2, 2, 3, 3]);
    expect([0, 1, 5].map(sceneId)).toEqual(['scene', 'scene2', 'scene6']);
  });

  it('copies one scene camera to every other scene', () => {
    const cam = { eye: { x: 1, y: 2, z: 3 } };
    expect(linkedCameraUpdate({ 'scene2.camera': cam }, 3)).toEqual({ 'scene.camera': cam, 'scene3.camera': cam });
    expect(linkedCameraUpdate({ 'xaxis.range': [0, 1] }, 3)).toBeNull();
    expect(linkedCameraUpdate({ 'scene.camera': cam }, 1)).toBeNull();
  });
});
