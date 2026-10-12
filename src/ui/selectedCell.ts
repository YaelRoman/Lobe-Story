import { useSyncExternalStore } from 'react';

/** A cell of the metrics table: its row (a file id) and its column key. */
export interface SelectedCell {
  id: string;
  col: string;
}

// A slice of its own, outside the app store and the table's state: the line above the table follows the focused cell
// without the table (up to 192 rows) rendering again for it.
let current: SelectedCell | null = null;
const listeners = new Set<() => void>();

/** The cell that was last focused or tapped (null: none). */
export function selectCell(cell: SelectedCell | null): void {
  if (cell === current || (cell !== null && current !== null && cell.id === current.id && cell.col === current.col)) return;
  current = cell;
  for (const l of listeners) l();
}

export const currentSelectedCell = (): SelectedCell | null => current;

export function subscribeSelectedCell(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const useSelectedCell = (): SelectedCell | null => useSyncExternalStore(subscribeSelectedCell, currentSelectedCell);

/** Shown in the line's place while no cell is selected. */
export const CELL_LINE_HINT = 'Select a cell (click, tap or arrow keys) to read here what its column means and why a value is missing (—).';

const sentence = (text: string): string => text.replace(/\s*\n\s*/g, '; ').replace(/[.\s]+$/, '');

/**
 * The line above the metrics table for one cell: the file, the column and the value as shown; then the reason of a
 * missing value (`reason`; with `note` it is a remark, not a reason), then what the column means. This is what a
 * mouse reads in the cell's and the header's tooltips, for a keyboard and a touch screen.
 */
export function cellLine(o: { file: string; header: string; text: string; reason?: string; note?: boolean; definition?: string }): string {
  const parts = [`${o.file} · ${o.header}: ${o.text}`];
  if (o.reason) parts.push(o.note ? sentence(o.reason) : `Why: ${sentence(o.reason)}`);
  if (o.definition) parts.push(sentence(o.definition));
  return `${parts.join('. ')}.`;
}
