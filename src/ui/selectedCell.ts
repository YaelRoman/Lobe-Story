import { useSyncExternalStore } from 'react';

/** A cell of the metrics table: its row (a file id) and its column key. */
export interface SelectedCell {
  id: string;
  col: string;
}

// A slice of its own, outside the app store and the table's state: the line above the table follows the focused cell
// without the table (up to 192 rows) rendering again for it.
let current: SelectedCell | null = null;
let entered = false;
const listeners = new Set<() => void>();

/** The cell that was last focused or tapped (null: none). */
export function selectCell(cell: SelectedCell | null): void {
  if (cell === current || (cell !== null && current !== null && cell.id === current.id && cell.col === current.col)) return;
  entered = cell !== null && cell.col !== current?.col;
  current = cell;
  for (const l of listeners) l();
}

export const currentSelectedCell = (): SelectedCell | null => current;

/** Whether the last selection came into another column than the one before it (or into the table): its definition is then news. */
export const enteredColumn = (): boolean => entered;

export function subscribeSelectedCell(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const useSelectedCell = (): SelectedCell | null => useSyncExternalStore(subscribeSelectedCell, currentSelectedCell);
export const useEnteredColumn = (): boolean => useSyncExternalStore(subscribeSelectedCell, enteredColumn);

/** Shown in the line's place while no cell is selected. */
export const CELL_LINE_HINT = 'Select a cell (click, tap or arrow keys) to read here what its column means and why a value is missing (—).';

const sentence = (text: string): string => text.replace(/\s*\n\s*/g, '; ').replace(/[.\s]+$/, '');

/** What the line says about a cell, in the three parts it is made of (each a whole sentence). */
export interface CellLineParts {
  /** The file, the column and the value as shown. */
  value: string;
  /** Why a value is missing ("Why: …"), or a remark about the value. */
  reason?: string;
  /** What the column means. */
  definition?: string;
}

/**
 * The line above the metrics table for one cell: the file, the column and the value as shown; then the reason of a
 * missing value (`reason`; with `note` it is a remark, not a reason), then what the column means. This is what a
 * mouse reads in the cell's and the header's tooltips, for a keyboard and a touch screen.
 */
export function cellLineParts(o: { file: string; header: string; text: string; reason?: string; note?: boolean; definition?: string }): CellLineParts {
  return {
    value: `${o.file} · ${o.header}: ${o.text}.`,
    ...(o.reason ? { reason: `${o.note ? '' : 'Why: '}${sentence(o.reason)}.` } : {}),
    ...(o.definition ? { definition: `${sentence(o.definition)}.` } : {}),
  };
}

/** The parts as one line. */
export function cellLine(o: Parameters<typeof cellLineParts>[0]): string {
  const p = cellLineParts(o);
  return [p.value, p.reason, p.definition].filter(Boolean).join(' ');
}

/**
 * What a screen reader is told when the selection moves: the reason or remark of the cell, and the column's
 * definition only when the selection came into the column. Not the file and the value (the focus move reads the
 * cell), and not the definition again for every row of the column.
 */
export function cellAnnouncement(parts: CellLineParts, cameIntoColumn: boolean): string {
  return [parts.reason, cameIntoColumn ? parts.definition : undefined].filter(Boolean).join(' ');
}
