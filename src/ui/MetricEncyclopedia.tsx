import { useEffect, useRef, useState } from 'react';
import { trapTab } from './trapTab';
import { BookView } from './BookView';
import { EncycTableView } from './EncycTableView';

type ViewMode = 'book' | 'table';

interface MetricEncyclopediaProps {
  onClose: () => void;
  opener: HTMLElement | null;
  /** Open directly to a specific metric page in Book view */
  initialMetricIndex?: number;
}

/**
 * The Metric Encyclopedia: a native modal dialog with two sub-modes —
 *   📖 Book  — animated 3D page-flip, one metric per page
 *   📊 Table — side-by-side comparison of all metrics
 *
 * Accessible: Esc closes, Tab stays inside, focus returns to opener.
 */
export function MetricEncyclopedia({ onClose, opener, initialMetricIndex }: MetricEncyclopediaProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [mode, setMode] = useState<ViewMode>(initialMetricIndex !== undefined ? 'book' : 'book');
  const [bookIndex, setBookIndex] = useState(initialMetricIndex ?? 0);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onNativeClose = () => { if (!dialog.open) onCloseRef.current(); };
    dialog.addEventListener('close', onNativeClose);
    if (!dialog.open) dialog.showModal();
    dialog.focus({ preventScroll: true });
    dialog.scrollTop = 0;
    return () => {
      dialog.removeEventListener('close', onNativeClose);
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);

  const handleOpenBook = (index: number) => {
    setBookIndex(index);
    setMode('book');
  };

  return (
    <dialog
      ref={ref}
      className="encyc-dialog"
      tabIndex={-1}
      aria-labelledby="encyc-title"
      onKeyDown={trapTab}
      onClick={e => {
        const r = e.currentTarget.getBoundingClientRect();
        const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        if (e.target === e.currentTarget && outside) onClose();
      }}
    >
      {/* ── Dialog header ── */}
      <div className="encyc-header">
        <h2 id="encyc-title" className="encyc-title">
          📚 Metric Encyclopedia
        </h2>

        {/* View mode toggle */}
        <div className="encyc-mode-toggle seg" role="group" aria-label="View mode">
          <button
            aria-pressed={mode === 'book'}
            onClick={() => setMode('book')}
            title="Book view — one metric per page with animation"
          >
            📖 Book
          </button>
          <button
            aria-pressed={mode === 'table'}
            onClick={() => setMode('table')}
            title="Table view — all metrics side by side"
          >
            📊 Table
          </button>
        </div>

        <button className="encyc-close" onClick={onClose} aria-label="Close encyclopedia">
          ✕
        </button>
      </div>

      {/* ── Content area ── */}
      <div className="encyc-body">
        {mode === 'book' ? (
          <BookView initialIndex={bookIndex} />
        ) : (
          <EncycTableView onOpenBook={handleOpenBook} />
        )}
      </div>

      {/* ── Footer ── */}
      <div className="encyc-footer">
        <p className="encyc-footer-note">
          All examples use the built-in synthetic antenna (not a real antenna).
          Exact definitions:{' '}
          <a
            href="https://github.com/YaelRoman/Lobe-Story/blob/main/docs/metrics.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            metric definitions
          </a>
          .
        </p>
        <button onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}
