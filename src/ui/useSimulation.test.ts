// @vitest-environment jsdom
import { act } from 'react';
import { createElement, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettledSimulation, useSimulation, type SimulationResult } from './useSimulation';
import { GRIP_PAUSE_MS, gripByKey, gripByPointer, KEY_RELEASE_MS } from './sliderHold';
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

describe('a slider dragged where the page does not follow it (many files)', () => {
  const a = { pattern: patternFrom(quadBeam(65), vBeamWithLobes, { id: 'a' }), tags: { tiltDeg: 6 } };
  const b = { pattern: patternFrom(quadBeam(60), vBeamWithLobes, { id: 'b' }), tags: { tiltDeg: 6 } };
  const tagged = [a, b];

  /** As App.tsx: the settled state of the sliders, and the simulation made from it. Counts the passes (new tilted patterns). */
  function mountSettled(follows: boolean) {
    const container = document.createElement('div');
    let root: Root;
    let latest!: SimulationResult;
    let flags!: { behind: boolean; waiting: boolean };
    const passes = new Set<unknown>();
    function Probe() {
      const metrics = useMemo(() => analyzeAll(tagged, DEFAULT_SETTINGS), []);
      const settled = useSettledSimulation(follows);
      latest = useSimulation(tagged, metrics, DEFAULT_SETTINGS, false, settled.state);
      flags = { behind: settled.behind, waiting: settled.waiting };
      passes.add(latest.patterns);
      return null;
    }
    act(() => {
      root = createRoot(container);
      root.render(createElement(Probe));
    });
    return { latest: () => latest, flags: () => flags, passes: () => passes.size, unmount: () => act(() => root.unmount()) };
  }
  const step = (mechanicalDeg: number) => act(() => useStore.getState().updateSimulation({ mechanicalDeg }));
  /** The primary button goes down on a slider, and is let go. */
  const gripSlider = () => gripByPointer({ pointerId: 1, button: 0, isPrimary: true });
  const release = () => act(() => void window.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 1 })));
  /** What is shown for a mechanical tilt set in one step, on a page that follows. */
  function direct(mechanicalDeg: number) {
    useStore.setState(initialState());
    const probe = mountSettled(true);
    step(mechanicalDeg);
    const result = probe.latest();
    probe.unmount();
    useStore.setState(initialState());
    return result;
  }

  let probe: ReturnType<typeof mountSettled>;
  afterEach(() => {
    probe?.unmount();
    release();
  });

  it('shows the state from before the drag until release, and says that it is waiting', () => {
    probe = mountSettled(false);
    const before = probe.latest();
    act(() => gripSlider());
    for (const m of [1, 2, 3, 4]) step(m);
    expect(probe.latest()).toBe(before);
    expect(probe.flags()).toEqual({ behind: true, waiting: true });
    expect(probe.passes()).toBe(1);
  });

  it('after release the simulation is the one a direct set gives, made in one pass', () => {
    const expected = direct(4);
    probe = mountSettled(false);
    act(() => gripSlider());
    for (const m of [1, 2.5, 3, 6, 4]) step(m);
    release();
    const after = probe.latest();
    expect(probe.flags()).toEqual({ behind: false, waiting: false });
    expect(probe.passes()).toBe(2);
    expect(after.tilt).toEqual(expected.tilt);
    expect(after.tiltActive).toBe(true);
    expect(after.simActive).toBe(expected.simActive);
    expect(after.effective('a')).toEqual(expected.effective('a'));
    expect([...after.patterns]).toEqual([...expected.patterns]);
    expect([...after.metrics]).toEqual([...expected.metrics]);
    expect(useStore.getState().view.simulation.mechanicalDeg).toBe(4);
  });

  it('a drag back to the start ends with the state from before it: no pass at all', () => {
    probe = mountSettled(false);
    const before = probe.latest();
    act(() => gripSlider());
    for (const m of [1, 2, 0]) step(m);
    release();
    expect(probe.latest().patterns).toBe(before.patterns);
    expect(probe.latest().metrics).toBe(before.metrics);
    expect(probe.passes()).toBe(1);
  });

  it('a per-file offset slider is held the same way', () => {
    probe = mountSettled(false);
    const before = probe.latest();
    act(() => gripSlider());
    act(() => useStore.getState().setOffset('b', { electricalDeg: 2 }));
    expect(probe.latest()).toBe(before);
    release();
    expect(probe.latest().isTiltedId('b')).toBe(true);
    expect(probe.latest().isTiltedId('a')).toBe(false);
  });

  it('a change made without a grip (the number box, Reset, undo) is followed at once', () => {
    probe = mountSettled(false);
    step(3);
    expect(probe.latest().tilt.mechanicalDeg).toBe(3);
    expect(probe.flags()).toEqual({ behind: false, waiting: false });
    act(() => useStore.getState().resetSimulation());
    expect(probe.latest().tiltActive).toBe(false);
  });

  describe('arrow keys', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      act(() => void window.dispatchEvent(new Event('blur')));
      vi.useRealTimers();
    });
    const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
    const keyDown = (mechanicalDeg: number) =>
      act(() => {
        gripByKey();
        useStore.getState().updateSimulation({ mechanicalDeg });
      });
    const keyUp = () => act(() => void window.dispatchEvent(new Event('keyup')));

    it('a run of taps is followed once, after the last one, and the wait is one wait: it does not end and start again at each tap', () => {
      probe = mountSettled(false);
      const waited: boolean[] = [];
      for (let tap = 1; tap <= 6; tap++) {
        keyDown(tap);
        wait(60);
        keyUp();
        waited.push(probe.flags().waiting);
        wait(120);
        waited.push(probe.flags().waiting);
      }
      expect(waited.every(Boolean)).toBe(true);
      expect(probe.passes()).toBe(1);
      wait(KEY_RELEASE_MS);
      expect(probe.flags()).toEqual({ behind: false, waiting: false });
      expect(probe.passes()).toBe(2);
      expect(probe.latest().tilt.mechanicalDeg).toBe(6);
      // Nothing is left to come.
      wait(5000);
      expect(probe.passes()).toBe(2);
    });

    it('a key held down is not followed in the wait before it starts to repeat', () => {
      probe = mountSettled(false);
      keyDown(1);
      wait(600);
      expect(probe.flags().waiting).toBe(true);
      expect(probe.passes()).toBe(1);
      for (let step = 2; step <= 8; step++) {
        keyDown(step);
        wait(30);
      }
      expect(probe.passes()).toBe(1);
      keyUp();
      wait(KEY_RELEASE_MS);
      expect(probe.passes()).toBe(2);
      expect(probe.latest().tilt.mechanicalDeg).toBe(8);
    });

    it('a key up that never comes: the value is handed on once the key has stood still for its pause', () => {
      probe = mountSettled(false);
      keyDown(3);
      wait(GRIP_PAUSE_MS.key);
      expect(probe.latest().tilt.mechanicalDeg).toBe(3);
      expect(probe.flags()).toEqual({ behind: false, waiting: false });
    });
  });

  it('where the page follows the drag, a grip holds nothing back', () => {
    probe = mountSettled(true);
    act(() => gripSlider());
    step(1);
    expect(probe.latest().tilt.mechanicalDeg).toBe(1);
    step(2);
    expect(probe.latest().tilt.mechanicalDeg).toBe(2);
    expect(probe.flags().waiting).toBe(false);
    expect(probe.passes()).toBe(3);
  });
});
