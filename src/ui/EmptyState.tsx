import { loadExample } from './loadExample';

/** What the page shows before anything is loaded: what the tool does and the first things to try. */
export function EmptyState({ onHelp }: { onHelp: () => void }) {
  return (
    <section className="empty-state" data-testid="empty-state" aria-label="Getting started">
      <h2>Look at antenna radiation patterns</h2>
      <p>
        Open or drop Planet pattern files (.msi, .pln, .txt) or whole folders, with Open files, Open folder or Open
        project above or by dropping them anywhere on this page. Files are read in your browser and never uploaded.
      </p>
      <p>
        You get polar and rectangular plots of the horizontal and vertical cuts, a table of beamwidth, tilt, front/back,
        sidelobe and sector metrics, and band statistics across frequencies, tilts and ports.
      </p>
      <div className="empty-actions">
        <button onClick={loadExample}>Load example</button>
        <button onClick={onHelp}>Help / glossary</button>
      </div>
      <p className="count">The example is a small synthetic dual-polarised panel generated in code, not a real antenna.</p>
    </section>
  );
}
