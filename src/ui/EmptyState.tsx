import { useRef } from 'react';
import { useStore } from '../state/store';
import { canOfferExample, loadExample } from './loadExample';
import type { OpenHelp } from './HelpDialog';
import { useEmptyPageFocus } from './useFirstFilesFocus';

/** Presses one of the toolbar's file inputs, so the empty state uses exactly the toolbar's handlers. */
const openVia = (testId: 'file-input' | 'folder-input' | 'project-input') =>
  document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)?.click();

/** What the page shows before anything is loaded: what the tool does and the first things to try. */
export function EmptyState({ onHelp }: { onHelp: OpenHelp }) {
  const offerExample = useStore(canOfferExample);
  // Where the focus goes when one of these buttons brings the first files and is gone with this page: see `useFirstFilesFocus`.
  const box = useRef<HTMLElement>(null);
  useEmptyPageFocus(box);
  return (
    <section className="empty-state" data-testid="empty-state" aria-label="Getting started" ref={box}>
      <h2>Look at antenna radiation patterns</h2>
      <p>
        Open or drop Planet pattern files (.msi, .pln, .txt) or whole folders, with the buttons below or in the
        toolbar, or by dropping them anywhere on this page. Files are read in your browser and never uploaded.
      </p>
      <p>
        You get polar and rectangular plots of the horizontal and vertical cuts, a table of beamwidth, tilt, front/back,
        sidelobe and sector metrics, and band statistics across frequencies, tilts and ports.
      </p>
      <div className="empty-actions">
        <button onClick={() => openVia('file-input')}>Open files</button>
        <button onClick={() => openVia('folder-input')}>Open folder</button>
        <button onClick={() => openVia('project-input')}>Open project</button>
        {offerExample && (
          <button className="primary" onClick={loadExample}>
            Load example
          </button>
        )}
        <button onClick={onHelp}>Help / glossary</button>
      </div>
      {offerExample && (
        <p className="count">The example is a small synthetic dual-polarised panel generated in code, not a real antenna.</p>
      )}
    </section>
  );
}
