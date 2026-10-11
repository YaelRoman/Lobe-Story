import { describe, expect, it } from 'vitest';
import { CHART_PRIVACY, toolbarButtons, type ChartToolbar } from './chartToolbar';

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

describe('CHART_PRIVACY', () => {
  it('turns off the cloud upload button, its destination and the logo link', () => {
    expect(CHART_PRIVACY).toEqual({ showSendToCloud: false, plotlyServerURL: '', displaylogo: false });
  });
});
