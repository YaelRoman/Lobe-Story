import { useEffect } from 'react';
import { CELL_LINE_HINT, selectCell, useSelectedCell, type SelectedCell } from './selectedCell';

/**
 * The line above the metrics table for the cell that was last focused or tapped: what its column means and, for "—",
 * why there is no value. It listens to the selected cell by itself (see `selectedCell.ts`), so moving along the cells
 * renders this line and not the table. `describe` gives the text for a cell, or null when the cell is no longer shown.
 */
export function SelectedCellLine({ describe }: { describe: (cell: SelectedCell) => string | null }) {
  const cell = useSelectedCell();
  // The selection belongs to the table on screen: gone with it.
  useEffect(() => () => selectCell(null), []);
  const text = cell ? describe(cell) : null;
  return (
    // A fixed height, so the table under it does not move from cell to cell; a long definition scrolls (focusable for that).
    <p className={text === null ? 'cell-line count' : 'cell-line'} data-testid="cell-line" aria-live="polite" aria-label="Selected cell" role="group" tabIndex={0}>
      {text ?? CELL_LINE_HINT}
    </p>
  );
}
