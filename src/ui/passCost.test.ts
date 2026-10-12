import { describe, expect, it } from 'vitest';
import { createPassMeter } from './passCost';

/** A clock the test moves by hand. */
function fakeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe('timing a pass: from the simulation state the page is made from to the plots having drawn it', () => {
  const [A, B, C] = [{ s: 'a' }, { s: 'b' }, { s: 'c' }];
  const files = { n: 24 };
  const ticks = { a: true };
  const W = [files, ticks, 'polar'];

  it('times a pass of a new state on an unchanged workload', () => {
    const clock = fakeClock();
    const meter = createPassMeter(clock.now);
    meter.seen(A, W, false);
    expect(meter.drawn(A, 100, false)).toBeNull(); // what the page started with is not a pass
    clock.advance(500);
    meter.seen(B, W, false);
    clock.advance(40);
    meter.seen(B, [files, ticks, 'polar'], false); // a second render of the same state, on the same things, does not restart the pass
    clock.advance(80);
    expect(meter.drawn(B, 187, false)).toEqual({ ms: 120, units: 187 });
    // Drawn again (a tick, the plot type): not a pass of the simulation, nothing is noted twice.
    clock.advance(300);
    expect(meter.drawn(B, 187, false)).toBeNull();
  });

  it('a newer state that arrives before the plots are done is the pass that is timed', () => {
    const clock = fakeClock();
    const meter = createPassMeter(clock.now);
    meter.seen(A, W, false);
    meter.seen(B, W, false);
    clock.advance(150);
    meter.seen(C, W, false);
    clock.advance(90);
    expect(meter.drawn(B, 50, false)).toBeNull(); // not the state on the page
    expect(meter.drawn(C, 50, false)).toEqual({ ms: 90, units: 50 });
  });

  it('says nothing about a pass that was not of the simulation alone: other files, ticks or settings came with it or during it', () => {
    const clock = fakeClock();
    const meter = createPassMeter(clock.now);
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

  it('says nothing about a pass that began or ended while the page was hidden (it draws late or not at all)', () => {
    const clock = fakeClock();
    const meter = createPassMeter(clock.now);
    meter.seen(A, W, false);
    meter.seen(B, W, true);
    clock.advance(5000);
    expect(meter.drawn(B, 100, false)).toBeNull();
    meter.seen(C, W, false);
    clock.advance(5000);
    expect(meter.drawn(C, 100, true)).toBeNull();
  });
});
