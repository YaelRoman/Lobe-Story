import { Fragment, useState } from 'react';
import { ENCYC_METRICS, type EncycMode } from './metricEncycData';
import { MiniChart } from './MiniChart';

/**
 * Table (comparison) view of all encyclopedia metrics.
 * Defined-size columns allow text to wrap into multiple rows comfortably
 * without stretching the table horizontally.
 */
export function EncycTableView({ onOpenBook }: { onOpenBook: (index: number) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rowModes, setRowModes] = useState<Record<string, EncycMode>>({});
  const [duTab, setDuTab] = useState<'qam16' | 'qam64' | 'qam256' | 'all'>('qam16');

  return (
    <div className="encyc-table-wrap">
      <p className="encyc-table-hint">
        All 11 metrics at a glance with defined column sizes. Click any row or the chart button to view its example pattern.
      </p>
      <table className="encyc-table" aria-label="Metric comparison table">
        <thead>
          <tr>
            <th scope="col" className="col-name">Metric</th>
            <th scope="col" className="col-def">Definition</th>
            <th scope="col" className="col-for">What's it for?</th>
            <th scope="col" className="col-unit">Unit</th>
            <th scope="col" className="col-chart">Example</th>
          </tr>
        </thead>
        <tbody>
          {ENCYC_METRICS.map((m, i) => {
            const isExpanded = expanded === m.id;
            const isDu = m.id === 'du';
            const activeMode = rowModes[m.id] ?? m.mode;
            return (
              <Fragment key={m.id}>
                <tr
                  className={['encyc-row', isExpanded ? 'expanded' : ''].filter(Boolean).join(' ')}
                  onClick={() => setExpanded(isExpanded ? null : m.id)}
                  aria-expanded={isExpanded}
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpanded(isExpanded ? null : m.id);
                    }
                  }}
                >
                  <td className="col-name">
                    <div className="encyc-name-col">
                      <span className="encyc-metric-name">{m.name}</span>
                      <button
                        type="button"
                        className="encyc-book-link"
                        title={`Open ${m.name} in Book view`}
                        onClick={e => {
                          e.stopPropagation();
                          onOpenBook(i);
                        }}
                        aria-label={`Open ${m.name} in Book view`}
                      >
                        📖 Book
                      </button>
                    </div>
                  </td>
                  <td className="col-def">
                    <div className="encyc-cell-text">{m.definition}</div>
                  </td>
                  <td className="col-for">
                    <div className="encyc-cell-text">{m.whatFor}</div>
                  </td>
                  <td className="col-unit">
                    <code className="encyc-unit">{m.unit}</code>
                  </td>
                  <td className="col-chart">
                    <button
                      type="button"
                      className={['encyc-thumb-btn', isExpanded ? 'active' : ''].filter(Boolean).join(' ')}
                      onClick={e => {
                        e.stopPropagation();
                        setExpanded(isExpanded ? null : m.id);
                      }}
                      aria-label={isExpanded ? `Hide chart for ${m.name}` : `Show chart for ${m.name}`}
                      title={isExpanded ? 'Hide example chart' : 'Show example chart'}
                    >
                      <span className="encyc-thumb-icon" aria-hidden="true">
                        {activeMode === 'rect' ? '📊' : '🎯'}
                      </span>
                      <span className="encyc-thumb-label">
                        {isExpanded ? 'Hide ▲' : 'Chart ▼'}
                      </span>
                    </button>
                  </td>
                </tr>

                {/* Full-width expandable detail row so columns remain strictly defined */}
                {isExpanded && (
                  <tr className="encyc-detail-row">
                    <td colSpan={5} className="encyc-detail-cell">
                      <div className="encyc-table-chart-panel">
                        <div className="book-chart-header" style={{ marginBottom: 8 }}>
                          <span className="book-chart-label">
                            {activeMode === 'polar' ? '🎯 Polar representation' : '📊 Rectangular representation'}
                            {m.cut === 'H' ? ' · Horizontal cut' : ' · Vertical cut'}
                          </span>
                          <div className="encyc-detail-actions">
                            <button
                              type="button"
                              className="view-mode-toggle-btn"
                              onClick={e => {
                                e.stopPropagation();
                                setRowModes(prev => ({
                                  ...prev,
                                  [m.id]: activeMode === 'polar' ? 'rect' : 'polar',
                                }));
                              }}
                              title={`Switch to ${activeMode === 'polar' ? 'rectangular' : 'polar'} representation`}
                            >
                              ⇄ Switch to {activeMode === 'polar' ? 'Rectangular' : 'Polar'}
                            </button>
                            <button
                              type="button"
                              className="encyc-book-link-btn"
                              onClick={e => {
                                e.stopPropagation();
                                onOpenBook(i);
                              }}
                            >
                              📖 View in Book
                            </button>
                          </div>
                        </div>

                        {isDu && m.duTabs ? (
                          <>
                            <div className="du-tabs small" role="tablist">
                              {m.duTabs.map(t => (
                                <button
                                  key={t.key}
                                  type="button"
                                  role="tab"
                                  aria-selected={duTab === t.key}
                                  className={['du-tab', duTab === t.key ? 'active' : ''].filter(Boolean).join(' ')}
                                  onClick={e => {
                                    e.stopPropagation();
                                    setDuTab(t.key);
                                  }}
                                >
                                  {t.label}
                                </button>
                              ))}
                            </div>
                            <div className="encyc-table-chart-box">
                              <MiniChart metric={m} mode={activeMode} duKey={duTab} />
                            </div>
                          </>
                        ) : (
                          <div className="encyc-table-chart-box">
                            <MiniChart metric={m} mode={activeMode} />
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
