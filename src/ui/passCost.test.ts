// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPassMeter, noteSimulationDrawn, noteTimedPass, PASS_GIVEN_UP_MS, useFollowsDrag, usePassStart, withPass, type TimedPasses } from './passCost';
import { estimatedUnits, type PassKind, type StepLoad } from './sliderHold';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A clock the test moves by hand. */
function fakeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

/** States whose kind of pass is in the state it leads to. */
const kindOf = (_from: unknown, to: unknown) => (to as { kind: 'tilt' | 'azimuth' | null }).kind;
const [A, B, C] = [{ kind: 'tilt' as const }, { kind: 'tilt' as const }, { kind: 'tilt' as const }];
const files = { n: 24 };
const ticks = { a: true };
const W = [files, ticks, 'polar'];

function setUp() {
  const clock = fakeClock();
  const meter = createPassMeter(clock.now, kindOf);
  /** The page works for `ms` in one go, then has a turn of its own. */
  const work = (ms: number, hidden = false) => {
    clock.advance(ms);
    return meter.free(hidden);
  };
  return { clock, meter, work };
}

describe('timing a pass: for how long at a stretch the page is blocked between the state it is made from and the plots having drawn it', () => {
  it('the longest stretch without a turn of its own is the cost, not the time from end to end', () => {
    const { clock, meter, work } = setUp();
    meter.seen(A, W, false);
    expect(meter.drawn(A, 100, false)).toBeNull(); // what the page started with is not a pass
    clock.advance(500);
    meter.seen(B, W, false);
    // The render blocks for 60 ms, the page idles in turns of 4 ms, the charts draw in pieces of 35 and 20 ms.
    expect(work(60)).toBe(true);
    for (let i = 0; i < 10; i++) work(4);
    work(35);
    work(4);
    clock.advance(20);
    expect(meter.drawn(B, 187, false)).toEqual({ kind: 'tilt', ms: 60, units: 187 }); // 159 ms from end to end
    // Drawn again (a tick, the plot type): not a pass of the simulation, nothing is noted twice.
    clock.advance(300);
    expect(meter.drawn(B, 187, false)).toBeNull();
  });

  it('the stretch that ends with the plots drawn counts too, and a second render of the same state does not start the pass again', () => {
    const { clock, meter, work } = setUp();
    meter.seen(A, W, false);
    meter.seen(B, W, false);
    work(30);
    meter.seen(B, [files, ticks, 'polar'], false);
    clock.advance(90);
    expect(meter.drawn(B, 50, false)).toEqual({ kind: 'tilt', ms: 90, units: 50 });
  });

  it('turns are asked for only while a pass that will be noted runs', () => {
    const { meter, work } = setUp();
    expect(meter.free(false)).toBe(false); // nothing seen yet
    meter.seen(A, W, false);
    expect(meter.free(false)).toBe(false); // the start is not a pass
    meter.seen(B, W, false);
    expect(work(10)).toBe(true);
    meter.drawn(B, 50, false);
    expect(work(10)).toBe(false); // done
    meter.seen(C, [{ n: 48 }, ticks, 'polar'], false);
    expect(work(10)).toBe(false); // not of the simulation alone
  });

  it('says whether such a pass runs without counting a turn: the draw of an older state leaves the newer pass running, and its stretch whole', () => {
    const { meter, clock } = setUp();
    expect(meter.runs()).toBe(false);
    meter.seen(A, W, false);
    expect(meter.runs()).toBe(false);
    meter.seen(B, W, false);
    clock.advance(30);
    expect(meter.drawn(A, 50, false)).toBeNull(); // the plots drew the state before
    expect(meter.runs()).toBe(true);
    clock.advance(40);
    expect(meter.drawn(B, 50, false)).toEqual({ kind: 'tilt', ms: 70, units: 50 });
    expect(meter.runs()).toBe(false);
  });

  it('a newer state that arrives before the plots are done is the pass that is timed, from its own start', () => {
    const { clock, meter, work } = setUp();
    meter.seen(A, W, false);
    meter.seen(B, W, false);
    work(150);
    meter.seen(C, W, false);
    clock.advance(90);
    expect(meter.drawn(B, 50, false)).toBeNull(); // not the state on the page
    expect(meter.drawn(C, 50, false)).toEqual({ kind: 'tilt', ms: 90, units: 50 });
  });

  it('a pass is of the kind of the step that led to it, and one of no kind is not noted', () => {
    const { clock, meter } = setUp();
    const [turned, both] = [{ kind: 'azimuth' as const }, { kind: null }];
    meter.seen(A, W, false);
    meter.seen(turned, W, false);
    clock.advance(40);
    expect(meter.drawn(turned, 700, false)).toEqual({ kind: 'azimuth', ms: 40, units: 700 });
    meter.seen(both, W, false);
    clock.advance(900);
    expect(meter.free(false)).toBe(false);
    expect(meter.drawn(both, 700, false)).toBeNull();
    meter.seen(B, W, false);
    clock.advance(300);
    expect(meter.drawn(B, 700, false)).toEqual({ kind: 'tilt', ms: 300, units: 700 });
  });

  it('says nothing about a pass that was not of the simulation alone: other files, ticks or settings came with it or during it', () => {
    const { clock, meter } = setUp();
    meter.seen(A, W, false);
    // A project is opened: the state and the files change in one go.
    meter.seen(B, [{ n: 48 }, ticks, 'polar'], false);
    clock.advance(900);
    expect(meter.drawn(B, 400, false)).toBeNull();
    // A file is ticked while a pass runs.
    const W2 = [{ n: 48 }, ticks, 'polar'];
    meter.seen(B, W2, false);
    meter.seen(C, W2, false);
    clock.advance(50);
    meter.seen(C, [W2[0], { a: true, b: true }, 'polar'], false);
    clock.advance(50);
    expect(meter.drawn(C, 400, false)).toBeNull();
  });

  it('says nothing about a pass that began or ended while the page was hidden, or was hidden in between (its turns are slowed)', () => {
    const { clock, meter, work } = setUp();
    meter.seen(A, W, false);
    meter.seen(B, W, true);
    clock.advance(5000);
    expect(meter.drawn(B, 100, false)).toBeNull();
    meter.seen(C, W, false);
    clock.advance(5000);
    expect(meter.drawn(C, 100, true)).toBeNull();
    meter.seen(A, W, false);
    work(20);
    expect(work(1000, true)).toBe(false);
    work(20);
    expect(meter.drawn(A, 100, false)).toBeNull();
  });

  it('gives a pass up that has not drawn after 20 s (no cut plots on the page): no turns for ever, and nothing noted', () => {
    const { meter, work } = setUp();
    meter.seen(A, W, false);
    meter.seen(B, W, false);
    expect(PASS_GIVEN_UP_MS).toBe(20_000);
    for (let t = 0; t < PASS_GIVEN_UP_MS; t += 1000) expect(work(1000)).toBe(true);
    expect(work(1)).toBe(false);
    expect(meter.drawn(B, 100, false)).toBeNull();
  });
});

describe('the passes kept: the last four of each kind', () => {
  it('a pass is added to its own kind, and the oldest of five goes', () => {
    let timed: TimedPasses = { tilt: [], azimuth: [] };
    timed = withPass(timed, 'tilt', { ms: 100, units: 30 });
    timed = withPass(timed, 'azimuth', { ms: 20, units: 30 });
    timed = withPass(timed, 'tilt', { ms: 110, units: 30 });
    expect(timed).toEqual({ tilt: [{ ms: 100, units: 30 }, { ms: 110, units: 30 }], azimuth: [{ ms: 20, units: 30 }] });
    // A cheap azimuth pass does not push a tilt pass out, however many come.
    for (let i = 0; i < 7; i++) timed = withPass(timed, 'azimuth', { ms: 20 + i, units: 30 });
    expect(timed.tilt.map((p) => p.ms)).toEqual([100, 110]);
    expect(timed.azimuth.map((p) => p.ms)).toEqual([23, 24, 25, 26]);
    for (const ms of [120, 130, 140]) timed = withPass(timed, 'tilt', { ms, units: 30 });
    expect(timed.tilt.map((p) => p.ms)).toEqual([110, 120, 130, 140]);
  });
});

describe('what the page decides for a drag of each kind of slider, as passes are timed', () => {
  const ticked = (drawn: number, files = 24): StepLoad => ({ files, drawn, angularRegions: false });
  function mount(load: StepLoad) {
    const container = document.createElement('div');
    let root!: Root;
    let follows!: Record<PassKind, boolean>;
    function Probe({ load }: { load: StepLoad }) {
      follows = useFollowsDrag(load);
      return null;
    }
    act(() => {
      root = createRoot(container);
      root.render(createElement(Probe, { load }));
    });
    return {
      follows: () => follows,
      setLoad: (next: StepLoad) => act(() => root.render(createElement(Probe, { load: next }))),
      timed: (kind: PassKind, ms: number, load: StepLoad) => act(() => noteTimedPass(kind, { ms, units: estimatedUnits(load) })),
      unmount: () => act(() => root.unmount()),
    };
  }

  it('each kind goes by its own passes, what was decided stands while they do not agree, and another load starts from the first guess', () => {
    const all = ticked(24);
    const page = mount(all);
    expect(page.follows()).toEqual({ tilt: true, azimuth: true }); // the first guess
    // Three slow tilt passes decide nothing; the fourth one does. The azimuth slider is not touched by it.
    for (const ms of [220, 180, 200]) page.timed('tilt', ms, all);
    expect(page.follows()).toEqual({ tilt: true, azimuth: true });
    page.timed('tilt', 190, all);
    expect(page.follows()).toEqual({ tilt: false, azimuth: true });
    // Quick azimuth passes, however many, do not bring the tilt drag back.
    for (const ms of [30, 35, 32, 31, 29]) page.timed('azimuth', ms, all);
    expect(page.follows()).toEqual({ tilt: false, azimuth: true });
    // Quick tilt passes among the slow ones: still waited for.
    for (const ms of [60, 190, 120, 110, 125, 150]) {
      page.timed('tilt', ms, all);
      expect(page.follows().tilt, `${ms} ms`).toBe(false);
    }
    // Four in a row not over the limit: followed again, and it stays so while some are over it and some are not.
    for (const ms of [95, 90, 130]) page.timed('tilt', ms, all);
    expect(page.follows().tilt).toBe(false);
    page.timed('tilt', 120, all);
    expect(page.follows().tilt).toBe(true);
    for (const ms of [150, 160, 128, 235, 150, 145, 99]) {
      page.timed('tilt', ms, all);
      expect(page.follows().tilt, `${ms} ms`).toBe(true);
    }
    for (const ms of [150, 160, 170, 155]) page.timed('tilt', ms, all);
    expect(page.follows().tilt).toBe(false);
    // Two ticked files: the passes of the 24 say nothing about them, they are followed as before anything was timed.
    page.setLoad(ticked(2));
    expect(page.follows()).toEqual({ tilt: true, azimuth: true });
    // Back to all 24, whose own passes were the last timed: waited for again.
    page.setLoad(ticked(24));
    expect(page.follows().tilt).toBe(false);
    page.unmount();
  });

  it('what was decided belongs to its load: after a change of load, passes that do not agree leave the first guess, not the old decision', () => {
    const all = ticked(24);
    const page = mount(all);
    // 190 to 215 ms with all 24 ticked: waited for. Scaled to 12 ticked they lie on both sides of the limit.
    for (const ms of [190, 215, 195, 210]) page.timed('tilt', ms, all);
    expect(page.follows().tilt).toBe(false);
    page.setLoad(ticked(12));
    expect(page.follows().tilt).toBe(true);
    page.unmount();
    // The other way: 30 files, followed at 120 to 138 ms. For 34, which the first guess waits for, those passes lie on
    // both sides of the limit: waited for, not followed because the 30 were.
    const thirty = ticked(30, 30);
    const other = mount(thirty);
    for (const ms of [120, 135, 125, 138]) other.timed('tilt', ms, thirty);
    expect(other.follows().tilt).toBe(true);
    other.setLoad(ticked(34, 34));
    expect(other.follows().tilt).toBe(false);
    // Back at the 30, their own passes decide again.
    other.setLoad(thirty);
    expect(other.follows().tilt).toBe(true);
    other.unmount();
  });

  it('96 ticked files are waited for whatever a cheap azimuth pass of them took, until tilt passes of them are timed', () => {
    const all96 = ticked(96, 96);
    const page = mount(all96);
    for (const ms of [30, 28, 31, 27]) page.timed('azimuth', ms, all96);
    // A fast machine: the azimuth drag is followed; the tilt drag is not started live on the strength of it.
    expect(page.follows()).toEqual({ tilt: false, azimuth: true });
    for (const ms of [300, 320, 310, 330]) page.timed('tilt', ms, ticked(48, 96));
    expect(page.follows().tilt).toBe(false);
    page.unmount();
  });
});

describe('the turns the meter takes in the page: a timer runs only while a pass that the cut plots will draw is under way', () => {
  afterEach(() => vi.useRealTimers());
  const at = (mechanicalDeg: number) => ({ electricalDeg: 0, mechanicalDeg, azimuthDeg: 0 });
  const workload = ['files', 'ticks'];
  function mount(state: unknown, cutPlots: boolean) {
    let root!: Root;
    function Probe({ state, cutPlots }: { state: unknown; cutPlots: boolean }) {
      usePassStart(state, workload, 100, cutPlots);
      return null;
    }
    act(() => {
      root = createRoot(document.createElement('div'));
      root.render(createElement(Probe, { state, cutPlots }));
    });
    return {
      render: (next: unknown, plots = cutPlots) => act(() => root.render(createElement(Probe, { state: next, cutPlots: plots }))),
      unmount: () => act(() => root.unmount()),
    };
  }

  it('with the cut plots on the page it takes turns from the step until they have drawn it, and stops at once then', () => {
    vi.useFakeTimers();
    const page = mount(at(0), true);
    expect(vi.getTimerCount()).toBe(0);
    page.render(at(1));
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(200);
    expect(vi.getTimerCount()).toBe(1); // still at it: the plots have not drawn
    act(() => noteSimulationDrawn());
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
    page.unmount();
  });

  it('in the 3D view, where no cut plot will draw the step, it takes none at all', () => {
    vi.useFakeTimers();
    const page = mount(at(0), false);
    page.render(at(1));
    expect(vi.getTimerCount()).toBe(0);
    page.render(at(2));
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
    // Back in the cut plots a step is timed again; leaving them in the middle of a pass ends the turns.
    page.render(at(2), true);
    page.render(at(3), true);
    expect(vi.getTimerCount()).toBe(1);
    page.render(at(3), false);
    vi.advanceTimersByTime(8);
    expect(vi.getTimerCount()).toBe(0);
    page.unmount();
  });
});
