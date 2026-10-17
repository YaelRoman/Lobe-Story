import { useEffect, useState, useCallback } from 'react';
import { ENCYC_METRICS } from './metricEncycData';
import { MiniChart } from './MiniChart';

const TOTAL_PAGES = ENCYC_METRICS.length;

export function BookView({ initialIndex = 0 }: { initialIndex?: number }) {
  const [index, setIndex] = useState(initialIndex);
  const [animDir, setAnimDir] = useState<'next' | 'prev'>('next');
  const [duTab, setDuTab] = useState<'qam16' | 'qam64' | 'qam256' | 'all'>('qam16');

  const goTo = useCallback(
    (targetIndex: number, dir?: 'next' | 'prev') => {
      if (targetIndex < 0 || targetIndex >= TOTAL_PAGES) return;
      const direction = dir ?? (targetIndex >= index ? 'next' : 'prev');
      setAnimDir(direction);
      setIndex(targetIndex);
    },
    [index],
  );

  const goNext = useCallback(() => {
    if (index < TOTAL_PAGES - 1) {
      goTo(index + 1, 'next');
    }
  }, [index, goTo]);

  const goPrev = useCallback(() => {
    if (index > 0) {
      goTo(index - 1, 'prev');
    }
  }, [index, goTo]);

  // Keyboard navigation (left/right arrow keys)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        goNext();
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev]);

  const current = ENCYC_METRICS[index];

  return (
    <div className="book-view" aria-live="polite" aria-atomic="true">
      {/* Progress bar */}
      <div
        className="book-progress"
        role="progressbar"
        aria-valuenow={index + 1}
        aria-valuemin={1}
        aria-valuemax={TOTAL_PAGES}
      >
        <div
          className="book-progress-fill"
          style={{ width: `${((index + 1) / TOTAL_PAGES) * 100}%` }}
        />
      </div>

      {/* Navigation header */}
      <div className="book-nav">
        <button
          type="button"
          className="book-nav-btn"
          onClick={goPrev}
          disabled={index === 0}
          aria-label="Previous metric"
        >
          ← Prev
        </button>
        <span className="book-page-counter" aria-live="off">
          {index + 1} / {TOTAL_PAGES} &ensp;·&ensp; <em>{current.name}</em>
        </span>
        <button
          type="button"
          className="book-nav-btn"
          onClick={goNext}
          disabled={index === TOTAL_PAGES - 1}
          aria-label="Next metric"
        >
          Next →
        </button>
      </div>

      {/* Book stage: 3D perspective container */}
      <div className="book-stage">
        <div
          key={`${index}-${animDir}`}
          className={`book-page ${animDir === 'next' ? 'turn-in-next' : 'turn-in-prev'}`}
        >
          <PageContent
            metric={current}
            duTab={duTab}
            onDuTab={tab => setDuTab(tab)}
          />
        </div>
      </div>

      {/* Dot navigator */}
      <div className="book-dots" role="tablist" aria-label="Go to metric">
        {ENCYC_METRICS.map((m, i) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Go to ${m.name}`}
            className={['book-dot', i === index ? 'active' : ''].filter(Boolean).join(' ')}
            onClick={() => goTo(i)}
          />
        ))}
      </div>
    </div>
  );
}

/** The content rendered inside one book page */
function PageContent({
  metric,
  duTab,
  onDuTab,
}: {
  metric: typeof ENCYC_METRICS[0];
  duTab: 'qam16' | 'qam64' | 'qam256' | 'all';
  onDuTab: (tab: 'qam16' | 'qam64' | 'qam256' | 'all') => void;
}) {
  const [viewMode, setViewMode] = useState<import('./metricEncycData').EncycMode>(metric.mode);

  useEffect(() => {
    setViewMode(metric.mode);
  }, [metric.id, metric.mode]);

  const isDu = metric.id === 'du';

  return (
    <div className="book-page-inner">
      {/* Left: chart column */}
      <div className="book-page-chart-col">
        <div className="book-chart-header">
          <div className="book-chart-label">
            {viewMode === 'rect' ? '📊 Rectangular view' : '🎯 Polar view'}
            {metric.cut === 'H' ? ' · Horizontal cut' : ' · Vertical cut'}
          </div>
          <button
            type="button"
            className="view-mode-toggle-btn"
            onClick={() => setViewMode(m => (m === 'polar' ? 'rect' : 'polar'))}
            title={`Switch to ${viewMode === 'polar' ? 'rectangular' : 'polar'} representation`}
            aria-label={`Switch to ${viewMode === 'polar' ? 'rectangular' : 'polar'} representation`}
          >
            ⇄ Switch to {viewMode === 'polar' ? 'Rectangular' : 'Polar'}
          </button>
        </div>

        {isDu && metric.duTabs ? (
          <>
            {/* D/U: tab bar for the three QAM variants + overview tab */}
            <div className="du-tabs" role="tablist" aria-label="QAM variant">
              {metric.duTabs.map(t => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={duTab === t.key}
                  className={['du-tab', duTab === t.key ? 'active' : ''].filter(Boolean).join(' ')}
                  onClick={() => onDuTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <MiniChart metric={metric} mode={viewMode} duKey={duTab} />
            <p className="book-chart-note">
              {duTab === 'all'
                ? 'All three modulation apertures stacked for comparison (16QAM: green, 64QAM: blue, 256QAM: purple).'
                : `Threshold: ${metric.duTabs.find(t => t.key === duTab)?.db ?? ''} dB — shaded region shows the contiguous D/U aperture for this QAM order.`}
            </p>
          </>
        ) : (
          <>
            <MiniChart metric={metric} mode={viewMode} />
            {metric.id === 'rolloff' && (
              <p className="book-chart-note">
                <span style={{ color: '#cf222e' }}>── Red markers</span>: Roll-off level measured at exactly ±60° (sector boundaries).
              </p>
            )}
            {metric.id === 'hpbw' && (
              <p className="book-chart-note">
                <span style={{ color: '#cf222e' }}>── Shaded beam zone</span>: 3 dB beamwidth span (66° wide) between half-power points.
              </p>
            )}
            {metric.id === 'vhpbw' && (
              <p className="book-chart-note">
                <span style={{ color: '#cf222e' }}>── Shaded beam zone</span>: 3 dB vertical beamwidth span (8.6° wide) around 5° tilt.
              </p>
            )}
            {metric.id === 'usls' && (
              <p className="book-chart-note">
                <span style={{ color: '#cf222e' }}>── Red marker</span>: First upper sidelobe at 18 dB below main-beam peak.
              </p>
            )}
            {metric.id === 'fb' && (
              <p className="book-chart-note">
                <span style={{ color: '#cf222e' }}>── Shaded back zone</span>: 180° ± 30° rear window; worst level is 28 dB below peak.
              </p>
            )}
            {metric.id === 'tracking' && (
              <p className="book-chart-note">
                <span style={{ color: '#0969da' }}>── Blue (+45°)</span> and <span style={{ color: '#cf222e' }}>── Red (−45°)</span>: Tracking distortion measured across the ±60° sector.
              </p>
            )}
            {metric.id === 'squint' && (
              <p className="book-chart-note">
                <span style={{ color: '#cf222e' }}>── Red line</span>: Midpoint of 3 dB points shifted +1.2° right of 0° boresight.
              </p>
            )}
            {metric.id === 'nullfill' && (
              <p className="book-chart-note">
                <span style={{ color: '#cf222e' }}>── Red marker</span>: First null below main beam is 24 dB below peak (depth of null).
              </p>
            )}
            {metric.id === 'hsls' && (
              <p className="book-chart-note">
                <span style={{ color: '#8a5a00' }}>── Sector markers</span>: Checked for in-sector lobes inside the ±60° azimuth span.
              </p>
            )}
            {metric.id === 'spr' && (
              <p className="book-chart-note">
                <span style={{ color: '#1f883d' }}>── Green</span>: Power inside ±60° sector &ensp;·&ensp; <span style={{ color: '#d29922' }}>── Amber</span>: Power spilled outside.
              </p>
            )}
          </>
        )}
      </div>

      {/* Right: text column */}
      <div className="book-page-text-col">
        <h2 className="book-metric-name">{metric.name}</h2>

        <div className="book-field">
          <h3 className="book-field-label">Definition</h3>
          <p className="book-field-value">{metric.definition}</p>
        </div>

        <div className="book-field">
          <h3 className="book-field-label">What's it for?</h3>
          <p className="book-field-value">{metric.whatFor}</p>
        </div>

        <div className="book-field book-field-unit">
          <h3 className="book-field-label">Unit of measure</h3>
          <p className="book-field-value">{metric.unit}</p>
        </div>
      </div>
    </div>
  );
}
