// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { followsDrag, gripByKey, gripByPointer, gripKey, LIVE_DRAG_BUDGET_MS, sliderGripped } from './sliderHold';

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

  it('a key up and a window that loses the focus let go as well', () => {
    for (const end of ['keyup', 'blur']) {
      gripByKey();
      window.dispatchEvent(new Event(end));
      expect(sliderGripped(), end).toBe(false);
    }
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
    window.dispatchEvent(pointer('pointerup'));
    expect(sliderGripped()).toBe(true);
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
    expect(LIVE_DRAG_BUDGET_MS).toBeGreaterThan(0);
  });
});
