import { describe, expect, it } from 'vitest';
import {
  buildSurfaceFigure,
  gridColumns,
  gridHeightPx,
  gridPlan,
  viewportClass,
  widthClass,
  linkedCameraUpdate,
  MAX_3D,
  MAX_3D_OVERLAY,
  sceneId,
  toCartesian,
  type SurfaceSeries,
} from './surfaceFigure';
import { FIGURE_THEMES } from './figureTheme';
import { exportFigure } from './exportFigure';
import { surfaceExportCaption } from './viewCaps';
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

  it('gives every surface its file label as `meta`, which the labelled export lists as the legend', () => {
    for (const layout of ['grid', 'overlay'] as const) {
      const f = buildSurfaceFigure({ series: series(3), layout, floorDb: 40, theme });
      expect(traces(f).map((t) => t.meta)).toEqual(['file 0', 'file 1', 'file 2']);
    }
  });

  it('exports with a legend of the drawn files and the cap caption under the title', () => {
    const f = buildSurfaceFigure({ series: series(3), layout: 'overlay', floorDb: 40, theme });
    const out = exportFigure(f, surfaceExportCaption('overlay', 3, 40));
    expect(out.layout.showlegend).toBe(true);
    expect((out.data as unknown as { name: string }[]).map((t) => t.name)).toEqual(['file 0', 'file 1', 'file 2']);
    const title = (out.layout.title as { text: string }).text;
    expect(title).toContain('3D radiation pattern');
    expect(title).toContain('Showing 3 of 40 ticked files');
  });

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

describe('side-by-side layout on a phone and on a desktop', () => {
  const theme = FIGURE_THEMES.light;
  const long = (n: number): SurfaceSeries[] => series(n).map((x, k) => ({ ...x, label: `1710 MHz · ACME_ANT-1_Wideband_Panel_1710_X_CO_P45_0${k}T_Y2.MSI` }));
  type Domain = { x: number[]; y: number[] };
  const scenes = (f: { layout: Record<string, unknown> }, n: number): Domain[] =>
    Array.from({ length: n }, (_, k) => (f.layout[sceneId(k)] as { domain: Domain }).domain);
  const titles = (f: { layout: Record<string, unknown> }) => (f.layout.annotations as { text: string; x: number; y: number }[]);

  it('uses 2 columns on a phone and 1 below 420 px; a desktop keeps 1, 2 or 3', () => {
    expect([2, 4, 6].map((n) => gridPlan(n, 390).columns)).toEqual([1, 1, 1]);
    expect([2, 4, 6].map((n) => gridPlan(n, 600).columns)).toEqual([2, 2, 2]);
    expect(gridPlan(1, 600).columns).toBe(1);
    expect([1, 2, 4, 5, 6].map((n) => gridPlan(n, 1440).columns)).toEqual([1, 2, 2, 3, 3]);
    expect(gridPlan(6, undefined).columns).toBe(3);
  });

  it('shortens the titles to what a scene is wide enough for, keeping the end of the name', () => {
    const narrow = titles(buildSurfaceFigure({ series: long(6), layout: 'grid', floorDb: 40, theme, viewportWidth: 600 }));
    expect(narrow).toHaveLength(6);
    for (const t of narrow) {
      expect(t.text.length).toBeLessThanOrEqual(gridPlan(6, 600).titleMax);
      expect(t.text).toContain('…');
      expect(t.text).toMatch(/_Y2\.MSI$/);
    }
    // A desktop has room for a typical name whole.
    const typical = series(6).map((x) => ({ ...x, label: '1710 MHz · ACME_ANT-1_1710_P45_02T.msi' }));
    const wide = titles(buildSurfaceFigure({ series: typical, layout: 'grid', floorDb: 40, theme, viewportWidth: 1440 }));
    expect(wide[0].text).toBe(typical[0].label);
  });

  it('gives each title its own scene: a gap above the title band, none of the scenes overlap, and titles sit just over their scene', () => {
    for (const vw of [390, 600, 1440]) {
      const f = buildSurfaceFigure({ series: long(6), layout: 'grid', floorDb: 40, theme, viewportWidth: vw });
      const d = scenes(f, 6);
      const t = titles(f);
      d.forEach((a, i) => {
        // The title is above its own scene's top, and below the scene above it.
        expect(t[i].y).toBeGreaterThan(a.y[1]);
        d.forEach((b, j) => {
          if (i === j) return;
          const xOverlap = a.x[0] < b.x[1] - 1e-9 && b.x[0] < a.x[1] - 1e-9;
          const yOverlap = a.y[0] < b.y[1] - 1e-9 && b.y[0] < a.y[1] - 1e-9;
          expect(xOverlap && yOverlap, `${vw}: scene ${i} and ${j}`).toBe(false);
          // A title is never inside another scene's box.
          const inside = t[i].x > b.x[0] && t[i].x < b.x[1] && t[i].y > b.y[0] && t[i].y < b.y[1];
          expect(inside, `${vw}: title ${i} in scene ${j}`).toBe(false);
        });
      });
      // A title is nearer its own scene than the scene above it: the space above the title is larger than the one under it.
      const cols = gridPlan(6, vw).columns;
      for (let k = cols; k < 6; k++) {
        const above = d[k - cols].y[0] - t[k].y;
        const below = t[k].y - d[k].y[1];
        expect(above, `${vw}: title ${k}`).toBeGreaterThan(below);
      }
    }
  });

  it('reduces the window width to a phone class (390, 600) or a desktop (undefined)', () => {
    expect([320, 390, 419].map(widthClass)).toEqual([390, 390, 390]);
    expect([420, 600, 760].map(widthClass)).toEqual([600, 600, 600]);
    expect([761, 1440].map(widthClass)).toEqual([undefined, undefined]);
  });

  it('shortens the titles on a desktop that is narrower than the 1100 px the plot used to be assumed at', () => {
    expect([761, 800, 899].map(viewportClass)).toEqual([800, 800, 800]);
    expect([1024, 1099].map(viewportClass)).toEqual([1000, 1000]);
    expect([1440, 1920].map(viewportClass)).toEqual([1400, 1400]);
    expect(viewportClass(390)).toBe(390);
    expect(gridPlan(6, 1000).titleMax).toBeLessThan(gridPlan(6, 1400).titleMax);
    expect(gridPlan(6, 800).titleMax).toBeLessThan(gridPlan(6, 1000).titleMax);
    for (const vw of [800, 1000]) {
      for (const t of titles(buildSurfaceFigure({ series: long(6), layout: 'grid', floorDb: 40, theme, viewportWidth: vw }))) {
        expect(t.text.length, `${vw}`).toBeLessThanOrEqual(gridPlan(6, vw).titleMax);
        expect(t.text).toMatch(/_Y2\.MSI$/);
      }
    }
  });

  it('puts the colour bar under the scenes on a phone and beside them on a desktop', () => {
    const bar = (vw?: number) => (buildSurfaceFigure({ series: series(3), layout: 'grid', floorDb: 40, theme, viewportWidth: vw }).data[0] as { colorbar: { orientation?: string } }).colorbar;
    expect(bar(390).orientation).toBe('h');
    expect(bar(600).orientation).toBe('h');
    expect(bar(1440).orientation).toBeUndefined();
    expect(buildSurfaceFigure({ series: series(3), layout: 'grid', floorDb: 40, theme, viewportWidth: 390 }).layout.margin?.b).toBeGreaterThan(30);
  });

  it('is taller on a phone, one row of about 300 px per scene row', () => {
    expect(gridHeightPx(6, 390)).toBe(6 * 300);
    expect(gridHeightPx(6, 600)).toBe(3 * 300);
    expect(gridHeightPx(1, 390)).toBe(480);
    expect(gridHeightPx(6, 1440)).toBeUndefined();
    expect(gridHeightPx(6, undefined)).toBeUndefined();
  });
});
