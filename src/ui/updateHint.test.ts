import { describe, expect, it } from 'vitest';
import { ASSUMED_MS_PER_TRACE, expectedTraceCount, expectedUpdateMs, HINT_AFTER_MS, showsUpdateHint, timedCost } from './updateHint';

describe('the "Updating the plots…" hint', () => {
  it('expects a redraw to take as long per trace as the last one did', () => {
    expect(expectedUpdateMs({ ms: 600, traces: 200 }, 100)).toBe(300);
    expect(expectedUpdateMs({ ms: 600, traces: 200 }, 400)).toBe(1200);
    expect(expectedUpdateMs({ ms: 40, traces: 24 }, 0)).toBe(0);
  });

  it('does not take the fixed cost of a small redraw for a cost per trace', () => {
    // One trace drawn in 40 ms is not 40 ms a trace: ticking 48 more must not announce a 2 s wait.
    expect(expectedUpdateMs({ ms: 40, traces: 1 }, 48)).toBeCloseTo(38.4);
    expect(showsUpdateHint({ ms: 40, traces: 1 }, 48)).toBe(false);
  });

  it('assumes a cost per trace until a redraw has been timed (or when the timed one drew nothing)', () => {
    expect(expectedUpdateMs(null, 100)).toBe(100 * ASSUMED_MS_PER_TRACE);
    expect(expectedUpdateMs({ ms: 5, traces: 0 }, 50)).toBe(50 * ASSUMED_MS_PER_TRACE);
  });

  it('is shown only for work expected to take more than 300 ms', () => {
    expect(HINT_AFTER_MS).toBe(300);
    // A small session never flashes the hint, a large one announces its redraws.
    expect(showsUpdateHint(null, 24)).toBe(false);
    expect(showsUpdateHint(null, 192)).toBe(true);
    // The machine's own speed decides once it is known: a fast one draws 192 traces without a hint, a slow one hints at 48.
    expect(showsUpdateHint({ ms: 150, traces: 192 }, 192)).toBe(false);
    expect(showsUpdateHint({ ms: 300, traces: 192 }, 192)).toBe(false);
    expect(showsUpdateHint({ ms: 301, traces: 192 }, 192)).toBe(true);
    expect(showsUpdateHint({ ms: 400, traces: 60 }, 60)).toBe(true);
  });
});

describe('timing a redraw', () => {
  it('is its duration and the traces it drew', () => {
    expect(timedCost({ started: 1000, hidden: false }, 1420, 192)).toEqual({ ms: 420, traces: 192 });
  });

  it('is not taken from a redraw during which the page was hidden: it would announce every later redraw', () => {
    // A tab left for a minute while two traces were being drawn.
    expect(timedCost({ started: 1000, hidden: true }, 61000, 2)).toBeNull();
    // The sample it would have been: 24 traces would get the hint for good.
    expect(showsUpdateHint({ ms: 60000, traces: 2 }, 24)).toBe(true);
  });
});

describe('expectedTraceCount', () => {
  const ids = ['a', 'b', 'c'];
  const all = () => true;
  const none = () => false;
  it('counts a dashed original only for a cut the simulation changes', () => {
    // At the horizon with no tilt: every horizontal cut is simulated, no vertical cut is.
    expect(expectedTraceCount('H', ids, true, all, none)).toBe(6);
    expect(expectedTraceCount('V', ids, true, all, none)).toBe(3);
    expect(expectedTraceCount('both', ids, true, all, none)).toBe(9);
  });
  it('counts no originals when they are off, and only the tilted files for the vertical cut', () => {
    expect(expectedTraceCount('both', ids, false, all, all)).toBe(6);
    expect(expectedTraceCount('V', ids, true, all, (id) => id === 'b')).toBe(4);
  });
});
