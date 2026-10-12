// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followsDrag, GRIP_PAUSE_MS, gripByKey, gripByPointer, gripKey, KEY_RELEASE_MS, LIVE_DRAG_BUDGET_MS, sliderGrip, sliderGripped } from './sliderHold';
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

describe('whether the page follows a slider while it is dragged', () => {
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
