import { beforeEach, describe, expect, it } from 'vitest';
import type { FileInput } from './files';
import { initialState, useStore } from './store';
import { DEFAULT_SETTINGS } from '../core/analysis/metrics';
import { planetText } from '../test/planetText';

const enc = new TextEncoder();
const input = (path: string): FileInput => ({ path, bytes: enc.encode(planetText()).buffer as ArrayBuffer });
const st = () => useStore.getState();

beforeEach(() => {
  useStore.setState(initialState());
  st().addFiles([input('a.msi'), input('b.msi')]);
});

describe('resetToDefault: the click on a chip of the line under the toolbar', () => {
  it('the tilt sliders go to 0, the azimuth stays; an undo is offered and brings them back', () => {
    st().updateSimulation({ electricalDeg: 2, mechanicalDeg: 5, azimuthDeg: 30 });
    st().resetToDefault('tilt');
    expect(st().view.simulation).toMatchObject({ electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 30 });
    expect(st().undo).toMatchObject({ label: 'Reset the tilt sliders', shown: true });
    st().undoLast();
    expect(st().view.simulation).toMatchObject({ electricalDeg: 2, mechanicalDeg: 5, azimuthDeg: 30 });
  });

  it('the tilt offsets of the loaded files and the groups go to 0; an azimuth offset (a site sector) stays', () => {
    const g = st().createGroup('G');
    st().setOffset('a.msi', { electricalDeg: 2, azimuthDeg: 120 });
    st().setOffset('b.msi', { mechanicalDeg: 1 });
    st().setGroupOffset(g, { mechanicalDeg: 3 });
    st().resetToDefault('tiltOffsets');
    expect(st().view.simulation.offsets).toEqual({ 'a.msi': { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 120 } });
    expect(st().view.simulation.groupOffsets).toEqual({});
    expect(st().undo?.label).toBe('Reset the tilt offsets');
    st().undoLast();
    expect(st().view.simulation.offsets['b.msi']).toEqual({ electricalDeg: 0, mechanicalDeg: 1, azimuthDeg: 0 });
    expect(st().view.simulation.groupOffsets[g]).toEqual({ electricalDeg: 0, mechanicalDeg: 3, azimuthDeg: 0 });
  });

  it('the horizontal cut goes back through the beam peak, undoably', () => {
    st().updateSimulation({ hCut: 'horizon' });
    st().resetToDefault('hCut');
    expect(st().view.simulation.hCut).toBe('beam');
    expect(st().undo?.label).toBe('Reset the horizontal cut');
    st().undoLast();
    expect(st().view.simulation.hCut).toBe('horizon');
  });

  it('the 3D method goes back to Summation, undoably', () => {
    st().updateView({ method3d: 'weighted' });
    st().resetToDefault('method3d');
    expect(st().view.method3d).toBe('summation');
    expect(st().undo?.label).toBe('Reset the 3D method');
    st().undoLast();
    expect(st().view.method3d).toBe('weighted');
  });

  it('one analysis setting goes back to its default, the others stay; undoably', () => {
    st().updateSettings({ levelDb: 6, sectorEdgeDeg: 45 });
    st().resetToDefault('setting:levelDb');
    expect(st().settings).toEqual({ ...DEFAULT_SETTINGS, sectorEdgeDeg: 45 });
    expect(st().undo?.label).toBe('Reset the beamwidth level');
    st().undoLast();
    expect(st().settings.levelDb).toBe(6);
    st().resetToDefault('setting:sectorEdgeDeg');
    expect(st().undo?.label).toBe('Reset the sector edge');
  });

  it('user sub-bands go back to automatic with the usual undo', () => {
    st().updateView({ subBands: [{ name: 'A', minMHz: 1, maxMHz: 2 }, { name: 'B', minMHz: 3, maxMHz: 4 }] });
    st().resetToDefault('subBands');
    expect(st().view.subBands).toEqual([]);
    expect(st().undo?.label).toBe('Dropped your 2 sub-bands');
  });

  it('"Ticked files only" is a display preference: switched off with no undo of its own, and an undo on offer stays', () => {
    st().updateSimulation({ mechanicalDeg: 4 });
    st().resetToDefault('tilt');
    const offered = st().undo;
    st().updateView({ tableTickedOnly: true });
    expect(st().undo).toBe(offered);
    st().resetToDefault('tickedOnly');
    expect(st().view.tableTickedOnly).toBe(false);
    expect(st().undo).toBe(offered);
  });

  it('what already is at its default changes nothing and offers nothing', () => {
    for (const key of ['tilt', 'tiltOffsets', 'hCut', 'method3d', 'setting:levelDb', 'subBands', 'tickedOnly'] as const) {
      const before = st();
      st().resetToDefault(key);
      expect(st(), key).toBe(before);
    }
  });

  it('a later edit withdraws the undo of a reset, as for any other', () => {
    st().updateSettings({ levelDb: 6 });
    st().resetToDefault('setting:levelDb');
    st().updateSettings({ fbWindowDeg: 40 });
    expect(st().undo).toBeNull();
  });
});
