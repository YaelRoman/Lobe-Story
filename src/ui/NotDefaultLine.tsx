import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useStore, type NotDefaultKey } from '../state/store';
import { instanceIds } from '../state/selectors';
import { needsAngularRegions } from './table';
import { notDefaultChips, type NotDefaultChip } from './notDefault';
import { useSliderGrip } from './sliderHold';
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
  const main = document.querySelector('main');
  if (main && /auto|scroll/.test(getComputedStyle(main).overflowY)) main.scrollTop += delta;
  else window.scrollBy(0, delta);
}

/**
 * The line under the toolbar that names what is not at its default and changes the numbers on the page (see
 * `notDefaultChips`): "why are my numbers different today". Each chip is a button that puts its own thing back; a
 * reset of typed work offers the usual undo, which the status region says. With everything at its default the line
 * is not there and takes no room.
 *
 * It comes, goes and changes its height with what is set; nothing under it moves for that: the page is scrolled by as
 * much (see `keepPageInPlace`). While a slider is gripped the line stays as it was when the slider was taken (a tilt
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
  const angularRegions = useStore((s) => needsAngularRegions(s.view.tableGroups, s.view.freqMetric));
  const settings = useStore((s) => s.settings);
  const subBands = useStore((s) => s.view.subBands.length);
  const tickedOnly = useStore((s) => s.view.tableTickedOnly);
  const resetToDefault = useStore((s) => s.resetToDefault);
  const ids = useMemo(() => instanceIds(files, copies), [files, copies]);
  const groupIds = useMemo(() => customGroups.map((g) => g.id), [customGroups]);
  const live = useMemo(
    () => notDefaultChips({ simulation, ids, membership, groupIds, method3d, angularRegions, settings, subBands, tickedOnly }),
    [simulation, ids, membership, groupIds, method3d, angularRegions, settings, subBands, tickedOnly],
  );
  // The chips as they were when a slider was gripped, kept until it is let go (set while rendering, so the line never
  // shows a step of the drag). The grip is known at the press, before the first step.
  const gripped = useSliderGrip(true) !== null;
  const [frozen, setFrozen] = useState<NotDefaultChip[] | null>(null);
  if (gripped && frozen === null) setFrozen(live);
  if (!gripped && frozen !== null) setFrozen(null);
  const chips = (gripped ? frozen : null) ?? live;

  const box = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  // Where the line ended on the screen when the page under it was last laid out or scrolled, and for which files.
  const placed = useRef<{ bottom: number; files: unknown } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // Whole pixels: the page is scrolled by whole pixels, and a fraction left over would move it.
    const natural = line.current?.getBoundingClientRect().height ?? 0;
    el.style.minHeight = natural > 0 ? `${Math.ceil(natural)}px` : '';
    const before = placed.current;
    const bottom = el.getBoundingClientRect().bottom;
    // Other files (loaded, removed, a project opened, the session cleared) are another page: nothing to keep in place.
    // The move is measured, not taken from the height: where the window scrolls, the browser may have kept the page in
    // place already, and it must not be done twice.
    if (before && before.files === files && bottom !== before.bottom) keepPageInPlace(bottom - before.bottom);
    placed.current = { bottom: el.getBoundingClientRect().bottom, files };
  });

  // A scroll of the window or a change of its size moves the line on the screen without changing it: noted, not undone.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const note = () => {
      if (placed.current) placed.current = { ...placed.current, bottom: el.getBoundingClientRect().bottom };
    };
    window.addEventListener('scroll', note, { passive: true });
    window.addEventListener('resize', note);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(note);
    observer?.observe(el);
    return () => {
      window.removeEventListener('scroll', note);
      window.removeEventListener('resize', note);
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
