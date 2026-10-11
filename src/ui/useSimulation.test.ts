// @vitest-environment jsdom
import { act } from 'react';
import { createElement, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSimulation, type SimulationResult } from './useSimulation';
import { initialState, useStore } from '../state/store';
import { analyzeAll, DEFAULT_SETTINGS, type TaggedPattern } from '../core/analysis/metrics';
import { patternFrom, quadBeam, vBeamWithLobes } from '../test/synthetic';

beforeEach(() => useStore.setState(initialState()));

/** Mounts `useSimulation(tagged, …)` (memoising `metrics` the way App.tsx does) and hands back
 * the latest result after every store update, so tests can check identity across re-renders. */
function mountSimulation(tagged: TaggedPattern[]): { latest: () => SimulationResult; unmount: () => void } {
  const container = document.createElement('div');
  let root: Root;
  let latest: SimulationResult;

  // `tagged` is fixed for the life of this probe (mountSimulation's own parameter), so memoising
  // it with an empty dependency array mirrors how App.tsx memoises metrics against a stable prop.
  function Probe() {
    const metrics = useMemo(() => analyzeAll(tagged, DEFAULT_SETTINGS), []);
    latest = useSimulation(tagged, metrics, DEFAULT_SETTINGS);
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });

  return {
    latest: () => latest,
    unmount: () => act(() => root.unmount()),
  };
}

describe('useSimulation (M2: azimuth must not trigger re-analysis)', () => {
  const a = { pattern: patternFrom(quadBeam(65), vBeamWithLobes, { id: 'a' }), tags: { tiltDeg: 6 } };
  const b = { pattern: patternFrom(quadBeam(60), vBeamWithLobes, { id: 'b' }), tags: { tiltDeg: 6 } };
  const tagged = [a, b];

  let probe: { latest: () => SimulationResult; unmount: () => void };
  afterEach(() => probe?.unmount());

  it('keeps patterns/metrics Map identity when only the global azimuth moves', () => {
    act(() => useStore.getState().updateSimulation({ mechanicalDeg: 4 }));
    probe = mountSimulation(tagged);
    const before = probe.latest();
    expect(before.tiltActive).toBe(true);

    act(() => useStore.getState().updateSimulation({ azimuthDeg: 30 }));
    const after = probe.latest();

    expect(after.azimuthDeg).toBe(30);
    expect(after.effective('a').azimuthDeg).toBe(30);
    expect(after.patterns).toBe(before.patterns);
    expect(after.metrics).toBe(before.metrics);
  });

  it('keeps patterns/metrics Map identity when only a per-file azimuth offset moves', () => {
    act(() => useStore.getState().updateSimulation({ mechanicalDeg: 4 }));
    act(() => useStore.getState().setOffset('b', { mechanicalDeg: 2 }));
    probe = mountSimulation(tagged);
    const before = probe.latest();
    expect(before.isTiltedId('b')).toBe(true);

    act(() => useStore.getState().setOffset('b', { azimuthDeg: 45 }));
    const after = probe.latest();

    expect(after.effective('b').azimuthDeg).toBe(45);
    expect(after.patterns).toBe(before.patterns);
    expect(after.metrics).toBe(before.metrics);
  });

  it('still re-tilts and re-analyses when the mechanical tilt itself changes', () => {
    act(() => useStore.getState().updateSimulation({ mechanicalDeg: 4 }));
    probe = mountSimulation(tagged);
    const before = probe.latest();

    act(() => useStore.getState().updateSimulation({ mechanicalDeg: 5 }));
    const after = probe.latest();

    expect(after.patterns).not.toBe(before.patterns);
    expect(after.metrics).not.toBe(before.metrics);
  });
});

describe('useSimulation with custom groups', () => {
  const a = { pattern: patternFrom(quadBeam(65), vBeamWithLobes, { id: 'a' }), tags: { tiltDeg: 6 } };
  const b = { pattern: patternFrom(quadBeam(60), vBeamWithLobes, { id: 'b' }), tags: { tiltDeg: 6 } };

  it('adds group offsets to member files', () => {
    act(() => {
      const g = useStore.getState().createGroup('S');
      useStore.getState().setMembership('a', g);
      useStore.getState().setGroupOffset(g, { mechanicalDeg: 4, azimuthDeg: 30 });
    });
    const probe = mountSimulation([a, b]);
    const sim = probe.latest();
    expect(sim.effective('a')).toEqual({ electricalDeg: 0, mechanicalDeg: 4, azimuthDeg: 30 });
    expect(sim.isTiltedId('a')).toBe(true);
    expect(sim.isTiltedId('b')).toBe(false);
    expect(sim.groupOffsetCount).toBe(1);
    expect(sim.offsetCount).toBe(0);
    probe.unmount();
  });
});
