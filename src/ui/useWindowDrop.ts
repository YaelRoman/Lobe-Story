import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { inputsFromDataTransfer } from '../state/files';
import { openSelection } from './openSelection';

/** Accepts files and folders dropped anywhere on the window. Ignores internal drags (regrouping). */
export function useWindowDrop(): boolean {
  const setLoadMessage = useStore((s) => s.setLoadMessage);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const dt = e.dataTransfer;
      void (async () => {
        try {
          await openSelection(await inputsFromDataTransfer(dt));
        } catch {
          setLoadMessage('Could not read the dropped files');
        }
      })();
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [setLoadMessage]);

  return dragging;
}
