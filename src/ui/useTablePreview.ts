import { useCallback, useEffect, useRef } from 'react';
import { hoverStore, setHoverId } from './hoverPreview';

/**
 * The preview setter for the rows of the metrics table. A row that disappears (removed, filtered, undone) or a table
 * that unmounts while one of its rows is previewed never sees its pointer or focus leave, so the preview is ended
 * here; a preview started by another list (the file panel) is left alone. `ids` are the rows now in the table.
 */
export function useTablePreview(ids: readonly string[]): (id: string | null) => void {
  const previewed = useRef<string | null>(null);
  const set = useCallback((id: string | null) => {
    previewed.current = id;
    setHoverId(id);
  }, []);
  const end = () => {
    const id = previewed.current;
    previewed.current = null;
    if (id !== null && hoverStore.getState().id === id) setHoverId(null);
  };
  useEffect(() => {
    if (previewed.current !== null && !ids.includes(previewed.current)) end();
  }, [ids]);
  useEffect(() => end, []);
  return set;
}
