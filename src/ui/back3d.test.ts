import { beforeEach, describe, expect, it } from 'vitest';
import { initialState, loadText, useStore } from '../state/store';
import { applyPrefs, serializePrefs } from '../state/prefs';
import { parseProject, projectToState, serializeProject } from '../state/project';
import { planetText } from '../test/planetText';
import { methodFull, methodNameOf, methodShort, methodWords } from '../core/analysis/backHalf3d';
import { notDefaultChips, type NotDefaultInput } from './notDefault';
import { DEFAULT_SETTINGS } from '../core/analysis/metrics';
import { columnTitle, csvColumns, methodTag, toCsv, toTsv, visibleColumns, withMethod } from './table';
import { DEFAULT_TABLE_GROUPS } from '../state/store';
import { exportFootLine } from './exportFoot';
import { simSummary, simulatedCaption, weightedHorizonNote, WEIGHTED_HORIZON_NOTE } from './simSummary';
import { surfaceExportCaption } from './viewCaps';
import { buildMethodCompareFigure, compareAriaLabel, compareExportCaption } from './methodCompare';
import { surfaceFor, surfacesComputed } from './surfaceCache';
import { FIGURE_THEMES } from './figureTheme';
import { ANGULAR_REGION_PARAMS, bandParamLabel } from '../core/analysis/bandParams';
import { gridFrom, patternFrom, quadBeam } from '../test/synthetic';
import type { FileInput } from '../state/files';

const enc = new TextEncoder();
const input = (path: string): FileInput => ({ path, bytes: enc.encode(planetText()).buffer as ArrayBuffer });
const st = () => useStore.getState();

describe('"Use the back of the vertical cut": the state', () => {
  beforeEach(() => useStore.setState(initialState()));

  it('is off by default', () => {
    expect(initialState().view.back3d).toBe(false);
  });

  it('is a browser preference: remembered, and a damaged value falls back to off', () => {
    const s = initialState();
    const on = { ...s, view: { ...s.view, back3d: true } };
    expect(applyPrefs(serializePrefs(on), s)!.view.back3d).toBe(true);
    expect(applyPrefs(serializePrefs(s), s)!.view.back3d).toBe(false);
    const damaged = JSON.parse(serializePrefs(on));
    damaged.view.back3d = 'yes';
    expect(applyPrefs(JSON.stringify(damaged), s)!.view.back3d).toBe(false);
  });

  it('is saved with a project and opened from it; a project from before the choice opens with it off', () => {
    st().addFiles([input('a.msi')]);
    st().updateView({ back3d: true });
    const text = serializeProject(st(), true);
    expect(JSON.parse(text).state.view.back3d).toBe(true);
    const open = (json: string) => {
      const parsed = parseProject(json);
      if (!parsed.ok) throw new Error(parsed.error);
      return projectToState(parsed.project, initialState(), { theme: 'light', collapsed: initialState().view.collapsed, freqMetric: 'hHpbw', tableTickedOnly: false }, loadText).view!;
    };
    expect(open(text).back3d).toBe(true);
    const older = JSON.parse(text);
    delete older.state.view.back3d;
    expect(open(JSON.stringify(older)).back3d).toBe(false);
  });

  it('its chip puts it back to off, and the undo brings it back', () => {
    st().addFiles([input('a.msi')]);
    st().updateView({ back3d: true });
    st().resetToDefault('back3d');
    expect(st().view.back3d).toBe(false);
    expect(st().undo?.label).toBe('Stop using the back of the vertical cut');
    st().undoLast();
    expect(st().view.back3d).toBe(true);
  });
});

describe('"Not at default": the chip', () => {
  const base = (over: Partial<NotDefaultInput> = {}): NotDefaultInput => ({
    simulation: { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0, hCut: 'beam', offsets: {}, groupOffsets: {} },
    ids: ['a.msi'],
    membership: {},
    groupIds: [],
    method3d: 'summation',
    back3d: true,
    angularRegions: false,
    settings: { ...DEFAULT_SETTINGS },
    subBands: 0,
    tickedOnly: false,
    ...over,
  });
  const texts = (i: NotDefaultInput) => notDefaultChips(i).map((c) => c.text);

  it('only while something uses the reconstruction: a tilt, the horizon cut, the angular regions', () => {
    expect(texts(base())).toEqual([]);
    expect(texts(base({ back3d: false, angularRegions: true }))).toEqual([]);
    const chip = '3D: back of the vertical cut used';
    expect(texts(base({ angularRegions: true }))).toEqual([chip]);
    expect(texts(base({ simulation: { ...base().simulation, mechanicalDeg: 3 } }))).toEqual(['Simulated: mechanical 3°', chip]);
    expect(texts(base({ simulation: { ...base().simulation, hCut: 'horizon' } }))).toEqual(['Horizontal cut: at the horizon', chip]);
    expect(texts(base({ method3d: 'weighted', angularRegions: true }))).toEqual(['3D method: Weighted', chip]);
    expect(notDefaultChips(base({ angularRegions: true }))[0]).toMatchObject({ key: 'back3d', name: `${chip}, stop using it` });
  });
});

describe('the numbers are named with it, as with the 3D method', () => {
  it('names', () => {
    expect(methodFull('summation')).toBe('Summation');
    expect(methodFull(methodNameOf('summation', true))).toBe('Summation + back of V cut');
    expect(methodFull(methodNameOf('weighted', true))).toBe('Weighted + back of V cut');
    expect(methodShort('weighted+back')).toBe('Wtd. + back');
    expect(methodWords('summation')).toBe('summation method');
    expect(methodWords('weighted+back')).toBe('weighted method with the back of the vertical cut');
  });

  it('the angular-region headers of the CSV, Copy table, screen and frequency chart, and the horizon-cut headers', () => {
    expect(withMethod('areSector', 'Sector eff. est.', 'summation+back')).toBe('Sector eff. est. [Summation + back of V cut]');
    expect(withMethod('areSector', 'Sector eff. est.', 'summation')).toBe('Sector eff. est. [Summation]');
    expect(methodTag('areLower', 'weighted+back')).toEqual({ short: '[Wtd. + back]', full: '[Weighted + back of V cut]' });
    const columns = csvColumns({ ...DEFAULT_TABLE_GROUPS, are: true });
    const header = toCsv([], 'dBi', 30, undefined, 20, 3, undefined, false, columns, 'summation+back').split('\r\n')[0];
    expect(header).toContain('Sector eff. est. [Summation + back of V cut] (%)');
    // Comma-free, so the plain CSV header needs no quoting.
    expect(header).not.toContain('"');
    const horizon = toCsv([], 'dBi', 30, { electricalDeg: 1, mechanicalDeg: 0, azimuthDeg: 0 }, 20, 3, undefined, false, columns, 'weighted+back', true).split('\r\n')[0];
    expect(horizon).toContain('H-HPBW tilted [horizon cut] [Weighted + back of V cut] (°)');
    const tsv = toTsv([], visibleColumns({ ...DEFAULT_TABLE_GROUPS, are: true }), 'dBi', 30, 20, 3, undefined, false, 'summation+back').split('\n')[0];
    expect(tsv).toContain('[Summation + back of V cut]');
    expect(columnTitle('areSector', { sectorEdgeDeg: 60, siteSectors: 3, method3d: 'summation+back' })).toContain('3D method: Summation + back of V cut');
    expect(bandParamLabel(ANGULAR_REGION_PARAMS.find((p) => p.key === 'areSector')!, DEFAULT_SETTINGS, 'summation+back')).toBe('Sector efficiency est. [Summation + back of V cut]');
  });

  it('the captions, the collapsed bar and the foot line of images', () => {
    const sim = { tiltActive: true, tilt: { electricalDeg: 0, mechanicalDeg: 4 }, azimuthDeg: 0, offsetCount: 0, groupOffsetCount: 0 };
    expect(simulatedCaption(sim, 'summation+back')).toBe('Simulated: electrical Δ 0°, mechanical 4°, azimuth 0°, summation method with the back of the vertical cut');
    expect(simSummary({ electricalDeg: 0, mechanicalDeg: 4, azimuthDeg: 0 }, 0, 0, 'weighted+back')).toContain('3D method: Weighted + back of V cut');
    expect(surfaceExportCaption('grid', 1, 1, 'summation+back', 40).items[0]).toContain('(summation method with the back of the vertical cut)');
    const view = { ...initialState().view, dimension: '3d' as const };
    expect(exportFootLine(DEFAULT_SETTINGS, { ...view, back3d: true }, new Date(2026, 0, 2))).toContain('3D method: Summation + back of V cut');
    expect(exportFootLine(DEFAULT_SETTINGS, view, new Date(2026, 0, 2))).toContain('3D method: Summation ·');
    expect(weightedHorizonNote('horizon', 'weighted+back')).toBe(WEIGHTED_HORIZON_NOTE);
    expect(weightedHorizonNote('horizon', 'summation+back')).toBeUndefined();
  });

  it('the methods compared say which reconstruction both panels show', () => {
    const p = patternFrom(quadBeam(65), quadBeam(8, 4));
    const e = { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0 };
    const surfaces = { summation: surfaceFor(p, e, 'summation', true), weighted: surfaceFor(p, e, 'weighted', true) };
    const fig = buildMethodCompareFigure({ surfaces, selected: 'summation', backHalf: true, floorDb: 40, theme: FIGURE_THEMES.light });
    const titles = (fig.layout.annotations as { text: string }[]).map((a) => a.text);
    expect(titles[0]).toContain('Summation + back of V cut');
    expect(titles[1]).toContain('Weighted + back of V cut');
    expect(compareAriaLabel('weighted', false, true)).toContain('Weighted + back of V cut on the right (used for the numbers)');
    expect(compareExportCaption('f', 'summation', 40, { maxDb: 1, meanDb: 0.5 }, true).items[0]).toBe(
      'Left: Summation + back of V cut; right: Weighted + back of V cut. The numbers use Summation + back of V cut',
    );
    expect(compareExportCaption('f', 'summation', 40, { maxDb: 1, meanDb: 0.5 }).items[0]).toBe('Left: Summation; right: Weighted. The numbers use Summation');
  });
});

describe('the 3D view cache keeps each reconstruction apart', () => {
  it('computes each once per input, switching back and forth reuses both', () => {
    const p = patternFrom(quadBeam(65), quadBeam(8, 4));
    const e = { electricalDeg: 1, mechanicalDeg: 2, azimuthDeg: 10 };
    const before = surfacesComputed();
    const off = surfaceFor(p, e, 'summation');
    const on = surfaceFor(p, e, 'summation', true);
    expect(surfaceFor(p, e, 'summation')).toBe(off);
    expect(surfaceFor(p, e, 'summation', true)).toBe(on);
    expect(surfacesComputed() - before).toBe(2);
    expect(on.atten).not.toEqual(off.atten);
    expect(gridFrom(quadBeam(65))).toHaveLength(360);
  });
});
