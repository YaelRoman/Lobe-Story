import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useStore, type NotDefaultKey } from '../state/store';
import { instanceIds } from '../state/selectors';
import { needsAngularRegions } from './table';
import { notDefaultChips, type NotDefaultChip } from './notDefault';
import { gripKey, sliderGripped, useSliderGrip } from './sliderHold';
import { announce } from './announce';
import { SKIP_TARGETS } from './SkipLinks';

/** Said when "Ticked files only" is switched off from the line (it offers no undo, whose offer would say it). */
export const TICKED_ONLY_OFF = 'Ticked files only is off: the metrics table lists every file again.';

/**
 * The page under the line keeps its place when the line gets higher or lower by `delta` px: the working area is
 * scrolled by as much (or the window, where the page scrolls as a whole). Where it cannot scroll that far (at its top,
 * or too short to scroll) the rest moves. The file panel beside it is left to move: what changes the line is done in the
 * working area, and the panel scrolled by the line's height would hide its first row under its tools.
 */
function keepPageInPlace(delta: number): void {
  const main = scrollingMain();
  if (main) main.scrollTop += delta;
  else window.scrollBy(0, delta);
}

/** The height of the line's rows, in whole pixels (the page is scrolled by whole pixels, and a fraction left over would move it). */
const rowsOf = (el: HTMLElement): number => Math.ceil(el.firstElementChild?.getBoundingClientRect().height ?? 0);

/** Gives the line's box its rows' height, or `floor` where that is more. Returns how far its bottom moved on the screen. */
function setHeight(el: HTMLElement, floor: number): number {
  const from = el.getBoundingClientRect().bottom;
  const height = Math.max(rowsOf(el), floor);
  el.style.minHeight = height > 0 ? `${height}px` : '';
  return el.getBoundingClientRect().bottom - from;
}

/** The working area where it scrolls by itself; null where the page scrolls as a whole (a short window). */
function scrollingMain(): HTMLElement | null {
  const main = document.querySelector('main');
  return main && /auto|scroll/.test(getComputedStyle(main).overflowY) ? main : null;
}

/** How far the page under the line can be scrolled at all. */
function scrollRange(): number {
  const main = scrollingMain();
  if (main) return main.scrollHeight - main.clientHeight;
  const root = document.scrollingElement ?? document.documentElement;
  return root.scrollHeight - root.clientHeight;
}

/** How far the page under the line can be scrolled back up: what it is scrolled down by. */
const scrollRoom = (): number => scrollingMain()?.scrollTop ?? window.scrollY;

/**
 * The line under the toolbar that names what is not at its default and changes the numbers on the page (see
 * `notDefaultChips`): "why are my numbers different today". Each chip is a button that puts its own thing back; a
 * reset of typed work offers the usual undo, which the status region says. With everything at its default the line
 * is not there and takes no room.
 *
 * While the Simulation bar is open it keeps one row ("Numbers at default" when empty: nothing it lists differs), so the first chip moves nothing.
 * Beyond that row it comes, goes and changes its height with what is set; nothing under it moves for that: the page is
 * scrolled by as much (see `keepPageInPlace`). Where the page is too near its top to be scrolled back, a line that gets
 * lower keeps the room as an empty band, given back as the page is scrolled down. While a slider is gripped the line stays as it was when the slider was taken (a tilt
 * brings a chip, and makes the 3D method count): the page is then neither moved nor scrolled under the pointer, and the
 * sentence about a held slider stays where the bar has it. The line catches up when the slider is let go.
 */
export function NotDefaultLine() {
  const files = useStore((s) => s.files);
  const copies = useStore((s) => s.copies);
  const simulation = useStore((s) => s.view.simulation);
  const membership = useStore((s) => s.membership);
  const customGroups = useStore((s) => s.customGroups);
  const method3d = useStore((s) => s.view.method3d);
  const back3d = useStore((s) => s.view.back3d);
  const angularRegions = useStore((s) => needsAngularRegions(s.view.tableGroups, s.view.freqMetric));
  const settings = useStore((s) => s.settings);
  const subBands = useStore((s) => s.view.subBands.length);
  const tickedOnly = useStore((s) => s.view.tableTickedOnly);
  const resetToDefault = useStore((s) => s.resetToDefault);
  // While the Simulation bar is open the line keeps one row, empty or not: the first chip (a typed tilt, the horizon cut)
  // then comes into room that was already there, and nothing under it moves or is scrolled out of sight. The bar keeps
  // the room of its badge for the same reason. Folded, as the page starts, it keeps none.
  const barOpen = useStore((s) => !s.view.collapsed.simBar);
  const ids = useMemo(() => instanceIds(files, copies), [files, copies]);
  const groupIds = useMemo(() => customGroups.map((g) => g.id), [customGroups]);
  const live = useMemo(
    () => notDefaultChips({ simulation, ids, membership, groupIds, method3d, back3d, angularRegions, settings, subBands, tickedOnly }),
    [simulation, ids, membership, groupIds, method3d, back3d, angularRegions, settings, subBands, tickedOnly],
  );
  // The chips as they were when a slider was gripped, kept until it is let go (set while rendering, so the line never
  // shows a step of the drag). The grip is known at the press, before the first step.
  const gripped = useSliderGrip(true) !== null;
  const [frozen, setFrozen] = useState<NotDefaultChip[] | null>(null);
  if (gripped && frozen === null) setFrozen(live);
  if (!gripped && frozen !== null) setFrozen(null);
  const chips = (gripped ? frozen : null) ?? live;
  const reserve = barOpen && ids.length > 0;

  const box = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  // Where the line ended on the screen when the page under it was last laid out or scrolled, and for which files.
  const placed = useRef<{ bottom: number; files: unknown; reserve: boolean } | null>(null);
  // The height the line keeps at least: it got lower where the page under it could not be scrolled back by as much.
  const floor = useRef(0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const before = placed.current;
    // Other files (loaded, removed, a project opened, the session cleared) are another page: nothing to keep in place.
    const sameFiles = before !== null && before.files === files;
    if (!sameFiles) floor.current = 0;
    setHeight(el, floor.current);
    // The move is measured, not taken from the height: where the window scrolls, the browser may have kept the page in
    // place already, and it must not be done twice.
    let moved = before ? el.getBoundingClientRect().bottom - before.bottom : 0;
    if (sameFiles && moved < 0) {
      // Lower: what the page cannot be scrolled back by stays as room in the line, so nothing moves under a pointer that
      // has just clicked (it is given back as the page is scrolled, see below). The same when the bar is folded: its
      // fold button stays under the pointer.
      const short = -moved - scrollRoom();
      if (short > 0) {
        floor.current = el.getBoundingClientRect().height + short;
        moved += setHeight(el, floor.current);
      }
    }
    // Higher: kept in place by a scroll, except for the row the open bar keeps, which comes with the click on its fold
    // button: scrolled away, the bar's own top would go out of sight.
    if (sameFiles && moved !== 0 && (moved < 0 || before.reserve === reserve)) keepPageInPlace(moved);
    placed.current = { bottom: el.getBoundingClientRect().bottom, files, reserve };
  });

  // A scroll of the page moves the line on the screen without changing it: noted, not undone. The room the line still
  // keeps is given back as far as the page has been scrolled down: it is taken from that scroll, and nothing on the screen
  // moves. Where no scroll could ever take it all back (the page is too short to scroll so far), it is given back once
  // the pointer has moved away from where it last pressed, or at a wheel or a key: not under a pointer that rests where
  // it clicked, nor while a button is down or a slider is held. A change of the window's size lays the page out anew: the room goes, and the line takes its rows' height.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const noteBottom = () => {
      if (placed.current) placed.current = { ...placed.current, bottom: el.getBoundingClientRect().bottom };
    };
    const giveBack = (amount: number) => {
      const extra = floor.current - rowsOf(el);
      floor.current = amount >= extra ? 0 : floor.current - amount;
      const moved = setHeight(el, floor.current);
      if (moved !== 0) keepPageInPlace(moved);
      noteBottom();
    };
    const extra = () => floor.current - rowsOf(el);
    const onScroll = (e: Event) => {
      if (e.target !== document && e.target !== document.querySelector('main')) return;
      if (extra() <= 0) floor.current = 0;
      else if (scrollRoom() > 0) giveBack(Math.min(extra(), scrollRoom()));
      noteBottom();
    };
    // Where the page can be scrolled by less than the room kept, no scroll gives all of it back.
    const stuck = () => extra() > 0 && extra() > scrollRange();
    let pressed: { x: number; y: number } | null = null;
    const onPress = (e: PointerEvent) => {
      pressed = { x: e.clientX, y: e.clientY };
    };
    // Not while a button or a finger is down, or a slider is held (by a pointer or a key): a band given back then would
    // move the slider under it. The next move after the release gives it back.
    const onMove = (e: PointerEvent) => {
      if (e.buttons !== 0 || sliderGripped()) return;
      if (stuck() && (pressed === null || Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 24)) giveBack(Infinity);
    };
    const onIntent = (e: Event) => {
      const key = e instanceof KeyboardEvent ? e.key : '';
      if (sliderGripped() || (gripKey(key) && e.target instanceof HTMLInputElement && e.target.type === 'range')) return;
      if (stuck()) giveBack(Infinity);
    };
    const onResize = () => {
      floor.current = 0;
      setHeight(el, 0);
      noteBottom();
    };
    const listeners: [EventTarget, string, EventListener, AddEventListenerOptions][] = [
      [document, 'scroll', onScroll, { capture: true, passive: true }],
      [window, 'pointerdown', onPress as EventListener, { capture: true, passive: true }],
      [window, 'pointerup', onPress as EventListener, { capture: true, passive: true }],
      [window, 'pointermove', onMove as EventListener, { capture: true, passive: true }],
      [window, 'wheel', onIntent, { capture: true, passive: true }],
      [window, 'keydown', onIntent, { capture: true }],
      [window, 'resize', onResize, {}],
    ];
    for (const [target, type, fn, options] of listeners) target.addEventListener(type, fn, options);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(noteBottom);
    observer?.observe(el);
    return () => {
      for (const [target, type, fn, options] of listeners) target.removeEventListener(type, fn, options);
      observer?.disconnect();
    };
  }, []);

  const reset = (key: NotDefaultKey, button: HTMLButtonElement) => {
    const at = chips.findIndex((c) => c.key === key);
    const focused = document.activeElement === button;
    flushSync(() => resetToDefault(key));
    // The others offer the undo, and the status region says it with the offer.
    if (key === 'tickedOnly') announce(TICKED_ONLY_OFF);
    if (!focused) return;
    // The chip is gone: the focus goes to the one that took its place (else the last one), and with no chip left to the plots.
    const left = Array.from(line.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    (left[Math.min(at, left.length - 1)] ?? document.getElementById(SKIP_TARGETS.plots))?.focus();
  };

  return (
    <div className="not-default-box" ref={box}>
      {chips.length === 0 && reserve && (
        // The kept row says that it is kept, and what is true while it is empty: nothing that changes the numbers differs
        // from its default (an azimuth, which turns the drawing only, or the gain unit may be set).
        <div className="not-default not-default-empty" data-testid="not-default-empty">
          <span className="not-default-label">Numbers at default</span>
        </div>
      )}
      {chips.length > 0 && (
        <div className="not-default" role="group" aria-label="Not at default" ref={line} data-testid="not-default">
          <span className="not-default-label" aria-hidden="true">
            Not at default:
          </span>
          {chips.map((c) => (
            <button key={c.key} type="button" className="chip" data-key={c.key} aria-label={c.name} title={c.title} onClick={(e) => reset(c.key, e.currentTarget)}>
              <span>{c.text}</span>
              <span className="chip-x" aria-hidden="true">
                ×
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
