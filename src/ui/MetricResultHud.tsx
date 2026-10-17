import { useState } from 'react';
import type { PatternMetrics } from '../core/analysis/metrics';
import { ENCYC_METRICS } from './metricEncycData';
import { METRIC_COLORS, useMetricInspectorStore } from './metricInspectorState';
import { middleEllipsis } from './legend';

interface MetricResultHudProps {
  targetId: string | null;
  targetName?: string | null;
  metrics: Map<string, PatternMetrics>;
  sectorEdgeDeg: number;
  fbWindowDeg: number;
  uslsRangeDeg: number;
  onOpenEncyclopedia?: (index: number) => void;
}

/**
 * Floating Live Result HUD displayed on the graph area when a metric is focused.
 * Shows the exact real-time calculated value, measurement context, and quick links.
 */
export function MetricResultHud({
  targetId,
  targetName,
  metrics,
  sectorEdgeDeg,
  fbWindowDeg,
  uslsRangeDeg,
  onOpenEncyclopedia,
}: MetricResultHudProps) {
  const focusedMetric = useMetricInspectorStore((s) => s.focusedMetric);
  const setFocusedMetric = useMetricInspectorStore((s) => s.setFocusedMetric);
  const [minimized, setMinimized] = useState(false);

  if (!focusedMetric || !targetId) return null;

  const m = metrics.get(targetId);
  if (!m) return null;

  const metricDef = ENCYC_METRICS.find((x) => x.id === focusedMetric);
  const colorDef = METRIC_COLORS[focusedMetric];
  const metricIndex = ENCYC_METRICS.findIndex((x) => x.id === focusedMetric);

  let primaryValue = '—';
  let unit = metricDef?.unit ?? '';
  let detailLine = '';

  switch (focusedMetric) {
    case 'hpbw': {
      primaryValue = m.h.hpbw.value !== null ? m.h.hpbw.value.toFixed(1) : '—';
      const edges = m.h.edges
        ? `[${m.h.edges[0] > 0 ? '+' : ''}${m.h.edges[0].toFixed(1)}°, ${m.h.edges[1] > 0 ? '+' : ''}${m.h.edges[1].toFixed(1)}°]`
        : '—';
      detailLine = `−3 dB Edges: ${edges} · 10 dB BW: ${m.hBw10.value !== null ? `${m.hBw10.value.toFixed(1)}°` : '—'} · Azimuth Peak: ${m.hPeak.value !== null ? `${m.hPeak.value.toFixed(1)}°` : '—'}`;
      break;
    }
    case 'rolloff':
      primaryValue = m.rollOff.value !== null ? m.rollOff.value.toFixed(1) : '—';
      detailLine = `Worst edge at ±${sectorEdgeDeg}°: ${primaryValue} dB · −${sectorEdgeDeg}°: ${m.rollOffEdges[0]?.toFixed(1) ?? '—'} dB, +${sectorEdgeDeg}°: ${m.rollOffEdges[1]?.toFixed(1) ?? '—'} dB`;
      break;
    case 'vhpbw': {
      primaryValue = m.v.hpbw.value !== null ? m.v.hpbw.value.toFixed(1) : '—';
      const edges = m.v.edges
        ? `[${m.v.edges[0] > 0 ? '+' : ''}${m.v.edges[0].toFixed(1)}°, ${m.v.edges[1] > 0 ? '+' : ''}${m.v.edges[1].toFixed(1)}°]`
        : '—';
      detailLine = `−3 dB Edges: ${edges} · 10 dB BW: ${m.vBw10.value !== null ? `${m.vBw10.value.toFixed(1)}°` : '—'} · Tilt: ${m.tilt.value !== null ? `${m.tilt.value.toFixed(1)}°` : '—'}`;
      break;
    }
    case 'usls': {
      primaryValue = m.firstUsls.value !== null ? m.firstUsls.value.toFixed(1) : '—';
      const angleStr = m.firstUsls.angle !== undefined ? ` (at ${m.firstUsls.angle > 0 ? '+' : ''}${m.firstUsls.angle.toFixed(1)}°)` : '';
      detailLine = `First USLS: ${primaryValue} dB${angleStr} · Peak to ${uslsRangeDeg}°: ${m.usls.value !== null ? `${m.usls.value.toFixed(1)} dB` : '—'} · Horizon to ${uslsRangeDeg}°: ${m.uslsHorizon.value !== null ? `${m.uslsHorizon.value.toFixed(1)} dB` : '—'}`;
      break;
    }
    case 'fb': {
      primaryValue = m.fbWindow.value !== null ? m.fbWindow.value.toFixed(1) : '—';
      const angleStr = m.fbWindow.angle !== undefined ? ` (at ${m.fbWindow.angle > 0 ? '+' : ''}${m.fbWindow.angle.toFixed(1)}°)` : '';
      detailLine = `F/B window ±${fbWindowDeg}°: ${primaryValue} dB${angleStr} · 180°: ${m.fb180.value !== null ? `${m.fb180.value.toFixed(1)} dB` : '—'}`;
      break;
    }
    case 'tracking': {
      primaryValue = m.beamTracking.value !== null ? m.beamTracking.value.toFixed(1) : '—';
      const edgeVals = m.trackingEdges?.values
        ? ` · Edges [−${sectorEdgeDeg}°, +${sectorEdgeDeg}°]: [${m.trackingEdges.values[0].toFixed(1)} dB, ${m.trackingEdges.values[1].toFixed(1)} dB]`
        : '';
      detailLine = `Max P2P tracking distortion: ${primaryValue} dB within ±${sectorEdgeDeg}° sector${edgeVals}`;
      break;
    }
    case 'squint': {
      primaryValue = m.squint.value !== null ? m.squint.value.toFixed(1) : '—';
      detailLine = `Squint offset: ${primaryValue}° from boresight · Peak azimuth: ${m.hPeak.value !== null ? `${m.hPeak.value.toFixed(1)}°` : '—'}`;
      break;
    }
    case 'nullfill': {
      primaryValue = m.nullFill.value !== null ? m.nullFill.value.toFixed(1) : '—';
      const nfAngle = m.nullFill.angle !== undefined ? ` (at ${m.nullFill.angle > 0 ? '+' : ''}${m.nullFill.angle.toFixed(1)}°)` : '';
      const lslsAngle = m.firstLsls.angle !== undefined ? ` (at ${m.firstLsls.angle > 0 ? '+' : ''}${m.firstLsls.angle.toFixed(1)}°)` : '';
      detailLine = `First null: ${primaryValue} dB${nfAngle} · First LSLS: ${m.firstLsls.value !== null ? `${m.firstLsls.value.toFixed(1)} dB${lslsAngle}` : '—'}`;
      break;
    }
    case 'du':
      primaryValue = m.du.qam16.value !== null ? `${m.du.qam16.value.toFixed(1)}°` : '—';
      unit = '';
      detailLine = `16QAM: ${m.du.qam16.value !== null ? `${m.du.qam16.value.toFixed(1)}°` : '—'} · 64QAM: ${m.du.qam64.value !== null ? `${m.du.qam64.value.toFixed(1)}°` : '—'} · 256QAM: ${m.du.qam256.value !== null ? `${m.du.qam256.value.toFixed(1)}°` : '—'}`;
      break;
    case 'hsls': {
      primaryValue = m.hSls.value !== null ? m.hSls.value.toFixed(1) : '—';
      const hslsAngle = m.hSls.angle !== undefined ? ` (at ${m.hSls.angle > 0 ? '+' : ''}${m.hSls.angle.toFixed(1)}°)` : '';
      detailLine = `Highest sidelobe within ±${sectorEdgeDeg}° sector: ${primaryValue} dB${hslsAngle}`;
      break;
    }
    case 'spr':
      primaryValue = m.spr.value !== null ? m.spr.value.toFixed(1) : '—';
      detailLine = `Sector Power Ratio: ${primaryValue} % · AIR: ${m.air.value !== null ? `${m.air.value.toFixed(1)} dB` : '—'}`;
      break;
  }

  const displayName = targetName ? middleEllipsis(targetName, 24) : targetId;

  if (minimized) {
    return (
      <div
        className="metric-hud-minimized"
        onClick={() => setMinimized(false)}
        title="Click to expand metric results HUD"
        style={{ borderColor: colorDef?.accent }}
      >
        <span className="hud-dot" style={{ backgroundColor: colorDef?.accent }} />
        <span className="hud-mini-name">{metricDef?.name ?? focusedMetric}:</span>
        <span className="hud-mini-val">
          {primaryValue} {unit}
        </span>
        <span className="hud-mini-expand">▾</span>
      </div>
    );
  }

  return (
    <div
      className="metric-result-bar"
      role="region"
      aria-label="Metric calculation result"
      style={{
        borderLeft: `4px solid ${colorDef?.accent ?? 'var(--accent)'}`,
        backgroundColor: colorDef?.bg ?? 'var(--panel)',
      }}
    >
      <div className="bar-main-row">
        <div className="bar-tag-info">
          <span className="hud-dot" style={{ backgroundColor: colorDef?.accent ?? 'var(--accent)' }} />
          <span className="hud-title">{metricDef?.name ?? focusedMetric}</span>
          <span className="hud-cut-badge">{metricDef?.cut === 'H' ? 'H-Cut' : 'V-Cut'}</span>
          <span className="bar-sep">·</span>
          <span className="hud-file-target" title={targetName ?? targetId}>
            Antenna: <strong>{displayName}</strong>
          </span>
        </div>

        <div className="bar-value-block">
          <span className="bar-val-label">Result:</span>
          <span className="hud-value" style={{ color: colorDef?.accent ?? 'var(--fg)' }}>
            {primaryValue}
          </span>
          {unit && <span className="hud-unit">{unit}</span>}
        </div>

        <div className="bar-actions">
          {onOpenEncyclopedia && metricIndex >= 0 && (
            <button
              type="button"
              className="hud-book-btn"
              onClick={() => onOpenEncyclopedia(metricIndex)}
              title="Open metric definition and visual guide in Encyclopedia"
            >
              📖 Encyclopedia
            </button>
          )}
          <button
            type="button"
            className="hud-ctrl-btn"
            onClick={() => setFocusedMetric(null)}
            title="Clear metric focus"
            aria-label="Clear metric focus"
          >
            ✕
          </button>
        </div>
      </div>

      {detailLine && <div className="hud-detail">{detailLine}</div>}
    </div>
  );
}
