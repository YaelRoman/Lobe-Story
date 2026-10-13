// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALWAYS_LIVE_UNITS, estimatedUnits, expectedPassMs, FIXED_UNITS, followsDrag, GRIP_PAUSE_MS, HOLD_ABOVE_MS, gripByKey, gripByPointer, gripKey, KEY_RELEASE_MS, LIVE_DRAG_BUDGET_MS, passKind, PASSES_KEPT, SCALED_UP_TO, sliderGrip, sliderGripped, sliderKind, sliderKindInHand, type PassCost, type StepLoad } from './sliderHold';
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

  it('waits when the last four passes all blocked for more than 140 ms, follows when none of them did', () => {
    expect([HOLD_ABOVE_MS, PASSES_KEPT]).toEqual([140, 4]);
    expect(followsDrag(example)).toBe(true); // the first guess
    expect(followsDrag(example, passes([154, 250, 170, 228]))).toBe(false); // the example with Show all, as measured
    expect(followsDrag(example, passes([141, 141, 141, 141]), true)).toBe(false);
    expect(followsDrag(example, passes([140, 140, 140, 140]), false)).toBe(true);
    expect(followsDrag(example, passes([99, 139, 20, 120]), false)).toBe(true);
    // Only the last four count.
    expect(followsDrag(example, passes([40, 40, 40, 40, 180, 190, 150, 160]), true)).toBe(false);
    expect(followsDrag(example, passes([180, 190, 150, 160, 40, 40, 40, 40]), false)).toBe(true);
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
  });

  it('fewer than four passes decide nothing: the first guess stands until four were timed', () => {
    expect(followsDrag(example, passes([1600]))).toBe(true); // the first pass after a load is often a slow one
    expect(followsDrag(example, passes([1600, 900, 800]), false)).toBe(true);
    const many = ticked(48, 48);
    expect(followsDrag(many)).toBe(false);
    expect(followsDrag(many, passes([20, 22, 25], many), true)).toBe(false);
    expect(followsDrag(many, passes([20, 22, 25, 21], many))).toBe(true); // a fast machine follows more files than the first guess allows
    expect(followsDrag(ticked(12), passes([400, 380, 390, 410], ticked(12)))).toBe(false); // and a slow one fewer
  });

  it('while the last four do not agree what was decided before stands: no single pass, pair or three of a kind turns it round', () => {
    for (const ms of [[90, 1458, 85, 95], [300, 300, 300, 90], [150, 60, 160, 170], [139, 141, 139, 141]]) {
      expect(followsDrag(example, passes(ms), true), `${ms}`).toBe(true);
      expect(followsDrag(example, passes(ms), false), `${ms}`).toBe(false);
      expect(followsDrag(example, passes(ms)), `${ms}`).toBe(true); // nothing decided yet: the first guess
    }
    // A run of passes, the decision of each handed to the next: it turns only where four in a row agree.
    const run = (start: boolean, ms: number[]) => {
      const out: boolean[] = [];
      let follows = start;
      ms.forEach((_, i) => out.push((follows = followsDrag(example, passes(ms.slice(0, i + 1)), follows))));
      return out;
    };
    expect(run(true, [90, 300, 85, 300, 310, 320, 80])).toEqual([true, true, true, true, true, true, true]);
    expect(run(true, [160, 90, 170, 180, 150, 190, 70, 65, 60, 130, 120])).toEqual([true, true, true, true, true, false, false, false, false, true, true]);
  });

  it('a dear load is waited for from the fourth step of its first drag, and stays so', () => {
    // Twelve ticked files of the example on a busy machine: every pass over the limit, the releases too.
    const drags = [{ steps: [143, 170, 183, 160, 175, 190], release: 212 }, ...[205, 150, 251, 163].map((release) => ({ steps: [170, 180, 165, 190, 200], release }))];
    expect(session(ticked(12), drags)).toEqual(['turned', 'held', 'held', 'held', 'held']);
    // One quick release among them changes nothing.
    expect(session(ticked(12), [...drags, { steps: [], release: 95 }, { steps: [], release: 180 }, { steps: [], release: 170 }])).toEqual(['turned', 'held', 'held', 'held', 'held', 'held', 'held', 'held']);
  });

  it('a load that was waited for by chance comes back: once four releases in a row were not over the limit', () => {
    const one96 = ticked(1, 96);
    // Four unlucky neighbours in the first drag; the drags after it are waited for, each timing its release alone.
    const unlucky = { steps: [120, 150, 207, 205, 160, 100, 110], release: 136 };
    const release = (ms: number) => ({ steps: [110, 95, 120, 105, 99, 118, 101, 96, 130, 104, 92], release: ms });
    expect(session(one96, [unlucky, release(115), release(125), release(118), release(110), release(120)])).toEqual(['turned', 'held', 'held', 'held', 'followed', 'followed']);
    // A release over the limit among them puts it off: four in a row are wanted.
    expect(session(one96, [unlucky, release(115), release(191), release(118), release(110), release(125), release(120), release(100)])).toEqual(['turned', 'held', 'held', 'held', 'held', 'held', 'held', 'followed']);
  });

  it('a load right on the limit does not go to and fro from drag to drag: a turn takes four agreeing passes each way', () => {
    const load = ticked(4);
    // Every other step over the limit, as every other release: never four in a row of a kind, so no turn, whichever way it started.
    const even = Array.from({ length: 12 }, (_, d) => ({ steps: [150, 120, 160, 130, 145, 135, 170, 110, 155, 125], release: d % 2 ? 150 : 130 }));
    expect(new Set(session(load, even, true))).toEqual(new Set(['followed']));
    // Waited for, a turn back needs four drags whose releases agree; followed again, the next drags stay so through pairs and threes over the limit.
    const held = [{ steps: [150, 160, 170, 180], release: 150 }];
    const back = [130, 120, 135, 125].map((release) => ({ steps: [150, 120, 160, 130], release }));
    const after = Array.from({ length: 6 }, () => ({ steps: [150, 160, 120, 145, 150, 155, 130, 110, 160, 125], release: 150 }));
    expect(session(load, [...held, ...back, ...after])).toEqual(['turned', 'held', 'held', 'held', 'held', ...after.map(() => 'followed')]);
  });

  it('a pass timed on another load is scaled by the estimate, with a part that does not grow with the load', () => {
    expect(FIXED_UNITS).toBe(75);
    const half = estimatedUnits(ticked(12));
    expect(expectedPassMs(half, pass(200))).toBeCloseTo((200 * (75 + half)) / (75 + units), 9);
    expect(expectedPassMs(units, pass(200))).toBe(200);
    // 24 ticked blocked for 220 to 240 ms: 12 ticked are expected at about 150 to 163 ms, and are waited for too.
    expect(followsDrag(ticked(12), passes([220, 230, 225, 240]), true)).toBe(false);
    // For 180 to 195 ms they are expected at about 122 to 133 ms, under the limit: followed, where the 24 are not.
    const timed = passes([180, 190, 185, 195]);
    expect(followsDrag(example, timed, true)).toBe(false);
    expect(followsDrag(ticked(12), timed, false)).toBe(true);
    // For 200 and 210 ms among them they are expected on both sides of it: what was decided stands.
    const mixed = passes([180, 210, 190, 215]);
    expect(followsDrag(ticked(12), mixed, false)).toBe(false);
    expect(followsDrag(ticked(12), mixed, true)).toBe(true);
  });

  it('a pass timed on a load more than twice or less than half this one says nothing: the first guess stands in', () => {
    expect(SCALED_UP_TO).toBe(2);
    // All 24 were waited for; two ticked files are followed again at once, as before anything was timed.
    const dear = passes([200, 210, 190, 220]);
    expect(followsDrag(ticked(2), dear, false)).toBe(true);
    expect(followsDrag(ticked(4), dear, false)).toBe(true);
    // 96 files all ticked took seconds a step; one ticked among them is not judged by that.
    const all96 = ticked(96, 96);
    expect(followsDrag(ticked(1, 96), passes([2500, 3000, 2800, 2600], all96), false)).toBe(true);
    // Quick passes of two ticked files do not make 96 ticked ones followed (nor the 24, before their own passes are timed).
    const cheap = passes([40, 45, 42, 38], ticked(2));
    expect(followsDrag(all96, cheap, true)).toBe(false);
    expect(followsDrag(example, cheap, false)).toBe(true);
    // Near ones and a far one: still the first guess.
    expect(followsDrag(example, [pass(40, ticked(2)), ...passes([300, 310, 320])], false)).toBe(true);
    expect(followsDrag(all96, [pass(40, ticked(2)), ...passes([20, 22, 21], all96)], true)).toBe(false);
  });

  it('a truly expensive pass is waited for: 96 ticked files at seconds a step, whatever was decided before', () => {
    const all96 = ticked(96, 96);
    for (const before of [true, false, undefined]) expect(followsDrag(all96, passes([2475, 3640, 2900, 3100], all96), before)).toBe(false);
    // Also on a page the first guess would follow.
    expect(followsDrag(example, passes([900, 1100, 950, 1000]), true)).toBe(false);
  });

  it('one ticked file of the example stays live whatever was timed: a small load is always followed', () => {
    const one = ticked(1);
    expect(estimatedUnits(one)).toBeLessThanOrEqual(ALWAYS_LIVE_UNITS);
    for (const ms of [5, 80, 180, 5000]) expect(followsDrag(one, passes([ms, ms, ms, ms], one), false)).toBe(true);
    expect(followsDrag({ files: 0, drawn: 0, angularRegions: true }, passes([5000, 5000, 5000, 5000]))).toBe(true);
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
