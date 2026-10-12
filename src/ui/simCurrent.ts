import { useStore, type SimulationState } from '../state/store';
import { IMAGE_BEHIND_NOTE } from './updateHint';

/**
 * Whether the page shows the simulation of the sliders as they stand, for what is taken from it at a click: an
 * export must not silently be of an older simulation than the sliders show (a slider is held and waited for, or the
 * page is still working the last change out). Kept outside React: an export asks at the moment of its click.
 */
let shown: SimulationState | null = null;
let bringUp: (() => void) | null = null;

/** `useSettledSimulation` says which state of the sliders the page is made from (null: none is mounted). */
export function noteShownSimulation(state: SimulationState | null): void {
  shown = state;
}

/** `useSettledSimulation` gives the way to make the page from the sliders' state at once; the returned function takes it back. */
export function onCatchUp(run: () => void): () => void {
  bringUp = run;
  return () => {
    if (bringUp === run) bringUp = null;
  };
}

/** The table and the plots are made from an older state of the sliders than the store holds. */
export const simulationBehind = (): boolean => shown !== null && shown !== useStore.getState().view.simulation;

/**
 * Makes the simulation, and with it the table and the band statistics, from the sliders as they stand, before this
 * returns: a value that is held back for a dragged slider is handed on, and nothing waits for a later render. For
 * the exports of what is worked out (CSV, copied rows): they then give what they give after the value was typed.
 * The work blocks the page for as long as one step takes, as it does after a release.
 */
export function catchUpSimulation(): void {
  if (simulationBehind()) bringUp?.();
}

/**
 * Whether an image export is to be held back, and says why if so. A picture is exported as it is drawn, and it
 * cannot be drawn at once: while the simulation is behind the sliders, or the picture itself is still being drawn
 * from it (`pictureBehind`), its export would be of the older simulation.
 */
export function imageExportHeld(pictureBehind = false): boolean {
  if (!pictureBehind && !simulationBehind()) return false;
  useStore.getState().setCopyNote(IMAGE_BEHIND_NOTE);
  return true;
}
