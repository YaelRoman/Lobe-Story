/** Size of the copy mark at the left edge of the focused table cell (the numbers are right-aligned, so that edge is free). */
export const COPY_MARK_PX = 16;

/** Whether a key press is Ctrl/Cmd+C with no text selected (a selection keeps the browser's own copy). */
export function copyShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }, selection: { isCollapsed: boolean } | null = typeof window === 'undefined' ? null : window.getSelection()): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c' && (selection?.isCollapsed ?? true);
}

/**
 * Whether a click at (`x`, `y`) is on the copy mark of a cell with box `rect`. Only the small mark counts (not the
 * whole cell), and only when the cell was already focused before this click: the first click on a cell is a click on its
 * row (it focuses the cell, which shows the mark), the second one on the mark copies.
 */
export function onCopyMark(
  x: number,
  y: number,
  rect: { left: number; right: number; top: number; bottom: number },
  wasFocused: boolean,
): boolean {
  const half = COPY_MARK_PX / 2;
  const mid = (rect.top + rect.bottom) / 2;
  return wasFocused && rect.right - rect.left > 3 * COPY_MARK_PX && x >= rect.left && x <= rect.left + COPY_MARK_PX && Math.abs(y - mid) <= half;
}
