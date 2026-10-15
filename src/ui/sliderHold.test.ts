// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALWAYS_LIVE_UNITS, drawnFiles, estimatedUnits, expectedPassMs, FIXED_UNITS, followsDrag, GRIP_PAUSE_MS, HOLD_ABOVE_MS, gripByKey, gripByPointer, gripKey, KEY_RELEASE_MS, LIVE_DRAG_BUDGET_MS, passKind, PASSES_KEPT, SCALED_UP_TO, TURN_LEAD, sliderGrip, sliderGripped, sliderKind, sliderKindInHand, type PassCost, type StepLoad } from './sliderHold';
import { PAUSE_MS } from './heldValue';

afterEach(() => window.dispatchEvent(new Event('blur')));

/** A pointer event as the page sees it: jsdom's own has no pointer id everywhere, so the fields are set on a plain event. */
const pointer = (type: string, init: { pointerId?: number; button?: number; buttons?: number; isPrimary?: boolean } = {}) =>
  Object.assign(new Event(type, { bubbles: true }), { pointerId: 1, button: 0, buttons: 1, isPrimary: true, ...init });
/** The primary button of pointer `pointerId` goes down on a slider. */
const press = (pointerId = 1) => gripByPointer({ pointerId, button: 0, isPrimary: true });

describe('a slider is gripped from pointer or key down to the matching up', () => {
  it('pointer down grips, the up of that pointer lets go', () => {
    expect(sliderGripped()).toBe(false);
    press();
    expect(sliderGripped()).toBe(true);
    window.dispatchEvent(pointer('pointerup'));
    expect(sliderGripped()).toBe(false);
  });

  it('a key grips, and a window that loses the focus lets go', () => {
    gripByKey();
    expect(sliderGripped()).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(sliderGripped()).toBe(false);
  });

  it('an element that loses the focus does not let go: the press on a slider takes the focus from another field', () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    press();
    field.dispatchEvent(new FocusEvent('blur'));
    expect(sliderGripped()).toBe(true);
    field.remove();
  });

  it('gripping twice needs one release (a pointer pressed again without its up having been seen)', () => {
    press();
    press();
    window.dispatchEvent(pointer('pointerup'));
    expect(sliderGripped()).toBe(false);
    // The listeners are gone: a later, unrelated pointer up changes nothing and throws nothing.
    window.dispatchEvent(pointer('pointerup'));
    expect(sliderGripped()).toBe(false);
  });

  it('only the keys that move a slider grip it', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) expect(gripKey(key), key).toBe(true);
    for (const key of ['Tab', 'Enter', 'Escape', 'a', 'z', 'Shift', 'Control']) expect(gripKey(key), key).toBe(false);
  });
});

describe('a grip never outlives its pointer', () => {
  it('only the primary button of the primary pointer grips: a right click opens a menu and its release is never seen', () => {
    gripByPointer({ pointerId: 1, button: 2, isPrimary: true });
    expect(sliderGripped()).toBe(false);
    gripByPointer({ pointerId: 1, button: 1, isPrimary: true });
    expect(sliderGripped()).toBe(false);
    gripByPointer({ pointerId: 7, button: 0, isPrimary: false });
    expect(sliderGripped()).toBe(false);
  });

  it('a context menu, a cancelled pointer, a lost capture, a window that loses the focus and a page that is hidden end it', () => {
    const ends: [string, () => void][] = [
      ['contextmenu', () => document.body.dispatchEvent(new Event('contextmenu', { bubbles: true }))],
      ['pointercancel', () => document.body.dispatchEvent(pointer('pointercancel'))],
      ['lostpointercapture', () => document.body.dispatchEvent(pointer('lostpointercapture'))],
      ['blur', () => window.dispatchEvent(new Event('blur'))],
      ['visibilitychange', () => document.dispatchEvent(new Event('visibilitychange'))],
    ];
    for (const [name, end] of ends) {
      press();
      expect(sliderGripped(), name).toBe(true);
      end();
      expect(sliderGripped(), name).toBe(false);
    }
  });

  it('the release of another pointer does not end it (a second finger taps while the first drags)', () => {
    press(4);
    window.dispatchEvent(pointer('pointerup', { pointerId: 5 }));
    window.dispatchEvent(pointer('pointercancel', { pointerId: 5 }));
    expect(sliderGripped()).toBe(true);
    window.dispatchEvent(pointer('pointerup', { pointerId: 4 }));
    expect(sliderGripped()).toBe(false);
  });

  it('a pointer up that was lost: the pointer moving with no button down ends the grip', () => {
    press();
    window.dispatchEvent(pointer('pointermove', { buttons: 1 }));
    expect(sliderGripped()).toBe(true);
    window.dispatchEvent(pointer('pointermove', { buttons: 0 }));
    expect(sliderGripped()).toBe(false);
  });

  it('a pointer up that was lost: the same pointer pressed again somewhere else ends the grip', () => {
    press();
    document.body.dispatchEvent(pointer('pointerdown'));
    expect(sliderGripped()).toBe(false);
  });

  it('a key up does not end a pointer grip, and a pointer up does not end a key grip', () => {
    press();
    window.dispatchEvent(new Event('keyup'));
    expect(sliderGripped()).toBe(true);
    window.dispatchEvent(pointer('pointerup'));
    expect(sliderGripped()).toBe(false);
    gripByKey();
    window.dispatchEvent(new Event('keyup'));
    window.dispatchEvent(pointer('pointerup'));
    expect(sliderGripped()).toBe(true);
  });
});

describe('arrow-key taps: the grip of a key ends a moment after its last key up', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const keyUp = () => window.dispatchEvent(new Event('keyup'));

  it('the pause after a key up is short: a single tap is followed about a third of a second later, and taps 180 ms apart stay one grip', () => {
    // Taps 180 ms apart leave about 140 ms between a key up and the next key down.
    expect(KEY_RELEASE_MS).toBeGreaterThanOrEqual(2 * 140);
    expect(KEY_RELEASE_MS).toBeLessThanOrEqual(300);
  });

  it('a key up does not let go at once, but after the pause', () => {
    gripByKey();
    keyUp();
    expect(sliderGripped()).toBe(true);
    vi.advanceTimersByTime(KEY_RELEASE_MS - 1);
    expect(sliderGripped()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(sliderGripped()).toBe(false);
  });

  it('the next key down keeps the grip: a run of taps is one grip from the first key down to the pause after the last key up', () => {
    const seen: boolean[] = [];
    for (let tap = 0; tap < 6; tap++) {
      gripByKey();
      vi.advanceTimersByTime(60);
      keyUp();
      for (let waited = 0; waited < 120; waited += 20) {
        vi.advanceTimersByTime(20);
        seen.push(sliderGripped());
      }
    }
    expect(seen.every(Boolean)).toBe(true);
    vi.advanceTimersByTime(KEY_RELEASE_MS);
    expect(sliderGripped()).toBe(false);
  });

  it('a held key (it repeats: many key downs, one key up) is one grip as well, and the listeners go with it', () => {
    gripByKey();
    gripByKey();
    gripByKey();
    keyUp();
    vi.advanceTimersByTime(KEY_RELEASE_MS);
    expect(sliderGripped()).toBe(false);
    // A later, unrelated key up changes nothing and throws nothing.
    keyUp();
    vi.advanceTimersByTime(KEY_RELEASE_MS);
    expect(sliderGripped()).toBe(false);
  });

  it('a window that loses the focus or a page that is hidden ends it at once, also inside the pause', () => {
    for (const lost of [() => window.dispatchEvent(new Event('blur')), () => document.dispatchEvent(new Event('visibilitychange'))]) {
      gripByKey();
      keyUp();
      lost();
      expect(sliderGripped()).toBe(false);
      // The timer of the key up is gone with it: a new grip is not ended by it.
      gripByKey();
      vi.advanceTimersByTime(KEY_RELEASE_MS + 1);
      expect(sliderGripped()).toBe(true);
      window.dispatchEvent(new Event('blur'));
    }
  });

  it('a pointer is still let go at once, and a key grip beside it runs its own course', () => {
    gripByKey();
    keyUp();
    press();
    window.dispatchEvent(pointer('pointerup'));
    expect(sliderGripped()).toBe(true);
    vi.advanceTimersByTime(KEY_RELEASE_MS);
    expect(sliderGripped()).toBe(false);
  });

  it('says what grips, the pointer before the key, and how long each may stand still before the page follows', () => {
    expect(sliderGrip()).toBeNull();
    gripByKey();
    expect(sliderGrip()).toBe('key');
    press();
    expect(sliderGrip()).toBe('pointer');
    // A held key starts to repeat only after the system's delay (half a second and more): that wait is no pause.
    expect(GRIP_PAUSE_MS.pointer).toBe(PAUSE_MS);
    expect(GRIP_PAUSE_MS.key).toBeGreaterThan(700);
  });
});

describe('whether the page follows a slider while it is dragged: the first guess, before any pass was timed on this machine', () => {
  it('does with the built-in example, all 24 files ticked, with or without the angular regions', () => {
    expect(followsDrag({ files: 24, drawn: 24, angularRegions: false })).toBe(true);
    expect(followsDrag({ files: 24, drawn: 24, angularRegions: true })).toBe(true);
  });

  it('does not with many ticked files', () => {
    expect(followsDrag({ files: 96, drawn: 96, angularRegions: false })).toBe(false);
    expect(followsDrag({ files: 192, drawn: 192, angularRegions: false })).toBe(false);
  });

  it('does with many files loaded and a few ticked, unless the angular regions are worked out for all of them', () => {
    expect(followsDrag({ files: 192, drawn: 1, angularRegions: false })).toBe(true);
    expect(followsDrag({ files: 192, drawn: 1, angularRegions: true })).toBe(false);
  });

  it('once the files are too many, more of them never make it follow again', () => {
    const live = Array.from({ length: 401 }, (_, n) => followsDrag({ files: n, drawn: n, angularRegions: false }));
    const firstHeld = live.indexOf(false);
    expect(firstHeld).toBeGreaterThan(24);
    expect(live.slice(firstHeld).some(Boolean)).toBe(false);
    for (let n = firstHeld; n <= 400; n++) expect(followsDrag({ files: n, drawn: n, angularRegions: true })).toBe(false);
  });

  it('with nothing loaded there is nothing to wait for', () => {
    expect(followsDrag({ files: 0, drawn: 0, angularRegions: true })).toBe(true);
    expect(followsDrag({ files: 0, drawn: 0, angularRegions: false })).toBe(true);
  });

  it('the switch is at 32 files, all ticked: 32 are followed, 33 are not', () => {
    expect(followsDrag({ files: 32, drawn: 32, angularRegions: false })).toBe(true);
    expect(followsDrag({ files: 33, drawn: 33, angularRegions: false })).toBe(false);
  });

  it('with the angular regions worked out it is at 25 files: 25 are followed, 26 are not', () => {
    expect(followsDrag({ files: 25, drawn: 25, angularRegions: true })).toBe(true);
    expect(followsDrag({ files: 26, drawn: 26, angularRegions: true })).toBe(false);
  });

  it('a loaded file that is not ticked still costs a little: of 33 loaded, 31 ticked are followed and 32 are not', () => {
    expect(followsDrag({ files: 33, drawn: 31, angularRegions: false })).toBe(true);
    expect(followsDrag({ files: 33, drawn: 32, angularRegions: false })).toBe(false);
  });

  it('unticking files, or leaving the angular regions, brings a page back under the switch', () => {
    expect(followsDrag({ files: 48, drawn: 48, angularRegions: false })).toBe(false);
    expect(followsDrag({ files: 48, drawn: 30, angularRegions: false })).toBe(true);
    expect(followsDrag({ files: 26, drawn: 26, angularRegions: true })).toBe(false);
    expect(followsDrag({ files: 26, drawn: 26, angularRegions: false })).toBe(true);
  });

  it('the budget is a quarter of a second a step, and the built-in example with the angular regions has little to spare under it', () => {
    expect(LIVE_DRAG_BUDGET_MS).toBe(250);
    // 24 files at 0.8 + 2 ms each and 24 drawn at 7 ms: 235 ms. Two more files of the same kind would be over.
    expect(followsDrag({ files: 24, drawn: 24, angularRegions: true })).toBe(true);
    expect(followsDrag({ files: 26, drawn: 26, angularRegions: true })).toBe(false);
  });
});

describe('whether the page follows a slider while it is dragged, once passes have been timed on this machine', () => {
  const ticked = (drawn: number, files = 24) => ({ files, drawn, angularRegions: false });
  const example = ticked(24);
  const units = estimatedUnits(example);
  /** A pass of `load` that blocked the page for `ms` at a stretch. */
  const pass = (ms: number, load = example) => ({ ms, units: estimatedUnits(load) });
  const passes = (ms: number[], load = example) => ms.map((m) => pass(m, load));
  /**
   * A session on one load: each drag is the passes it would time if it were followed (a step each), then the pass of
   * its release. The decision of each pass is handed to the next. A drag that is waited for, from the press or from one
   * of its steps on, times no further step, only its release. Says for each drag whether it was followed at the press
   * and to its end.
   */
  const session = (load: StepLoad, drags: { steps: number[]; release: number }[], start?: boolean) => {
    let timed: PassCost[] = [];
    let follows = followsDrag(load, timed, start);
    const note = (ms: number) => {
      timed = [...timed, pass(ms, load)].slice(-PASSES_KEPT);
      follows = followsDrag(load, timed, follows);
    };
    return drags.map(({ steps, release }) => {
      const atPress = follows;
      for (const ms of steps) {
        if (!follows) break;
        note(ms);
      }
      const toTheEnd = follows;
      if (!toTheEnd) note(release);
      return atPress && toTheEnd ? 'followed' : atPress ? 'turned' : 'held';
    });
  };

  it('the estimate gives the shape of the cost: 0.8 per loaded file, 2 more with the angular regions, 7 per ticked file', () => {
    expect(units).toBeCloseTo(24 * 0.8 + 24 * 7, 9);
    expect(estimatedUnits({ ...example, angularRegions: true })).toBeCloseTo(24 * 2.8 + 24 * 7, 9);
    expect(estimatedUnits(ticked(1))).toBeCloseTo(24 * 0.8 + 7, 9);
  });

  it('waits once the passes over 140 ms lead those not over it by eight, and follows once those lead by eight', () => {
    expect([HOLD_ABOVE_MS, TURN_LEAD, PASSES_KEPT]).toEqual([140, 8, 16]);
    expect(followsDrag(example)).toBe(true); // the first guess
    const slow = [154, 250, 170, 228, 160, 190, 150, 210]; // the example with Show all, as measured
    expect(followsDrag(example, passes(slow))).toBe(false);
    expect(followsDrag(example, passes(slow.slice(1)))).toBe(true); // seven are not enough
    expect(followsDrag(example, passes(Array<number>(8).fill(141)), true)).toBe(false);
    expect(followsDrag(example, passes(Array<number>(8).fill(140)), false)).toBe(true);
    expect(followsDrag(example, passes([99, 139, 20, 120, 60, 130, 110, 100]), false)).toBe(true);
    // A pass on the other side takes one off the lead: it has to be made up.
    expect(followsDrag(example, passes([150, 160, 170, 180, 90, 150, 160, 170, 180]))).toBe(true); // 4, 3, 7
    expect(followsDrag(example, passes([150, 160, 170, 180, 90, 150, 160, 170, 180, 190]))).toBe(false); // 4, 3, 8
    // The lead is never less than nothing: quick passes before the slow ones do not have to be made up.
    expect(followsDrag(example, passes([40, 40, 40, 40, 40, 40, 40, 40, ...slow]), true)).toBe(false);
    expect(followsDrag(example, passes([...slow, 40, 40, 40, 40, 40, 40, 40, 40]), false)).toBe(true);
    // Only the last sixteen count: six slow passes before sixteen that are two ahead do not add up to eight.
    const twoAhead = [90, 150, 90, 150, 90, 150, 90, 150, 90, 150, 90, 150, 90, 150, 150, 150];
    expect(followsDrag(example, passes([150, 150, 150, 150, 150, 150, ...twoAhead]))).toBe(true);
  });

  it('two to four ticked files of the example, and one ticked among 96 loaded, are followed drag after drag at the timings measured', () => {
    // Steps as timed in the app on a busy machine, the dearest drags of each load.
    const two = [[127, 87, 87, 109, 94, 83, 174, 91, 84, 137], [93, 86, 68, 105, 69, 62, 109, 73, 63, 159, 62]];
    const four = [[112, 80, 129, 120, 165, 117, 114, 82, 135, 77], [89, 123, 71, 89, 93, 124, 56, 189, 80, 96, 64]];
    expect(session(ticked(2), two.map((steps) => ({ steps, release: 150 })))).toEqual(['followed', 'followed']);
    expect(session(ticked(4), four.map((steps) => ({ steps, release: 150 })))).toEqual(['followed', 'followed']);
    // One ticked of 96 sits near the limit: single passes and pairs over it come in most drags, and three in a row
    // were seen. None of these drags is waited for (two neighbours over the limit used to settle it for the session).
    const one96 = [
      [155, 117, 79, 118, 124, 137, 125, 223, 148],
      [180, 130, 117, 126, 148, 119, 124, 141, 218],
      [130, 132, 80, 235, 99, 106, 64, 119, 243, 88],
      [120, 145, 207, 205, 110, 96, 131, 102, 99, 118],
    ];
    expect(session(ticked(1, 96), one96.map((steps) => ({ steps, release: 191 })))).toEqual(['followed', 'followed', 'followed', 'followed']);
    // Four slow neighbours, which used to turn it, do not either.
    expect(session(ticked(1, 96), [{ steps: [120, 150, 207, 205, 160, 100, 110, 95, 120, 105], release: 136 }])).toEqual(['followed']);
  });

  it('a lead of fewer than eight decides nothing: what was decided stands, and before anything was decided the first guess', () => {
    expect(followsDrag(example, passes([1600]))).toBe(true); // the first pass after a load is often a slow one
    expect(followsDrag(example, passes([1600, 900, 800, 700, 900, 800, 850]))).toBe(true);
    const many = ticked(48, 48);
    expect(followsDrag(many)).toBe(false);
    expect(followsDrag(many, passes([20, 22, 25, 21, 20, 24, 23], many))).toBe(false);
    expect(followsDrag(many, passes([20, 22, 25, 21, 20, 24, 23, 22], many))).toBe(true); // a fast machine follows more files than the first guess allows
    expect(followsDrag(ticked(12), passes([400, 380, 390, 410, 400, 395, 405, 385], ticked(12)))).toBe(false); // and a slow one fewer
    for (const ms of [[90, 1458, 85, 95], [300, 300, 300, 90], [150, 60, 160, 170], [139, 141, 139, 141, 139, 141, 139, 141, 139, 141, 139, 141, 139, 141, 139, 141], [150, 150, 150, 150, 150, 150, 150], [90, 90, 90, 90, 90, 90, 90]]) {
      expect(followsDrag(example, passes(ms), true), `${ms}`).toBe(true);
      expect(followsDrag(example, passes(ms), false), `${ms}`).toBe(false);
      expect(followsDrag(example, passes(ms)), `${ms}`).toBe(true); // nothing decided yet: the first guess
    }
    // A run of passes, the decision of each handed to the next: it turns where the lead is eight, and back where the lead the other way is.
    const run = (start: boolean, ms: number[]) => {
      const out: boolean[] = [];
      let follows = start;
      ms.forEach((_, i) => out.push((follows = followsDrag(example, passes(ms.slice(0, i + 1)).slice(-PASSES_KEPT), follows))));
      return out;
    };
    expect(run(true, [90, 300, 85, 300, 310, 320, 80, 300, 310, 90, 320])).toEqual(Array<boolean>(11).fill(true));
    const there = [150, 160, 170, 180, 150, 190, 160, 150];
    const back = [70, 65, 60, 130, 120, 100, 90, 80];
    expect(run(true, [...there, ...back, 75])).toEqual([...Array<boolean>(7).fill(true), ...Array<boolean>(8).fill(false), true, true]);
  });

  it('a dear load is waited for from the eighth step of its first drag, and stays so', () => {
    // Twelve ticked files of the example on a busy machine: every pass over the limit, the releases too.
    const drags = [{ steps: [143, 170, 183, 160, 175, 190, 165, 180, 172, 168], release: 212 }, ...[205, 150, 251, 163].map((release) => ({ steps: [170, 180, 165, 190, 200], release }))];
    expect(session(ticked(12), drags)).toEqual(['turned', 'held', 'held', 'held', 'held']);
    expect(session(ticked(12), [{ steps: [143, 170, 183, 160, 175, 190, 165], release: 212 }])).toEqual(['followed']); // seven steps: not yet
    // Quick releases among them change nothing.
    const quick = (release: number) => ({ steps: [], release });
    expect(session(ticked(12), [...drags, quick(95), quick(180), quick(110), quick(120), quick(170), quick(100), quick(90), quick(160)])).toEqual(['turned', ...Array<string>(12).fill('held')]);
  });

  it('a load that was waited for by chance comes back: once its releases not over the limit lead by eight', () => {
    const one96 = ticked(1, 96);
    // Eight unlucky neighbours in the first drag (a busy moment of the machine); the drags after it are waited for, each timing its release alone.
    const unlucky = { steps: [120, 150, 207, 205, 160, 145, 150, 170, 155], release: 136 };
    const release = (ms: number) => ({ steps: [110, 95, 120, 105, 99, 118, 101, 96, 130, 104, 92], release: ms });
    // The release of the unlucky drag is the first of the eight.
    expect(session(one96, [unlucky, ...[115, 125, 118, 110, 120, 130, 100].map(release), release(105), release(105)])).toEqual(['turned', ...Array<string>(7).fill('held'), 'followed', 'followed']);
    // A release over the limit among them has to be made up: it puts the turn off by two drags, it does not start the count again.
    expect(session(one96, [unlucky, ...[115, 191, 118, 110, 120, 130, 100, 105, 112].map(release), release(105)])).toEqual(['turned', ...Array<string>(9).fill('held'), 'followed']);
    // The releases measured in the app after such a turn (two of eleven over the limit): back with the next release under it.
    const measured = [105, 131, 94, 150, 134, 121, 177, 83, 107, 83, 77];
    expect(session(one96, [{ ...unlucky, release: 150 }, ...measured.map(release), release(110), release(110)])).toEqual(['turned', ...Array<string>(12).fill('held'), 'followed']);
  });

  it('a load right on the limit does not go to and fro from drag to drag', () => {
    const load = ticked(4);
    // Every other step over the limit, as every other release: no lead either way, so no turn, whichever way it started.
    const even = Array.from({ length: 12 }, (_, d) => ({ steps: [150, 120, 160, 130, 145, 135, 170, 110, 155, 125], release: d % 2 ? 150 : 130 }));
    expect(new Set(session(load, even, true))).toEqual(new Set(['followed']));
    expect(new Set(session(load, even, false))).toEqual(new Set(['held']));
    // Followed again after a turn, the next drags stay so through pairs and threes over the limit.
    const held = [{ steps: [150, 160, 170, 180, 150, 160, 170, 180], release: 130 }];
    const back = [130, 120, 135, 125, 110, 120, 130].map((release) => ({ steps: [150, 120, 160, 130], release }));
    const after = Array.from({ length: 6 }, () => ({ steps: [150, 160, 120, 145, 150, 155, 130, 110, 160, 125], release: 150 }));
    expect(session(load, [...held, ...back, ...after])).toEqual(['turned', ...back.map(() => 'held'), ...after.map(() => 'followed')]);
  });

  it('the review’s replay: where 30 to 60 % of the passes are over the limit the mode changes about once in 40 drags, not three or four times', () => {
    /** A seeded generator (mulberry32): the same passes at every run of the test. */
    const seeded = (seed: number) => () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const load = ticked(4);
    /** Sessions of 40 drags of 11 steps on one load; each pass is over the limit with probability `share`, independently. */
    const replay = (share: number, sessions = 300) => {
      const random = seeded(Math.round(share * 1000) + 7);
      const draw = () => (random() < share ? 170 : 110);
      let changes = 0;
      let four = 0;
      let quick = 0;
      let heldAtEnd = 0;
      for (let n = 0; n < sessions; n++) {
        const drags = Array.from({ length: 40 }, () => ({ steps: Array.from({ length: 11 }, draw), release: draw() }));
        // The drags a change fell in. A drag that is followed at its press after one that was not: the release of the
        // one before changed it back. 'turned': the change to waiting, within the drag.
        const modes = session(load, drags);
        const at = modes.flatMap((m, d) => [...(d > 0 && m !== 'held' && modes[d - 1] !== 'followed' ? [d - 1] : []), ...(m === 'turned' ? [d] : [])]);
        changes += at.length;
        if (at.length >= 4) four++;
        if (at.some((d, i) => i > 0 && d - at[i - 1] <= 2)) quick++;
        if (modes[39] !== 'followed') heldAtEnd++;
      }
      return { changes: changes / sessions, four: four / sessions, quick: quick / sessions, heldAtEnd: heldAtEnd / sessions };
    };
    for (const share of [0.3, 0.4, 0.5, 0.6]) {
      const r = replay(share);
      // The rule before this one, on such passes: 2.1 to 3.9 changes, four or more in 10 to 51 % of the sessions, two within two drags in 12 to 44 %.
      expect(r.changes, `changes, ${share}`).toBeLessThanOrEqual(1.6);
      expect(r.four, `four or more changes, ${share}`).toBeLessThanOrEqual(0.02);
      expect(r.quick, `two changes within two drags, ${share}`).toBeLessThanOrEqual(0.05);
    }
    // A load clearly under the limit is never waited for by chance, and one clearly over it is, once and for good.
    expect(replay(0.1)).toEqual({ changes: 0, four: 0, quick: 0, heldAtEnd: 0 });
    expect(replay(0.2).changes).toBeLessThanOrEqual(0.05);
    expect(replay(0.9)).toEqual({ changes: 1, four: 0, quick: 0, heldAtEnd: 1 });
  });

  it('a pass timed on another load is scaled by the estimate, with a part that does not grow with the load', () => {
    expect(FIXED_UNITS).toBe(75);
    const half = estimatedUnits(ticked(12));
    expect(expectedPassMs(half, pass(200))).toBeCloseTo((200 * (75 + half)) / (75 + units), 9);
    expect(expectedPassMs(units, pass(200))).toBe(200);
    // 24 ticked blocked for 220 to 240 ms: 12 ticked are expected at about 150 to 163 ms, and are waited for too.
    expect(followsDrag(ticked(12), passes([220, 230, 225, 240, 222, 235, 228, 238]), true)).toBe(false);
    // For 180 to 195 ms they are expected at about 122 to 133 ms, under the limit: followed, where the 24 are not.
    const timed = passes([180, 190, 185, 195, 182, 192, 188, 194]);
    expect(followsDrag(example, timed, true)).toBe(false);
    expect(followsDrag(ticked(12), timed, false)).toBe(true);
    // For 200 and 210 ms among them they are expected on both sides of it: what was decided stands.
    const mixed = passes([180, 210, 190, 215, 185, 212, 195, 208]);
    expect(followsDrag(ticked(12), mixed, false)).toBe(false);
    expect(followsDrag(ticked(12), mixed, true)).toBe(true);
  });

  it('a pass timed on a load more than twice or less than half this one says nothing', () => {
    expect(SCALED_UP_TO).toBe(2);
    // All 24 were waited for; two ticked files are followed again at once, as before anything was timed.
    const dear = passes([200, 210, 190, 220, 205, 215, 195, 225]);
    expect(followsDrag(example, dear)).toBe(false);
    expect(followsDrag(ticked(2), dear)).toBe(true);
    expect(followsDrag(ticked(4), dear)).toBe(true);
    // 96 files all ticked took seconds a step; one ticked among them is not judged by that.
    const all96 = ticked(96, 96);
    expect(followsDrag(ticked(1, 96), passes(Array<number>(8).fill(2800), all96))).toBe(true);
    // Quick passes of two ticked files do not make 96 ticked ones followed (nor the 24 waited for, or followed if they were not).
    const cheap = passes(Array<number>(8).fill(42), ticked(2));
    expect(followsDrag(all96, cheap)).toBe(false);
    expect(followsDrag(example, cheap)).toBe(true);
    expect(followsDrag(example, cheap, false)).toBe(false);
    // Near ones and far ones: the far ones are passed over, the near ones count.
    expect(followsDrag(example, [pass(40, ticked(2)), ...passes(Array<number>(7).fill(300))])).toBe(true);
    expect(followsDrag(example, [pass(40, ticked(2)), ...passes(Array<number>(8).fill(300)), pass(40, ticked(2))])).toBe(false);
    expect(followsDrag(all96, [pass(40, ticked(2)), ...passes(Array<number>(8).fill(21), all96)])).toBe(true);
  });

  it('a truly expensive pass is waited for: 96 ticked files at seconds a step, whatever was decided before', () => {
    const all96 = ticked(96, 96);
    for (const before of [true, false, undefined]) expect(followsDrag(all96, passes([2475, 3640, 2900, 3100, 2800, 3300, 2600, 3000], all96), before)).toBe(false);
    // Also on a page the first guess would follow.
    expect(followsDrag(example, passes([900, 1100, 950, 1000, 980, 1050, 920, 990]), true)).toBe(false);
  });

  it('one ticked file of the example stays live whatever was timed: a small load is always followed', () => {
    const one = ticked(1);
    expect(estimatedUnits(one)).toBeLessThanOrEqual(ALWAYS_LIVE_UNITS);
    for (const ms of [5, 80, 180, 5000]) expect(followsDrag(one, passes(Array<number>(16).fill(ms), one), false)).toBe(true);
    expect(followsDrag({ files: 0, drawn: 0, angularRegions: true }, passes(Array<number>(16).fill(5000)))).toBe(true);
  });
});

describe('the kind of a pass: a tilt works every file out again, an azimuth turns the drawing only', () => {
  const state = { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0, showOriginal: true, hCut: 'peak', offsets: {}, groupOffsets: {} };

  it('a slider is of the kind of what it changes', () => {
    expect([sliderKind('electricalDeg'), sliderKind('mechanicalDeg'), sliderKind('azimuthDeg')]).toEqual(['tilt', 'tilt', 'azimuth']);
  });

  it('a pass is of the kind of the global slider that alone changed', () => {
    expect(passKind(state, { ...state, mechanicalDeg: 3 })).toBe('tilt');
    expect(passKind(state, { ...state, electricalDeg: -2 })).toBe('tilt');
    expect(passKind(state, { ...state, electricalDeg: -2, mechanicalDeg: 3 })).toBe('tilt');
    expect(passKind(state, { ...state, azimuthDeg: 20 })).toBe('azimuth');
  });

  it('anything else is of no kind, and is not timed: both at once, an offset, the cut, Show original, nothing', () => {
    expect(passKind(state, { ...state, mechanicalDeg: 3, azimuthDeg: 20 })).toBeNull();
    expect(passKind({ ...state, mechanicalDeg: 3, azimuthDeg: 20 }, state)).toBeNull(); // Reset
    expect(passKind(state, { ...state, offsets: { a: { electricalDeg: 1, mechanicalDeg: 0, azimuthDeg: 0 } } })).toBeNull();
    expect(passKind(state, { ...state, mechanicalDeg: 3, groupOffsets: {} })).toBeNull();
    expect(passKind(state, { ...state, hCut: 'horizon' })).toBeNull();
    expect(passKind(state, { ...state, showOriginal: false })).toBeNull();
    expect(passKind(state, { ...state })).toBeNull();
    expect(passKind(null, state)).toBeNull();
  });
});

describe('the kind of the slider in the hand is known from the press on', () => {
  const kind = sliderKindInHand;

  it('a tilt slider before any was gripped; then the one gripped, also after it was let go', () => {
    expect(kind()).toBe('tilt');
    gripByPointer({ pointerId: 1, button: 0, isPrimary: true }, 'azimuth');
    expect(kind()).toBe('azimuth');
    window.dispatchEvent(pointer('pointerup'));
    expect(sliderGripped()).toBe(false);
    expect(kind()).toBe('azimuth');
    gripByKey('tilt');
    expect(kind()).toBe('tilt');
    gripByKey('azimuth');
    expect(kind()).toBe('azimuth');
    // A press that grips nothing (the right button) changes nothing.
    window.dispatchEvent(new Event('blur'));
    gripByPointer({ pointerId: 1, button: 2, isPrimary: true }, 'tilt');
    expect(kind()).toBe('azimuth');
    gripByPointer({ pointerId: 1, button: 0, isPrimary: true });
    expect(kind()).toBe('tilt');
  });
});

describe('drawnFiles', () => {
  it('counts the ticked files, and one file compared with both 3D methods as two', () => {
    expect(drawnFiles(5, false)).toBe(5);
    expect(drawnFiles(1, true)).toBe(2);
    expect(drawnFiles(0, true)).toBe(0);
    expect(drawnFiles(48, true)).toBe(48);
    // One example file compared is no longer under the always-followed load, so the measured passes decide.
    expect(estimatedUnits({ files: 24, drawn: drawnFiles(1, true), angularRegions: false })).toBeGreaterThan(ALWAYS_LIVE_UNITS);
    expect(estimatedUnits({ files: 24, drawn: drawnFiles(1, false), angularRegions: false })).toBeLessThanOrEqual(ALWAYS_LIVE_UNITS);
  });
});
