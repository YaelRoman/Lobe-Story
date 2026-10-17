import { ENCYC_METRICS } from './metricEncycData';
import {
  METRIC_COLORS,
  useMetricInspectorStore,
} from './metricInspectorState';

interface MetricInspectorProps {
  onOpenEncyclopedia?: (index: number) => void;
}

/**
 * Floating, foldable Metric Inspector panel docked to the right of the plot area.
 * Allows isolating a single metric on the main plots (Solo mode) or selecting multiple metrics,
 * with synchronized color-highlighting in the Metrics Table.
 */
export function MetricInspector({ onOpenEncyclopedia }: MetricInspectorProps) {
  const isOpen = useMetricInspectorStore((s) => s.isOpen);
  const toggleOpen = useMetricInspectorStore((s) => s.toggleOpen);
  const setOpen = useMetricInspectorStore((s) => s.setOpen);
  const mode = useMetricInspectorStore((s) => s.mode);
  const setMode = useMetricInspectorStore((s) => s.setMode);
  const focusedMetric = useMetricInspectorStore((s) => s.focusedMetric);
  const setFocusedMetric = useMetricInspectorStore((s) => s.setFocusedMetric);
  const activeMetrics = useMetricInspectorStore((s) => s.activeMetrics);
  const toggleActiveMetric = useMetricInspectorStore((s) => s.toggleActiveMetric);
  const selectAllMetrics = useMetricInspectorStore((s) => s.selectAllMetrics);
  const clearAllMetrics = useMetricInspectorStore((s) => s.clearAllMetrics);
  const setHoveredMetric = useMetricInspectorStore((s) => s.setHoveredMetric);

  const activeFocus = focusedMetric
    ? ENCYC_METRICS.find((m) => m.id === focusedMetric)
    : null;

  return (
    <div className={`metric-inspector-container ${isOpen ? 'open' : 'closed'}`}>
      {/* Floating pill button when folded */}
      {!isOpen && (
        <button
          type="button"
          className="metric-inspector-pill"
          onClick={toggleOpen}
          title="Open Metric Inspector"
          aria-label="Open Metric Inspector"
          aria-expanded={false}
        >
          <span className="pill-icon" aria-hidden="true">🎯</span>
          <span className="pill-title">Metric Focus</span>
          {activeFocus && (
            <span
              className="pill-badge"
              style={{
                backgroundColor: METRIC_COLORS[activeFocus.id]?.badge ?? 'var(--accent)',
              }}
            >
              {activeFocus.name.split(' ')[0]}
            </span>
          )}
          <span className="pill-arrow" aria-hidden="true">▾</span>
        </button>
      )}

      {/* Floating unfolded drawer */}
      {isOpen && (
        <div className="metric-inspector-drawer" role="region" aria-label="Metric Inspector">
          {/* Header */}
          <div className="inspector-header">
            <div className="inspector-title">
              <span className="inspector-icon" aria-hidden="true">🎯</span>
              <span>Metric Inspector</span>
            </div>
            <button
              type="button"
              className="inspector-close-btn"
              onClick={() => setOpen(false)}
              title="Close Metric Inspector"
              aria-label="Close Metric Inspector"
            >
              ✕
            </button>
          </div>

          {/* Mode Switch: Solo vs Multi-Select */}
          <div className="inspector-mode-bar" role="tablist" aria-label="Inspector mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'solo'}
              className={`inspector-mode-btn ${mode === 'solo' ? 'active' : ''}`}
              onClick={() => setMode('solo')}
            >
              ◉ Solo Focus
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'multi'}
              className={`inspector-mode-btn ${mode === 'multi' ? 'active' : ''}`}
              onClick={() => setMode('multi')}
            >
              ☑ Multi-Select
            </button>
          </div>

          {/* Toolbar Actions */}
          <div className="inspector-actions">
            {mode === 'solo' ? (
              <button
                type="button"
                className="inspector-action-link"
                disabled={!focusedMetric}
                onClick={() => setFocusedMetric(null)}
              >
                Clear focus (show all)
              </button>
            ) : (
              <div className="inspector-action-row">
                <button
                  type="button"
                  className="inspector-action-link"
                  onClick={selectAllMetrics}
                >
                  Select all
                </button>
                <span className="inspector-sep">·</span>
                <button
                  type="button"
                  className="inspector-action-link"
                  onClick={clearAllMetrics}
                >
                  Clear all
                </button>
              </div>
            )}
          </div>

          {/* Scrollable Metric List */}
          <div className="inspector-list">
            {ENCYC_METRICS.map((m, idx) => {
              const isFocused = mode === 'solo' && focusedMetric === m.id;
              const isChecked = mode === 'multi' && activeMetrics[m.id];
              const colorDef = METRIC_COLORS[m.id];

              return (
                <div
                  key={m.id}
                  className={`inspector-item ${isFocused ? 'focused' : ''} ${isChecked ? 'checked' : ''}`}
                  style={
                    isFocused
                      ? {
                          backgroundColor: colorDef?.bg ?? 'var(--hl)',
                          borderLeft: `3px solid ${colorDef?.border ?? 'var(--accent)'}`,
                        }
                      : undefined
                  }
                  onPointerEnter={() => setHoveredMetric(m.id)}
                  onPointerLeave={() => setHoveredMetric(null)}
                  onClick={() => {
                    if (mode === 'solo') {
                      setFocusedMetric(focusedMetric === m.id ? null : m.id);
                    } else {
                      toggleActiveMetric(m.id);
                    }
                  }}
                >
                  {/* Radio / Checkbox */}
                  <span className="inspector-control" aria-hidden="true">
                    {mode === 'solo' ? (
                      <span className={`inspector-radio ${isFocused ? 'checked' : ''}`} />
                    ) : (
                      <span className={`inspector-check ${isChecked ? 'checked' : ''}`} />
                    )}
                  </span>

                  {/* Color tag */}
                  <span
                    className="inspector-color-dot"
                    style={{ backgroundColor: colorDef?.badge ?? 'var(--accent)' }}
                    aria-hidden="true"
                  />

                  {/* Name and Cut */}
                  <div className="inspector-name-wrap">
                    <span className="inspector-name">{m.name}</span>
                    <span className="inspector-cut-badge">{m.cut === 'H' ? 'H' : 'V'}</span>
                  </div>

                  {/* Encyclopedia quick jump button */}
                  {onOpenEncyclopedia && (
                    <button
                      type="button"
                      className="inspector-book-btn"
                      title={`Open ${m.name} in Encyclopedia`}
                      aria-label={`Open ${m.name} in Encyclopedia`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenEncyclopedia(idx);
                      }}
                    >
                      📖
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer Note */}
          <div className="inspector-footer">
            <p className="inspector-hint">
              💡 Selecting a metric isolates it on the plot and highlights its column in the table below.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
