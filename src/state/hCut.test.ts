import { beforeEach, describe, expect, it } from 'vitest';
import { initialState, useStore } from './store';
import { parseProject, PROJECT_FORMAT, serializeProject, simulationSet } from './project';
import { changesSession, isDirty, takeSnapshot } from './undo';
import { applyPrefs, prefsOf, serializePrefs } from './prefs';
import { planetText } from '../test/planetText';

const enc = new TextEncoder();
const msi = (freq: number) => planetText({ headers: ['NAME X', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });
const input = (path: string, text: string) => ({ path, bytes: enc.encode(text).buffer as ArrayBuffer });
const st = useStore.getState;

beforeEach(() => useStore.setState(initialState()));

const open = (json: string) => {
  const parsed = parseProject(json);
  if (!parsed.ok) throw new Error(parsed.error);
  st().loadProject(parsed.project);
};

describe('the horizontal cut of the tilt simulation, in the store', () => {
  it('starts as the cut through the beam peak and is set like the other simulation settings', () => {
    expect(st().view.simulation.hCut).toBe('beam');
    st().updateSimulation({ hCut: 'horizon' });
    expect(st().view.simulation.hCut).toBe('horizon');
    const before = st();
    st().updateSimulation({ hCut: 'horizon' });
    expect(st()).toBe(before); // setting the value it has is not an edit
  });

  it('is put back by "Reset everything" (also when no slider is off zero), and kept by "Reset sliders only"', () => {
    st().addFiles([input('a.MSI', msi(1800))]);
    st().updateSimulation({ hCut: 'horizon', mechanicalDeg: 4 });
    st().setOffset('a.MSI', { azimuthDeg: 20 });
    st().resetSimulation('sliders');
    expect(st().view.simulation).toMatchObject({ mechanicalDeg: 0, hCut: 'horizon' });
    expect(Object.keys(st().view.simulation.offsets)).toEqual(['a.MSI']);
    st().resetSimulation('all');
    expect(st().view.simulation).toMatchObject({ hCut: 'beam', offsets: {} });
    // Nothing but the choice is set: the plain Reset button (no offsets, so no question) still puts it back.
    st().updateSimulation({ hCut: 'horizon' });
    st().resetSimulation();
    expect(st().view.simulation.hCut).toBe('beam');
    const before = st();
    st().resetSimulation();
    expect(st()).toBe(before);
  });

  it('alone is not an active simulation: it changes nothing until a file is tilted', () => {
    expect(simulationSet({ ...st().view.simulation, hCut: 'horizon' })).toBe(false);
  });
});

describe('the horizontal cut of the tilt simulation, in a project file', () => {
  it('is saved and reopened with the other simulation settings', () => {
    st().addFiles([input('site/a.MSI', msi(1800))]);
    st().updateSimulation({ mechanicalDeg: 6, hCut: 'horizon' });
    const json = serializeProject(st(), true);
    expect(JSON.parse(json).state.view.simulation.hCut).toBe('horizon');
    st().clear();
    st().resetSimulation('all');
    expect(st().view.simulation.hCut).toBe('beam');
    open(json);
    expect(st().view.simulation).toMatchObject({ mechanicalDeg: 6, hCut: 'horizon' });
  });

  it('is the cut through the beam peak for a project saved before the choice existed, or with a damaged value', () => {
    const project = (simulation: unknown) =>
      JSON.stringify({ format: PROJECT_FORMAT, version: 1, savedAt: '', files: [{ path: 'a.MSI', text: msi(1800) }], state: { view: { simulation } } });
    for (const simulation of [{ mechanicalDeg: 4, showOriginal: true }, { mechanicalDeg: 4, hCut: 'sideways' }, { mechanicalDeg: 4, hCut: 7 }, { mechanicalDeg: 4, hCut: null }]) {
      // The session it replaces has the other choice: the project's (missing) one must not inherit it.
      st().updateSimulation({ hCut: 'horizon' });
      open(project(simulation));
      expect(st().view.simulation).toMatchObject({ mechanicalDeg: 4, hCut: 'beam' });
    }
  });

  it('counts as unsaved work when changed, and no longer when changed back', () => {
    st().addFiles([input('a.MSI', msi(1800))]);
    st().updateSimulation({ mechanicalDeg: 4 });
    st().markSaved();
    expect(isDirty(st())).toBe(false);
    st().updateSimulation({ hCut: 'horizon' });
    expect(isDirty(st())).toBe(true);
    st().updateSimulation({ hCut: 'beam' });
    expect(isDirty(st())).toBe(false);
  });
});

describe('the horizontal cut of the tilt simulation, and undo', () => {
  it('is in the undo snapshot and comes back with an undone Open project', () => {
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    st().updateSimulation({ mechanicalDeg: 4, hCut: 'horizon' });
    expect(takeSnapshot(st()).view.simulation.hCut).toBe('horizon');
    // Clear keeps the global simulation settings (the sliders), and this choice with them.
    st().clear();
    expect(st().view.simulation).toMatchObject({ mechanicalDeg: 4, hCut: 'horizon' });
    st().undoLast();
    expect(st().view.simulation).toMatchObject({ mechanicalDeg: 4, hCut: 'horizon' });

    st().loadProject({ format: PROJECT_FORMAT, version: 1, savedAt: '', files: [{ path: 'p.MSI', text: msi(2100) }], state: {} } as never);
    expect(st().view.simulation.hCut).toBe('beam');
    st().undoLast();
    expect(st().view.simulation).toMatchObject({ mechanicalDeg: 4, hCut: 'horizon' });
  });

  it('withdraws an offered undo when changed afterwards, like any other edit', () => {
    const prev = st();
    expect(changesSession(prev, { view: { ...prev.view, simulation: { ...prev.view.simulation, hCut: 'horizon' } } })).toBe(true);
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    st().clear();
    expect(st().undo).not.toBeNull();
    st().updateSimulation({ hCut: 'horizon' });
    expect(st().undo).toBeNull();
  });
});

describe('the horizontal cut of the tilt simulation, and the remembered preferences', () => {
  it('is session state, not a preference: it is neither stored nor overwritten', () => {
    const s = initialState();
    s.view = { ...s.view, simulation: { ...s.view.simulation, hCut: 'horizon' } };
    expect(serializePrefs(s)).not.toMatch(/hCut|horizon/);
    expect(prefsOf(s).view).not.toHaveProperty('simulation');
    // Applying stored preferences (even ones that name it) leaves the session's choice alone.
    const out = applyPrefs(JSON.stringify({ version: JSON.parse(serializePrefs(s)).version, view: { method3d: 'weighted', hCut: 'beam', simulation: { hCut: 'beam' } } }), s)!;
    expect(out.view.method3d).toBe('weighted');
    expect(out.view.simulation.hCut).toBe('horizon');
  });
});
