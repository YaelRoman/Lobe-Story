// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { followsDrag, gripKey, gripSlider, LIVE_DRAG_BUDGET_MS, sliderGripped } from './sliderHold';

afterEach(() => window.dispatchEvent(new Event('blur')));

describe('a slider is gripped from pointer or key down to the matching up', () => {
  it('pointer down grips, pointer up lets go', () => {
    expect(sliderGripped()).toBe(false);
    gripSlider();
    expect(sliderGripped()).toBe(true);
    window.dispatchEvent(new Event('pointerup'));
    expect(sliderGripped()).toBe(false);
  });

  it('a cancelled pointer, a key up and a window that loses the focus let go as well', () => {
    for (const end of ['pointercancel', 'keyup', 'blur']) {
      gripSlider();
      window.dispatchEvent(new Event(end));
      expect(sliderGripped(), end).toBe(false);
    }
  });

  it('an element that loses the focus does not let go: the press on a slider takes the focus from another field', () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    gripSlider();
    field.dispatchEvent(new FocusEvent('blur'));
    expect(sliderGripped()).toBe(true);
    field.remove();
  });

  it('gripping twice needs one release (a key that repeats sends many key downs)', () => {
    gripSlider();
    gripSlider();
    gripSlider();
    window.dispatchEvent(new Event('keyup'));
    expect(sliderGripped()).toBe(false);
    // The listeners are gone: a later, unrelated key up changes nothing and throws nothing.
    window.dispatchEvent(new Event('keyup'));
    expect(sliderGripped()).toBe(false);
  });

  it('only the keys that move a slider grip it', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) expect(gripKey(key), key).toBe(true);
    for (const key of ['Tab', 'Enter', 'Escape', 'a', 'z', 'Shift', 'Control']) expect(gripKey(key), key).toBe(false);
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
