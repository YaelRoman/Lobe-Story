import { useEffect } from 'react';
import { CELL_LINE_HINT, cellAnnouncement, selectCell, useEnteredColumn, useSelectedCell, type CellLineParts, type SelectedCell } from './selectedCell';

/**
 * The line above the metrics table for the cell that was last focused or tapped: what its column means and, for "—",
 * why there is no value. It listens to the selected cell by itself (see `selectedCell.ts`), so moving along the cells
 * renders this line and not the table. `describe` gives the text for a cell, or null when the cell is no longer shown.
 */
export function SelectedCellLine({ describe }: { describe: (cell: SelectedCell) => CellLineParts | null }) {
  const cell = useSelectedCell();
  const cameIntoColumn = useEnteredColumn();
  // The selection belongs to the table on screen: gone with it.
  useEffect(() => () => selectCell(null), []);
  const parts = cell ? describe(cell) : null;
  return (
    <>
      {/* A fixed height, so the table under it does not move from cell to cell; a long definition scrolls (focusable for that). */}
      <p className={parts === null ? 'cell-line count' : 'cell-line'} data-testid="cell-line" aria-label="Selected cell" role="group" tabIndex={0}>
        {parts ? [parts.value, parts.reason, parts.definition].filter(Boolean).join(' ') : CELL_LINE_HINT}
      </p>
      {/* What is read out is short: the visible line as a live region queued the whole definition again at every arrow
          key down a column, on top of the cell the focus move reads anyway. */}
      <span className="visually-hidden" aria-live="polite" data-testid="cell-line-live">
        {parts ? cellAnnouncement(parts, cameIntoColumn) : ''}
      </span>
    </>
  );
}
