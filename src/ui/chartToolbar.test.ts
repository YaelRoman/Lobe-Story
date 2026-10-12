import { describe, expect, it } from 'vitest';
import { axesViewReset, CHART_PRIVACY, polarViewReset, toolbarButtons, viewReset, type ChartToolbar } from './chartToolbar';
import { buildHpbwFigure } from './hpbwFigure';
import { buildMetricFigure } from './metricFigure';
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
  it('is the first button of a polar chart when one is given, before the download; the 3D view keeps its camera reset', () => {
    const reset = { name: 'resetViewBuilt' };
    const own = { name: 'toImageLabelled' };
    expect(toolbarButtons('polar', own, reset)).toEqual([[reset], [own]]);
    expect(toolbarButtons('polar', undefined, reset)).toEqual([[reset], ['toImage']]);
    expect(toolbarButtons('3d', own, reset)).toEqual([['tableRotation', 'zoom3d', 'resetCameraDefault3d'], [own]]);
  });

  it('takes the place of the library\'s "Reset axes" on the x/y kinds: that one returns to the first figure a chart drew', () => {
    const reset = { name: 'resetViewBuilt' };
    const own = { name: 'toImageLabelled' };
    expect(toolbarButtons('rect', own, reset)).toEqual([[reset], [own]]);
    expect(toolbarButtons('xy', own, reset)).toEqual([['zoom2d', reset], [own]]);
    expect(toolbarButtons('xy', undefined, reset).flat()).not.toContain('resetScale2d');
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

describe('the reset of an x/y chart', () => {
  const cut = { series: [], mode: 'rect' as const, cut: 'H' as const, theme: FIGURE_THEMES.light, levelDb: 3, fbWindowDeg: 30, sectorEdgeDeg: 60, uslsRangeDeg: 20 };

  it('puts a rectangular cut back to the angles and the floor it was built with', () => {
    expect(axesViewReset(buildCutBase({ ...cut, floorDb: 40 }).layout)).toEqual({ 'xaxis.range': [-180, 180], 'yaxis.range': [-40, 0] });
    expect(axesViewReset(buildCutBase({ ...cut, floorDb: 30 }).layout)).toEqual({ 'xaxis.range': [-180, 180], 'yaxis.range': [-30, 0] });
    // A copy: a drag writes the zoomed range into the layout the library was given.
    const layout = buildCutBase({ ...cut, floorDb: 40 }).layout;
    expect(axesViewReset(layout)['yaxis.range']).not.toBe(layout.yaxis!.range);
  });

  it('gives an axis without a built range its automatic one, and covers every axis of the figure', () => {
    const point = (freq: number, value: number) => ({ freq, value, h: value, v: value / 10 });
    const flat = [{ label: 'a', color: '#123456', points: [point(1800, 60), point(1900, 60.5)] }];
    const wide = [{ label: 'a', color: '#123456', points: [point(1800, 20), point(1900, 90)] }];
    // Flat values come with a range (a minimum span), spread ones leave the axis to the library.
    const metric = buildMetricFigure(flat, FIGURE_THEMES.light, 'F/B', 'dB');
    const range = (metric.layout.yaxis as { range?: number[] }).range;
    expect(range).toHaveLength(2);
    expect(axesViewReset(metric.layout)).toEqual({ 'xaxis.autorange': true, 'yaxis.range': range });
    expect(axesViewReset(buildMetricFigure(wide, FIGURE_THEMES.light, 'F/B', 'dB').layout)).toEqual({ 'xaxis.autorange': true, 'yaxis.autorange': true });
    const beamwidths = axesViewReset(buildHpbwFigure(flat, FIGURE_THEMES.light, 3).layout);
    expect(Object.keys(beamwidths).sort()).toEqual(['xaxis.autorange', 'yaxis.range', 'yaxis2.range']);
    // A figure that names no axis at all still has the first two.
    expect(axesViewReset({})).toEqual({ 'xaxis.autorange': true, 'yaxis.autorange': true });
  });

  it('is chosen by the kind of chart; the 3D view has none of ours', () => {
    const polar = buildCutBase({ ...cut, mode: 'polar', floorDb: 40 }).layout;
    expect(viewReset('polar', polar)).toEqual(polarViewReset(polar));
    expect(viewReset('rect', buildCutBase({ ...cut, floorDb: 40 }).layout)).toEqual({ 'xaxis.range': [-180, 180], 'yaxis.range': [-40, 0] });
    expect(viewReset('xy', {})).toEqual({ 'xaxis.autorange': true, 'yaxis.autorange': true });
    expect(viewReset('3d', { scene: {} })).toBeNull();
  });
});

describe('CHART_PRIVACY', () => {
  it('turns off the cloud upload button, its destination and the logo link', () => {
    expect(CHART_PRIVACY).toEqual({ showSendToCloud: false, plotlyServerURL: '', displaylogo: false });
  });
});
