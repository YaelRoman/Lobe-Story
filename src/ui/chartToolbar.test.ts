import { describe, expect, it } from 'vitest';
import { CHART_PRIVACY, polarViewReset, toolbarButtons, type ChartToolbar } from './chartToolbar';
import { buildCutBase } from './cutFigure';
import { FIGURE_THEMES } from './figureTheme';

const KINDS: ChartToolbar[] = ['polar', 'rect', 'xy', '3d'];

describe('toolbarButtons', () => {
  it('is an explicit list per kind of chart, the download last', () => {
    expect(toolbarButtons('polar')).toEqual([['toImage']]);
    expect(toolbarButtons('rect')).toEqual([['resetScale2d'], ['toImage']]);
    expect(toolbarButtons('xy')).toEqual([['zoom2d', 'resetScale2d'], ['toImage']]);
    expect(toolbarButtons('3d')).toEqual([['tableRotation', 'zoom3d', 'resetCameraDefault3d'], ['toImage']]);
  });

  it('never offers an upload, a select tool or more than four buttons', () => {
    for (const kind of KINDS) {
      const names = toolbarButtons(kind).flat();
      expect(names.length).toBeLessThanOrEqual(4);
      for (const name of names) expect(name).not.toMatch(/cloud|send|edit|select|lasso|link/i);
    }
  });

  it('puts another download button in the place of the stock one', () => {
    const own = { name: 'toImageLabelled' };
    expect(toolbarButtons('xy', own)).toEqual([['zoom2d', 'resetScale2d'], [own]]);
    expect(toolbarButtons('polar', own)).toEqual([[own]]);
  });
});

describe('the polar cut\'s "Reset view"', () => {
  it('is the first button of a polar chart when one is given, before the download; other charts have their own reset', () => {
    const reset = { name: 'resetViewPolar' };
    const own = { name: 'toImageLabelled' };
    expect(toolbarButtons('polar', own, reset)).toEqual([[reset], [own]]);
    expect(toolbarButtons('polar', undefined, reset)).toEqual([[reset], ['toImage']]);
    expect(toolbarButtons('rect', own, reset)).toEqual([['resetScale2d'], [own]]);
    expect(toolbarButtons('3d', own, reset)).toEqual([['tableRotation', 'zoom3d', 'resetCameraDefault3d'], [own]]);
  });

  it('puts back what a drag can change: the level range, the angle of the level axis and the rotation', () => {
    const options = { series: [], mode: 'polar' as const, floorDb: 40, theme: FIGURE_THEMES.light, levelDb: 3, fbWindowDeg: 30, sectorEdgeDeg: 60, uslsRangeDeg: 20 };
    expect(polarViewReset(buildCutBase({ ...options, cut: 'H' }).layout)).toEqual({ 'polar.radialaxis.range': [-40, 0], 'polar.radialaxis.angle': 270, 'polar.angularaxis.rotation': 90 });
    expect(polarViewReset(buildCutBase({ ...options, cut: 'V', floorDb: 30 }).layout)).toEqual({ 'polar.radialaxis.range': [-30, 0], 'polar.radialaxis.angle': 270, 'polar.angularaxis.rotation': 0 });
    // A copy: the library may keep and change what it is given.
    const layout = buildCutBase({ ...options, cut: 'H' }).layout;
    expect(polarViewReset(layout)!['polar.radialaxis.range']).not.toBe(layout.polar!.radialaxis!.range);
  });

  it('is nothing for a figure that is not polar', () => {
    const options = { series: [], mode: 'rect' as const, cut: 'H' as const, floorDb: 40, theme: FIGURE_THEMES.light, levelDb: 3, fbWindowDeg: 30, sectorEdgeDeg: 60, uslsRangeDeg: 20 };
    expect(polarViewReset(buildCutBase(options).layout)).toBeNull();
    expect(polarViewReset({})).toBeNull();
  });
});

describe('CHART_PRIVACY', () => {
  it('turns off the cloud upload button, its destination and the logo link', () => {
    expect(CHART_PRIVACY).toEqual({ showSendToCloud: false, plotlyServerURL: '', displaylogo: false });
  });
});
