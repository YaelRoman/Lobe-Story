// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { createPassMeter, noteTimedPass, PASS_GIVEN_UP_MS, useFollowsDrag, withPass, type TimedPasses } from './passCost';
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

describe('the passes kept: the last two of each kind', () => {
  it('a pass is added to its own kind, and the oldest of three goes', () => {
    let timed: TimedPasses = { tilt: [], azimuth: [] };
    timed = withPass(timed, 'tilt', { ms: 100, units: 30 });
    timed = withPass(timed, 'azimuth', { ms: 20, units: 30 });
    timed = withPass(timed, 'tilt', { ms: 110, units: 30 });
    expect(timed).toEqual({ tilt: [{ ms: 100, units: 30 }, { ms: 110, units: 30 }], azimuth: [{ ms: 20, units: 30 }] });
    // A cheap azimuth pass does not push a tilt pass out, however many come.
    for (let i = 0; i < 5; i++) timed = withPass(timed, 'azimuth', { ms: 20 + i, units: 30 });
    expect(timed.tilt.map((p) => p.ms)).toEqual([100, 110]);
    expect(timed.azimuth.map((p) => p.ms)).toEqual([23, 24]);
    timed = withPass(timed, 'tilt', { ms: 120, units: 30 });
    expect(timed.tilt.map((p) => p.ms)).toEqual([110, 120]);
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

  it('each kind goes by its own passes, what was decided stands between the limits, and another load starts from the first guess', () => {
    const all = ticked(24);
    const page = mount(all);
    expect(page.follows()).toEqual({ tilt: true, azimuth: true }); // the first guess
    // One slow tilt pass decides nothing; the second one does. The azimuth slider is not touched by it.
    page.timed('tilt', 220, all);
    expect(page.follows()).toEqual({ tilt: true, azimuth: true });
    page.timed('tilt', 180, all);
    expect(page.follows()).toEqual({ tilt: false, azimuth: true });
    // Quick azimuth passes, however many, do not bring the tilt drag back.
    for (const ms of [30, 35, 32]) page.timed('azimuth', ms, all);
    expect(page.follows()).toEqual({ tilt: false, azimuth: true });
    // A quick tilt pass among the slow ones, and passes between the limits: still waited for.
    for (const ms of [60, 190, 120, 110, 125]) {
      page.timed('tilt', ms, all);
      expect(page.follows().tilt, `${ms} ms`).toBe(false);
    }
    // Two under the lower limit: followed again, and it stays so between the limits.
    for (const ms of [95, 90]) page.timed('tilt', ms, all);
    expect(page.follows().tilt).toBe(true);
    for (const ms of [120, 110, 128, 135, 99]) {
      page.timed('tilt', ms, all);
      expect(page.follows().tilt, `${ms} ms`).toBe(true);
    }
    for (const ms of [150, 160]) page.timed('tilt', ms, all);
    expect(page.follows().tilt).toBe(false);
    // Two ticked files: the passes of the 24 say nothing about them, they are followed as before anything was timed.
    page.setLoad(ticked(2));
    expect(page.follows()).toEqual({ tilt: true, azimuth: true });
    // Back to all 24, whose own passes were the last timed: waited for again.
    page.setLoad(ticked(24));
    expect(page.follows().tilt).toBe(false);
    page.unmount();
  });

  it('96 ticked files are waited for whatever a cheap azimuth pass of them took, until tilt passes of them are timed', () => {
    const all96 = ticked(96, 96);
    const page = mount(all96);
    for (const ms of [30, 28]) page.timed('azimuth', ms, all96);
    // A fast machine: the azimuth drag is followed; the tilt drag is not started live on the strength of it.
    expect(page.follows()).toEqual({ tilt: false, azimuth: true });
    for (const ms of [300, 320]) page.timed('tilt', ms, ticked(48, 96));
    expect(page.follows().tilt).toBe(false);
    page.unmount();
  });
});
