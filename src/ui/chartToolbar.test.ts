import { describe, expect, it, vi } from 'vitest';
import { axesViewReset, CHART_PRIVACY, guardedReset, polarViewReset, leaveTouchesToThePage, toolbarButtons, touchScrolls, viewReset, type ChartToolbar } from './chartToolbar';
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

describe('a touch screen (coarse pointer): a finger on a plot scrolls the page (R4-09)', () => {
  it('leaves a touch on the plots with axes and on the polar plot to the browser, and the 3D view its turning', () => {
    expect(touchScrolls('rect', true)).toBe(true);
    expect(touchScrolls('xy', true)).toBe(true);
    expect(touchScrolls('polar', true)).toBe(true);
    expect(touchScrolls('3d', true)).toBe(false);
  });

  it('changes nothing for a mouse', () => {
    for (const kind of KINDS) expect(touchScrolls(kind, false)).toBe(false);
    for (const kind of KINDS) expect(toolbarButtons(kind, undefined, undefined, false)).toEqual(toolbarButtons(kind));
  });

  describe('leaveTouchesToThePage', () => {
    type Listener = (event: { timeStamp: number; stopPropagation: () => void }) => void;
    const fakeElement = () => {
      const listeners: { type: string; fn: Listener; options: { capture?: boolean; passive?: boolean } }[] = [];
      const el = {
        addEventListener: (type: string, fn: Listener, options: { capture?: boolean; passive?: boolean }) => listeners.push({ type, fn, options }),
        removeEventListener: (type: string, fn: Listener) => {
          const at = listeners.findIndex((l) => l.type === type && l.fn === fn);
          if (at >= 0) listeners.splice(at, 1);
        },
      } as unknown as HTMLElement;
      /** Sends an event of `type` at time `timeStamp`; true when it was stopped before reaching the library. */
      const send = (type: string, timeStamp: number): boolean => {
        let stopped = false;
        for (const l of listeners.filter((x) => x.type === type)) l.fn({ timeStamp, stopPropagation: () => (stopped = true) });
        return stopped;
      };
      return { el, listeners, send };
    };

    it('a touch that starts in the chart does not reach the library; the listener is ahead of it and cannot stop the scroll', () => {
      const { el, listeners, send } = fakeElement();
      leaveTouchesToThePage(el);
      // Before the library's listeners (capture), and unable to stop the browser's scroll (passive).
      expect(listeners.find((l) => l.type === 'touchstart')?.options).toEqual({ capture: true, passive: true });
      expect(send('touchstart', 100)).toBe(true);
      expect(send('touchend', 180)).toBe(false);
    });

    it('the pointer "leaving" right after a tap is kept from the library, so the reading stays; a mouse that leaves later is not', () => {
      const { el, send } = fakeElement();
      leaveTouchesToThePage(el);
      // No touch yet: a mouse leaving the plot clears the reading as always.
      expect(send('mouseout', 50)).toBe(false);
      send('touchstart', 1000);
      send('touchend', 1080);
      expect(send('mouseout', 1100)).toBe(true);
      expect(send('mouseout', 1080 + 699)).toBe(true);
      expect(send('mouseout', 1080 + 700)).toBe(false);
      expect(send('mouseout', 5000)).toBe(false);
    });

    it('can be undone: no listener is left', () => {
      const { el, listeners } = fakeElement();
      const undo = leaveTouchesToThePage(el);
      expect(listeners.length).toBeGreaterThan(0);
      undo();
      expect(listeners).toHaveLength(0);
    });
  });

  it('zooming is by buttons on the charts with axes: Zoom in and Zoom out, and no drag-zoom tool', () => {
    expect(toolbarButtons('rect', undefined, undefined, true)).toEqual([['zoomIn2d', 'zoomOut2d', 'resetScale2d'], ['toImage']]);
    expect(toolbarButtons('xy', undefined, undefined, true)).toEqual([['zoomIn2d', 'zoomOut2d', 'resetScale2d'], ['toImage']]);
    expect(toolbarButtons('polar', undefined, undefined, true)).toEqual(toolbarButtons('polar'));
    expect(toolbarButtons('3d', undefined, undefined, true)).toEqual(toolbarButtons('3d'));
    for (const kind of KINDS) expect(toolbarButtons(kind, undefined, undefined, true).flat().length).toBeLessThanOrEqual(4);
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

describe('guardedReset', () => {
  it('gives a throw at once to onThrow, and a rejection to onReject', async () => {
    const onThrow = vi.fn();
    const onReject = vi.fn();
    const boom = new Error('boom');
    guardedReset(() => {
      throw boom;
    }, onThrow, onReject);
    expect(onThrow).toHaveBeenCalledWith(boom);
    guardedReset(() => Promise.reject(boom), onThrow, onReject);
    await Promise.resolve();
    await Promise.resolve();
    expect(onReject).toHaveBeenCalledWith(boom);
    expect(onThrow).toHaveBeenCalledTimes(1);
  });

  it('calls neither when the relayout works', async () => {
    const onThrow = vi.fn();
    const onReject = vi.fn();
    guardedReset(() => Promise.resolve(), onThrow, onReject);
    await Promise.resolve();
    expect(onThrow).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });
});
