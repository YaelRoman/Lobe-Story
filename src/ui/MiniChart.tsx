import { useEffect, useRef } from 'react';
import type { Shape } from 'plotly.js';
import Plotly from 'plotly.js-dist-min';
import type { Data as PlotlyNativeData, Layout as PlotlyNativeLayout } from 'plotly.js-dist-min';
import { exampleSpec } from '../core/exampleSet';
import { useStore } from '../state/store';
import { FIGURE_THEMES } from './figureTheme';
import { verticalAngleTicks } from './cutFigure';
import type { EncycMetric, EncycMode } from './metricEncycData';

/** Helper to generate continuous integer angle arrays for smooth polar arcs/sectors. */
function arc(from: number, to: number, step = 1): number[] {
  const out: number[] = [];
  if (from <= to) {
    for (let a = from; a <= to; a += step) out.push(a);
  } else {
    for (let a = from; a >= to; a -= step) out.push(a);
  }
  return out;
}

/** Builds the raw cut data arrays for the example antenna at 1800 MHz, 5° tilt. */
function buildExampleCut(cut: 'H' | 'V', pol: 1 | -1 = 1): { angles: number[]; atten: number[] } {
  const s = exampleSpec(1795, 5, pol);
  const W = s.hBeamwidthDeg;
  const B = s.vBeamwidthDeg;
  const tilt = s.tiltDeg;

  const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
  const signed = (a: number) => (a > 180 ? a - 360 : a);
  const amp = (db: number) => 10 ** (-db / 20);
  const gauss = (x: number, c: number, w: number) => Math.exp(-((wrap(x - c) / w) ** 2));
  const mainBeam = (x: number, center: number, width: number) => amp(12 * ((x - center) / width) ** 2);
  const floor = 45;

  const raw: number[] = [];
  if (cut === 'H') {
    const backLevel = s.frontToBackDb + 2;
    const lobes = [
      { at: -78, db: 24, w: 14, sign: -1 as const },
      { at: 78, db: 25, w: 14, sign: -1 as const },
      { at: -122, db: 28, w: 18, sign: 1 as const },
      { at: 125, db: 29, w: 18, sign: 1 as const },
      { at: 180, db: backLevel, w: 38, sign: -1 as const },
    ];
    for (let a = 0; a < 360; a++) {
      const x = signed(a);
      let v = mainBeam(x, s.hCenterDeg, W);
      for (const l of lobes) v += l.sign * amp(l.db) * gauss(x, l.at, l.w);
      raw.push(v);
    }
  } else {
    const lobes = [
      { at: -1.55, db: 18, w: 0.45, sign: -1 as const },
      { at: 1.6, db: 17, w: 0.45, sign: -1 as const },
      { at: -2.7, db: 22, w: 0.55, sign: 1 as const },
      { at: 2.85, db: 23, w: 0.55, sign: 1 as const },
      { at: -4.4, db: 28, w: 0.8, sign: -1 as const },
      { at: 4.6, db: 29, w: 0.8, sign: -1 as const },
    ];
    for (let a = 0; a < 360; a++) {
      const x = signed(a);
      let v = mainBeam(x, tilt, B);
      for (const l of lobes) v += l.sign * amp(l.db) * gauss(x, tilt + l.at * B, l.w * B);
      v += amp(36) * gauss(x, 180, 40);
      raw.push(v);
    }
  }

  const att = raw.map(v => -20 * Math.log10(Math.max(Math.abs(v), amp(floor))));
  const min = Math.min(...att);
  const pairs: [number, number][] = [];
  for (let a = 0; a < 360; a++) {
    pairs.push([signed(a), Number((att[a] - min).toFixed(2))]);
  }
  pairs.sort((p, q) => p[0] - q[0]);
  return { angles: pairs.map(p => p[0]), atten: pairs.map(p => p[1]) };
}

export interface MiniChartProps {
  metric: EncycMetric;
  /** Explicit mode override; defaults to metric.mode */
  mode?: EncycMode;
  duKey?: 'qam16' | 'qam64' | 'qam256' | 'all';
}

/**
 * A clean Plotly chart showing the relevant cut with clear metric-specific annotations.
 * Supports both Polar and Rectangular representations for all metrics.
 * Strictly highlights ONLY the metric being explained to avoid user confusion.
 */
export function MiniChart({ metric, mode: propMode, duKey }: MiniChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useStore(s => s.view.theme);
  const ft = FIGURE_THEMES[theme];
  const activeMode: EncycMode = propMode ?? metric.mode;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const { angles, atten } = buildExampleCut(metric.cut, 1);
    const floorDb = 45;
    const y = atten.map(v => -v);
    const isPolar = activeMode === 'polar';
    const isVertical = metric.cut === 'V';

    const traces: PlotlyNativeData[] = [];
    const shapes: Partial<Shape>[] = [];
    const annotations: Partial<Plotly.Annotations>[] = [];

    // Main trace
    if (isPolar) {
      traces.push({
        type: 'scatterpolar',
        mode: 'lines',
        theta: [...angles, angles[0]],
        r: [...y, y[0]],
        line: { color: '#0969da', width: 2.2 },
        name: metric.id === 'tracking' ? '+45° port' : 'Radiation pattern',
        hovertemplate: '%{theta:.0f}°  %{r:.1f} dB<extra></extra>',
      } as unknown as PlotlyNativeData);
    } else {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        x: angles,
        y,
        line: { color: '#0969da', width: 2.2 },
        name: metric.id === 'tracking' ? '+45° port' : 'Radiation pattern',
        hovertemplate: '%{x:.0f}°  %{y:.1f} dB<extra></extra>',
      } as unknown as PlotlyNativeData);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Metric-specific custom annotations (Both Polar & Rectangular)
    // ─────────────────────────────────────────────────────────────────────────

    // 1. Roll-off: strictly mark ONLY ±60°
    if (metric.id === 'rolloff') {
      if (isPolar) {
        [-60, 60].forEach(deg => {
          const idx = angles.indexOf(deg);
          const levelAtDeg = idx >= 0 ? y[idx] : -10.5;
          traces.push({
            type: 'scatterpolar',
            mode: 'lines',
            theta: [deg, deg],
            r: [-floorDb, 0],
            line: { color: '#cf222e', dash: 'dash', width: 2 },
            hoverinfo: 'none',
            showlegend: false,
          } as unknown as PlotlyNativeData);
          traces.push({
            type: 'scatterpolar',
            mode: 'markers+text',
            theta: [deg],
            r: [levelAtDeg],
            marker: { color: '#cf222e', size: 9, symbol: 'circle' },
            text: [`<b>${deg > 0 ? '+' : ''}${deg}°: ${levelAtDeg.toFixed(1)} dB</b>`],
            textposition: deg > 0 ? 'top right' : 'top left',
            textfont: { color: '#cf222e', size: 11 },
            hovertemplate: `<b>Roll-off Edge: ${deg > 0 ? '+' : ''}${deg}°</b><br>Level: ${levelAtDeg.toFixed(1)} dB<extra></extra>`,
            hoverlabel: { bgcolor: ft.bg, bordercolor: '#cf222e', font: { color: ft.fg, size: 12 } },
            showlegend: false,
          } as unknown as PlotlyNativeData);
        });
      } else {
        const edgeLevels = [-60, 60].map(deg => {
          const idx = angles.indexOf(deg);
          return idx >= 0 ? y[idx] : -10.5;
        });
        traces.push({
          type: 'scatter',
          mode: 'markers',
          x: [-60, 60],
          y: edgeLevels,
          marker: { color: '#cf222e', size: 9, symbol: 'circle' },
          hovertemplate: '<b>Roll-off Edge (%{x:+.0f}°)</b><br>Level: %{y:.1f} dB<extra></extra>',
          hoverlabel: { bgcolor: ft.bg, bordercolor: '#cf222e', font: { color: ft.fg, size: 12 } },
          showlegend: false,
        } as unknown as PlotlyNativeData);
        [-60, 60].forEach(deg => {
          const idx = angles.indexOf(deg);
          const levelAtDeg = idx >= 0 ? y[idx] : -10.5;
          shapes.push({
            type: 'line', xref: 'x', yref: 'paper',
            x0: deg, x1: deg, y0: 0, y1: 1,
            line: { color: '#cf222e', dash: 'dash', width: 2 },
          });
          annotations.push({
            x: deg, y: levelAtDeg, xref: 'x', yref: 'y',
            text: `<b>${deg > 0 ? '+' : ''}${deg}°: ${levelAtDeg.toFixed(1)} dB</b>`,
            showarrow: true,
            arrowhead: 2,
            arrowcolor: '#cf222e',
            font: { color: '#cf222e', size: 11 },
            bgcolor: ft.bg,
            bordercolor: '#cf222e',
            borderwidth: 1,
          });
        });
      }
    }

    // 2. HPBW: -3 dB beamwidth
    else if (metric.id === 'hpbw') {
      if (isPolar) {
        // Sector wedge
        const thetaWedge = arc(-33, 33);
        traces.push({
          type: 'scatterpolar',
          mode: 'lines',
          theta: [-33, ...thetaWedge, 33],
          r: [-floorDb, ...thetaWedge.map(() => 0), -floorDb],
          fill: 'toself',
          fillcolor: 'rgba(207, 34, 46, 0.15)',
          line: { width: 0 },
          hoverinfo: 'none',
          showlegend: false,
        } as unknown as PlotlyNativeData);
        // -3 dB ring
        const circle = arc(0, 360, 2);
        traces.push({
          type: 'scatterpolar',
          mode: 'lines',
          theta: circle,
          r: circle.map(() => -3),
          line: { color: '#cf222e', dash: 'dash', width: 1.5 },
          hoverinfo: 'none',
          showlegend: false,
        } as unknown as PlotlyNativeData);
        // Rays
        [-33, 33].forEach(deg => {
          traces.push({
            type: 'scatterpolar',
            mode: 'lines',
            theta: [deg, deg],
            r: [-floorDb, 0],
            line: { color: '#cf222e', dash: 'dot', width: 1.5 },
            hoverinfo: 'none',
            showlegend: false,
          } as unknown as PlotlyNativeData);
        });
        // Markers
        traces.push({
          type: 'scatterpolar',
          mode: 'markers+text',
          theta: [-33, 33],
          r: [-3, -3],
          marker: { color: '#cf222e', size: 8, symbol: 'circle' },
          text: ['−33° (−3 dB)', '+33° (−3 dB) · HPBW = 66°'],
          textposition: ['top left', 'top right'],
          textfont: { color: '#cf222e', size: 11 },
          hovertemplate: '<b>HPBW Edge (%{theta:+.0f}°)</b><br>Level: %{r:.1f} dB<extra></extra>',
          hoverlabel: { bgcolor: ft.bg, bordercolor: '#cf222e', font: { color: ft.fg, size: 12 } },
          showlegend: false,
        } as unknown as PlotlyNativeData);
      } else {
        shapes.push({
          type: 'line', xref: 'paper', yref: 'y',
          x0: 0, x1: 1, y0: -3, y1: -3,
          line: { color: '#cf222e', dash: 'dash', width: 1.5 },
        });
        [-33, 33].forEach(deg => {
          shapes.push({
            type: 'line', xref: 'x', yref: 'paper',
            x0: deg, x1: deg, y0: 0, y1: 1,
            line: { color: '#cf222e', dash: 'dot', width: 1.5 },
          });
        });
        shapes.push({
          type: 'rect', xref: 'x', yref: 'paper',
          x0: -33, x1: 33, y0: 0, y1: 1,
          fillcolor: '#cf222e', opacity: 0.12,
          line: { width: 0 },
        });
        traces.push({
          type: 'scatter',
          mode: 'markers',
          x: [-33, 33],
          y: [-3, -3],
          marker: { color: '#cf222e', size: 8, symbol: 'circle' },
          hovertemplate: '<b>HPBW Edge (%{x:+.0f}°)</b><br>Level: %{y:.1f} dB<extra></extra>',
          hoverlabel: { bgcolor: ft.bg, bordercolor: '#cf222e', font: { color: ft.fg, size: 12 } },
          showlegend: false,
        } as unknown as PlotlyNativeData);
        annotations.push({
          x: -33, y: -3, xref: 'x', yref: 'y',
          text: '<b>−33° (−3 dB)</b>',
          showarrow: true,
          arrowhead: 2,
          arrowcolor: '#cf222e',
          font: { color: '#cf222e', size: 11 },
          bgcolor: ft.bg,
          bordercolor: '#cf222e',
          borderwidth: 1,
        });
        annotations.push({
          x: 33, y: -3, xref: 'x', yref: 'y',
          text: '<b>+33° (−3 dB)</b>',
          showarrow: true,
          arrowhead: 2,
          arrowcolor: '#cf222e',
          font: { color: '#cf222e', size: 11 },
          bgcolor: ft.bg,
          bordercolor: '#cf222e',
          borderwidth: 1,
        });
        annotations.push({
          x: 0, y: -3, xref: 'x', yref: 'y',
          text: '<b>HPBW = 66° (span)</b>',
          showarrow: false,
          font: { color: '#cf222e', size: 11 },
          bgcolor: ft.bg,
        });
      }
    }

    // 3. V-HPBW: Vertical beamwidth around 5° tilt
    else if (metric.id === 'vhpbw') {
      if (isPolar) {
        // Shaded wedge 0.7° to 9.3°
        const thetaWedge = [0.7, 2, 4, 6, 8, 9.3];
        traces.push({
          type: 'scatterpolar',
          mode: 'lines',
          theta: [0.7, ...thetaWedge, 9.3],
          r: [-floorDb, ...thetaWedge.map(() => 0), -floorDb],
          fill: 'toself',
          fillcolor: 'rgba(207, 34, 46, 0.18)',
          line: { width: 0 },
          hoverinfo: 'none',
          showlegend: false,
        } as unknown as PlotlyNativeData);
        // -3 dB circle
        const circle = arc(0, 360, 2);
        traces.push({
          type: 'scatterpolar',
          mode: 'lines',
          theta: circle,
          r: circle.map(() => -3),
          line: { color: '#cf222e', dash: 'dash', width: 1.5 },
          hoverinfo: 'none',
          showlegend: false,
        } as unknown as PlotlyNativeData);
        // Horizon line at 0°
        traces.push({
          type: 'scatterpolar',
          mode: 'lines',
          theta: [0, 0],
          r: [-floorDb, 0],
          line: { color: ft.fg, width: 1.2 },
          hoverinfo: 'none',
          showlegend: false,
        } as unknown as PlotlyNativeData);
        // Tilt ray at 5°
        traces.push({
          type: 'scatterpolar',
          mode: 'lines',
          theta: [5, 5],
          r: [-floorDb, 0],
          line: { color: '#cf222e', dash: 'dot', width: 1.5 },
          hoverinfo: 'none',
          showlegend: false,
        } as unknown as PlotlyNativeData);
        // -3 dB boundary markers
        traces.push({
          type: 'scatterpolar',
          mode: 'markers+text',
          theta: [0.7, 9.3],
          r: [-3, -3],
          marker: { color: '#cf222e', size: 8, symbol: 'circle' },
          text: ['+0.7° (−3 dB)', '+9.3° (−3 dB)'],
          textposition: ['top left', 'top right'],
          textfont: { color: '#cf222e', size: 11 },
          hoverinfo: 'none',
          showlegend: false,
        } as unknown as PlotlyNativeData);
        // Peak marker
        traces.push({
          type: 'scatterpolar',
          mode: 'markers+text',
          theta: [5],
          r: [0],
          marker: { color: '#cf222e', size: 8, symbol: 'circle' },
          text: ['<b>Tilt 5° · V-HPBW = 8.6°</b>'],
          textposition: 'bottom right',
          textfont: { color: '#cf222e', size: 11 },
          hoverinfo: 'none',
          showlegend: false,
        } as unknown as PlotlyNativeData);
      } else {
        shapes.push({
          type: 'line', xref: 'paper', yref: 'y',
          x0: 0, x1: 1, y0: -3, y1: -3,
          line: { color: '#cf222e', dash: 'dash', width: 1.5 },
        });
        [0.7, 9.3].forEach(deg => {
          shapes.push({
            type: 'line', xref: 'x', yref: 'paper',
            x0: deg, x1: deg, y0: 0, y1: 1,
            line: { color: '#cf222e', dash: 'dot', width: 1.5 },
          });
        });
        shapes.push({
          type: 'rect', xref: 'x', yref: 'paper',
          x0: 0.7, x1: 9.3, y0: 0, y1: 1,
          fillcolor: '#cf222e', opacity: 0.12,
          line: { width: 0 },
        });
        annotations.push({
          x: 0.7, y: -3, xref: 'x', yref: 'y',
          text: '<b>+0.7° (−3 dB)</b>',
          showarrow: true,
          arrowhead: 2,
          arrowcolor: '#cf222e',
          font: { color: '#cf222e', size: 11 },
          bgcolor: ft.bg,
          bordercolor: '#cf222e',
          borderwidth: 1,
        });
        annotations.push({
          x: 9.3, y: -3, xref: 'x', yref: 'y',
          text: '<b>+9.3° (−3 dB)</b>',
          showarrow: true,
          arrowhead: 2,
          arrowcolor: '#cf222e',
          font: { color: '#cf222e', size: 11 },
          bgcolor: ft.bg,
          bordercolor: '#cf222e',
          borderwidth: 1,
        });
        annotations.push({
          x: 5, y: -3, xref: 'x', yref: 'y',
          text: '<b>V-HPBW = 8.6° (at tilt 5°)</b>',
          showarrow: false,
          font: { color: '#cf222e', size: 11 },
          bgcolor: ft.bg,
        });
      }
    }

    // 4. USLS: Upper Side Lobe Suppression
    else if (metric.id === 'usls') {
      if (isPolar) {
        // Horizon mark at 0°
        traces.push({
          type: 'scatterpolar',
          mode: 'lines',
          theta: [0, 0],
          r: [-floorDb, 0],
          line: { color: ft.fg, width: 1 },
          hoverinfo: 'none',
          showlegend: false,
        } as unknown as PlotlyNativeData);
        // Level ring at -18 dB
        const circle = arc(0, 360, 2);
        traces.push({
          type: 'scatterpolar',
          mode: 'lines',
          theta: circle,
          r: circle.map(() => -18),
          line: { color: '#cf222e', dash: 'dash', width: 1 },
          hoverinfo: 'none',
          showlegend: false,
        } as unknown as PlotlyNativeData);
        // Sidelobe ray at -9°
        traces.push({
          type: 'scatterpolar',
          mode: 'lines',
          theta: [-9, -9],
          r: [-floorDb, 0],
          line: { color: '#cf222e', dash: 'dot', width: 1.5 },
          hoverinfo: 'none',
          showlegend: false,
        } as unknown as PlotlyNativeData);
        // Sidelobe marker
        traces.push({
          type: 'scatterpolar',
          mode: 'markers+text',
          theta: [-9],
          r: [-18],
          marker: { color: '#cf222e', size: 10, symbol: 'x' },
          text: ['<b>1st USLS: 18.0 dB (−9°)</b>'],
          textposition: 'top left',
          textfont: { color: '#cf222e', size: 11 },
          hovertemplate: '<b>First USLS: 18.0 dB below peak</b><br>Angle: −9.0° · Level: −18.0 dB<extra></extra>',
          hoverlabel: { bgcolor: ft.bg, bordercolor: '#cf222e', font: { color: ft.fg, size: 12 } },
          showlegend: false,
        } as unknown as PlotlyNativeData);
      } else {
        shapes.push({
          type: 'line', xref: 'paper', yref: 'y',
          x0: 0, x1: 1, y0: -18, y1: -18,
          line: { color: '#cf222e', dash: 'dash', width: 1.5 },
        });
        shapes.push({
          type: 'line', xref: 'x', yref: 'paper',
          x0: -9, x1: -9, y0: 0, y1: 1,
          line: { color: '#cf222e', dash: 'dot', width: 1.5 },
        });
        traces.push({
          type: 'scatter',
          mode: 'markers',
          x: [-9],
          y: [-18],
          marker: { color: '#cf222e', size: 10, symbol: 'x' },
          hovertemplate: '<b>First USLS: 18.0 dB below peak</b><br>Angle: −9.0° · Level: −18.0 dB<extra></extra>',
          hoverlabel: { bgcolor: ft.bg, bordercolor: '#cf222e', font: { color: ft.fg, size: 12 } },
          showlegend: false,
        } as unknown as PlotlyNativeData);
        annotations.push({
          x: -9, y: -18, xref: 'x', yref: 'y',
          text: '<b>First USLS: 18.0 dB below peak (−9°)</b>',
          showarrow: true,
          arrowhead: 2,
          arrowcolor: '#cf222e',
          font: { color: '#cf222e', size: 11 },
          bgcolor: ft.bg,
          bordercolor: '#cf222e',
          borderwidth: 1,
        });
      }
    }

    // 5. Front-to-Back: 180° ± 30° window
    else if (metric.id === 'fb') {
      if (isPolar) {
        // Shaded rear sector 150° to 210°
        const thetaWedge = arc(150, 210);
        traces.push({
          type: 'scatterpolar',
          mode: 'lines',
          theta: [150, ...thetaWedge, 210],
          r: [-floorDb, ...thetaWedge.map(() => 0), -floorDb],
          fill: 'toself',
          fillcolor: 'rgba(207, 34, 46, 0.15)',
          line: { width: 0 },
          hoverinfo: 'none',
          showlegend: false,
        } as unknown as PlotlyNativeData);
        // Rear boundary rays
        [150, 210].forEach(deg => {
          traces.push({
            type: 'scatterpolar',
            mode: 'lines',
            theta: [deg, deg],
            r: [-floorDb, 0],
            line: { color: '#cf222e', dash: 'dot', width: 1.5 },
            hoverinfo: 'none',
            showlegend: false,
          } as unknown as PlotlyNativeData);
        });
        // Arc at -28 dB level
        traces.push({
          type: 'scatterpolar',
          mode: 'lines',
          theta: arc(150, 210),
          r: arc(150, 210).map(() => -28),
          line: { color: '#cf222e', dash: 'dash', width: 2 },
          hoverinfo: 'none',
          showlegend: false,
        } as unknown as PlotlyNativeData);
        // Marker at 180°
        traces.push({
          type: 'scatterpolar',
          mode: 'markers+text',
          theta: [180],
          r: [-28],
          marker: { color: '#cf222e', size: 10, symbol: 'x' },
          text: ['<b>F/B ±30°: 28.0 dB (180°)</b>'],
          textposition: 'bottom center',
          textfont: { color: '#cf222e', size: 11 },
          hovertemplate: '<b>Front-to-Back (F/B ±30°): 28.0 dB</b><br>Angle: 180.0° · Level: −28.0 dB<extra></extra>',
          hoverlabel: { bgcolor: ft.bg, bordercolor: '#cf222e', font: { color: ft.fg, size: 12 } },
          showlegend: false,
        } as unknown as PlotlyNativeData);
      } else {
        shapes.push({
          type: 'rect', xref: 'x', yref: 'paper',
          x0: -180, x1: -150, y0: 0, y1: 1,
          fillcolor: '#cf222e', opacity: 0.15,
          line: { width: 0 },
        });
        shapes.push({
          type: 'rect', xref: 'x', yref: 'paper',
          x0: 150, x1: 180, y0: 0, y1: 1,
          fillcolor: '#cf222e', opacity: 0.15,
          line: { width: 0 },
        });
        shapes.push({
          type: 'line', xref: 'paper', yref: 'y',
          x0: 0, x1: 1, y0: -28, y1: -28,
          line: { color: '#cf222e', dash: 'dash', width: 1.5 },
        });
        traces.push({
          type: 'scatter',
          mode: 'markers',
          x: [180],
          y: [-28],
          marker: { color: '#cf222e', size: 10, symbol: 'x' },
          hovertemplate: '<b>Front-to-Back (F/B ±30°): 28.0 dB</b><br>Angle: 180.0° · Level: −28.0 dB<extra></extra>',
          hoverlabel: { bgcolor: ft.bg, bordercolor: '#cf222e', font: { color: ft.fg, size: 12 } },
          showlegend: false,
        } as unknown as PlotlyNativeData);
        annotations.push({
          x: 180, y: -28, xref: 'x', yref: 'y',
          text: '<b>F/B ±30°: 28.0 dB (at 180°)</b>',
          showarrow: true,
          arrowhead: 2,
          arrowcolor: '#cf222e',
          font: { color: '#cf222e', size: 11 },
          bgcolor: ft.bg,
          bordercolor: '#cf222e',
          borderwidth: 1,
        });
      }
    }

    // 6. Tracking: difference between +45° and -45° ports
    else if (metric.id === 'tracking') {
      const cutM = buildExampleCut('H', -1);
      if (isPolar) {
        traces.push({
          type: 'scatterpolar',
          mode: 'lines',
          theta: [...cutM.angles, cutM.angles[0]],
          r: [...cutM.atten.map(v => -v), -cutM.atten[0]],
          line: { color: '#cf222e', width: 2, dash: 'dash' },
          name: '−45° port',
          hovertemplate: '%{theta:.0f}°  %{r:.1f} dB<extra></extra>',
        } as unknown as PlotlyNativeData);
        [-60, 60].forEach(deg => {
          traces.push({
            type: 'scatterpolar',
            mode: 'lines',
            theta: [deg, deg],
            r: [-floorDb, 0],
            line: { color: '#8a5a00', dash: 'dot', width: 1.5 },
            hoverinfo: 'none',
            showlegend: false,
          } as unknown as PlotlyNativeData);
        });
        traces.push({
          type: 'scatterpolar',
          mode: 'markers+text',
          theta: [40],
          r: [-12],
          marker: { color: '#cf222e', size: 10, symbol: 'x' },
          text: ['<b>Max P2P diff: 1.8 dB (+40°)</b>'],
          textposition: 'top right',
          textfont: { color: '#cf222e', size: 11 },
          hovertemplate: '<b>Max P2P Tracking Distortion: 1.8 dB</b><br>Angle: +40.0° · Level: −12.0 dB<extra></extra>',
          hoverlabel: { bgcolor: ft.bg, bordercolor: '#cf222e', font: { color: ft.fg, size: 12 } },
          showlegend: false,
        } as unknown as PlotlyNativeData);
      } else {
        traces.push({
          type: 'scatter',
          mode: 'lines',
          x: cutM.angles,
          y: cutM.atten.map(v => -v),
          line: { color: '#cf222e', width: 2, dash: 'dash' },
          name: '−45° port',
          hovertemplate: '%{x:.0f}°  %{y:.1f} dB<extra></extra>',
        } as unknown as PlotlyNativeData);
        [-60, 60].forEach(deg => {
          shapes.push({
            type: 'line', xref: 'x', yref: 'paper',
            x0: deg, x1: deg, y0: 0, y1: 1,
            line: { color: '#8a5a00', dash: 'dot', width: 1.5 },
          });
        });
        traces.push({
          type: 'scatter',
          mode: 'markers',
          x: [40],
          y: [-12],
          marker: { color: '#cf222e', size: 10, symbol: 'x' },
          hovertemplate: '<b>Max P2P Tracking Distortion: 1.8 dB</b><br>Angle: +40.0° · Level: −12.0 dB<extra></extra>',
          hoverlabel: { bgcolor: ft.bg, bordercolor: '#cf222e', font: { color: ft.fg, size: 12 } },
          showlegend: false,
        } as unknown as PlotlyNativeData);
        annotations.push({
          x: 40, y: -12, xref: 'x', yref: 'y',
          text: '<b>Max P2P tracking distortion: 1.8 dB (at +40°)</b>',
          showarrow: true,
          arrowhead: 2,
          arrowcolor: '#cf222e',
          font: { color: '#cf222e', size: 11 },
          bgcolor: ft.bg,
          bordercolor: '#cf222e',
          borderwidth: 1,
        });
      }
    }

    // 7. Squint: beam center offset relative to boresight
    else if (metric.id === 'squint') {
      if (isPolar) {
        traces.push({
          type: 'scatterpolar',
          mode: 'lines+text',
          theta: [0, 0],
          r: [-floorDb, 0],
          line: { color: ft.fg, width: 1.5 },
          text: ['', 'Boresight 0°'],
          textposition: 'top left',
          textfont: { color: ft.fg, size: 10 },
          hoverinfo: 'none',
          showlegend: false,
        } as unknown as PlotlyNativeData);
        traces.push({
          type: 'scatterpolar',
          mode: 'lines+text',
          theta: [1.2, 1.2],
          r: [-floorDb, 0],
          line: { color: '#cf222e', width: 2, dash: 'dash' },
          text: ['', '<b>Squint: +1.2°</b>'],
          textposition: 'top right',
          textfont: { color: '#cf222e', size: 11 },
          hovertemplate: '<b>Beam Squint</b><br>Offset: +1.2° from boresight<extra></extra>',
          hoverlabel: { bgcolor: ft.bg, bordercolor: '#cf222e', font: { color: ft.fg, size: 12 } },
          showlegend: false,
        } as unknown as PlotlyNativeData);
      } else {
        shapes.push({
          type: 'line', xref: 'x', yref: 'paper',
          x0: 0, x1: 0, y0: 0, y1: 1,
          line: { color: ft.fg, width: 1.5, dash: 'solid' },
        });
        shapes.push({
          type: 'line', xref: 'x', yref: 'paper',
          x0: 1.2, x1: 1.2, y0: 0, y1: 1,
          line: { color: '#cf222e', width: 2, dash: 'dash' },
        });
        traces.push({
          type: 'scatter',
          mode: 'lines',
          x: [1.2, 1.2],
          y: [-floorDb, 0],
          line: { color: '#cf222e', width: 2, dash: 'dash' },
          hovertemplate: '<b>Beam Squint</b><br>Offset: +1.2° from boresight<extra></extra>',
          hoverlabel: { bgcolor: ft.bg, bordercolor: '#cf222e', font: { color: ft.fg, size: 12 } },
          showlegend: false,
        } as unknown as PlotlyNativeData);
        annotations.push({
          x: 0, y: 0.96, xref: 'x', yref: 'paper',
          text: 'Boresight (0°)',
          showarrow: false,
          font: { color: ft.fg, size: 10 },
          bgcolor: ft.bg,
        });
        annotations.push({
          x: 1.2, y: 0.85, xref: 'x', yref: 'paper',
          text: '<b>Squint: +1.2°</b>',
          showarrow: true,
          arrowhead: 2,
          arrowcolor: '#cf222e',
          font: { color: '#cf222e', size: 11 },
          bgcolor: ft.bg,
        });
      }
    }

    // 8. Null Filling: first null below beam in vertical cut
    else if (metric.id === 'nullfill') {
      if (isPolar) {
        traces.push({
          type: 'scatterpolar',
          mode: 'lines',
          theta: [18.2, 18.2],
          r: [-floorDb, 0],
          line: { color: '#cf222e', dash: 'dot', width: 1.5 },
          hoverinfo: 'none',
          showlegend: false,
        } as unknown as PlotlyNativeData);
        traces.push({
          type: 'scatterpolar',
          mode: 'markers+text',
          theta: [18.2],
          r: [-24],
          marker: { color: '#cf222e', size: 10, symbol: 'x' },
          text: ['<b>1st null below beam: 24.0 dB (+18.2°)</b>'],
          textposition: 'bottom right',
          textfont: { color: '#cf222e', size: 11 },
          hovertemplate: '<b>First Null Below Beam: 24.0 dB</b><br>Angle: +18.2° · Level: −24.0 dB<extra></extra>',
          hoverlabel: { bgcolor: ft.bg, bordercolor: '#cf222e', font: { color: ft.fg, size: 12 } },
          showlegend: false,
        } as unknown as PlotlyNativeData);
      } else {
        shapes.push({
          type: 'line', xref: 'paper', yref: 'y',
          x0: 0, x1: 1, y0: -24, y1: -24,
          line: { color: '#cf222e', dash: 'dash', width: 1.5 },
        });
        shapes.push({
          type: 'line', xref: 'x', yref: 'paper',
          x0: 18.2, x1: 18.2, y0: 0, y1: 1,
          line: { color: '#cf222e', dash: 'dot', width: 1.5 },
        });
        traces.push({
          type: 'scatter',
          mode: 'markers',
          x: [18.2],
          y: [-24],
          marker: { color: '#cf222e', size: 10, symbol: 'x' },
          hovertemplate: '<b>First Null Below Beam: 24.0 dB</b><br>Angle: +18.2° · Level: −24.0 dB<extra></extra>',
          hoverlabel: { bgcolor: ft.bg, bordercolor: '#cf222e', font: { color: ft.fg, size: 12 } },
          showlegend: false,
        } as unknown as PlotlyNativeData);
        annotations.push({
          x: 18.2, y: -24, xref: 'x', yref: 'y',
          text: '<b>First null below beam: 24.0 dB (+18.2°)</b>',
          showarrow: true,
          arrowhead: 2,
          arrowcolor: '#cf222e',
          font: { color: '#cf222e', size: 11 },
          bgcolor: ft.bg,
          bordercolor: '#cf222e',
          borderwidth: 1,
        });
      }
    }

    // 9. D/U Aperture
    else if (metric.id === 'du') {
      const apertures: Record<string, { span: [number, number]; label: string; color: string }> = {
        qam16: { span: [-58, 58], label: '16QAM Aperture (≥ 15 dB): 116°', color: '#1f883d' },
        qam64: { span: [-46, 46], label: '64QAM Aperture (≥ 20 dB): 92°', color: '#0969da' },
        qam256: { span: [-35, 35], label: '256QAM Aperture (≥ 25 dB): 70°', color: '#8250df' },
      };

      if (isPolar) {
        if (duKey === 'all') {
          const qams = ['qam16', 'qam64', 'qam256'] as const;
          qams.forEach((k, idx) => {
            const item = apertures[k];
            const thetaArc = arc(item.span[0], item.span[1]);
            traces.push({
              type: 'scatterpolar',
              mode: 'lines',
              theta: thetaArc,
              r: thetaArc.map(() => -idx * 2),
              line: { color: item.color, width: 4 },
              name: item.label,
              hoverinfo: 'name',
              showlegend: true,
            } as unknown as PlotlyNativeData);
          });
        } else {
          const activeKey = duKey ?? 'qam16';
          const item = apertures[activeKey];
          if (item) {
            const thetaWedge = arc(item.span[0], item.span[1]);
            traces.push({
              type: 'scatterpolar',
              mode: 'lines',
              theta: [item.span[0], ...thetaWedge, item.span[1]],
              r: [-floorDb, ...thetaWedge.map(() => 0), -floorDb],
              fill: 'toself',
              fillcolor: `${item.color}2e`,
              line: { width: 0 },
              hoverinfo: 'none',
              showlegend: false,
            } as unknown as PlotlyNativeData);
            [item.span[0], item.span[1]].forEach(deg => {
              traces.push({
                type: 'scatterpolar',
                mode: 'lines',
                theta: [deg, deg],
                r: [-floorDb, 0],
                line: { color: item.color, dash: 'dash', width: 2 },
                hoverinfo: 'none',
                showlegend: false,
              } as unknown as PlotlyNativeData);
            });
            traces.push({
              type: 'scatterpolar',
              mode: 'lines',
              theta: thetaWedge,
              r: thetaWedge.map(() => 0),
              line: { color: item.color, width: 4 },
              name: item.label,
              hoverinfo: 'name',
              showlegend: true,
            } as unknown as PlotlyNativeData);
          }
        }
      } else {
        if (duKey === 'all') {
          const qams = ['qam16', 'qam64', 'qam256'] as const;
          qams.forEach((k, idx) => {
            const item = apertures[k];
            shapes.push({
              type: 'rect', xref: 'x', yref: 'paper',
              x0: item.span[0], x1: item.span[1],
              y0: 0.94 - idx * 0.08, y1: 0.99 - idx * 0.08,
              fillcolor: item.color, opacity: 0.85,
              line: { width: 0 },
            });
            annotations.push({
              x: item.span[1] + 4, y: 0.965 - idx * 0.08, xref: 'x', yref: 'paper',
              text: `<b>${item.label}</b>`,
              showarrow: false,
              xanchor: 'left',
              font: { color: item.color, size: 10 },
              bgcolor: ft.bg,
            });
          });
        } else {
          const activeKey = duKey ?? 'qam16';
          const item = apertures[activeKey];
          if (item) {
            shapes.push({
              type: 'rect', xref: 'x', yref: 'paper',
              x0: item.span[0], x1: item.span[1], y0: 0, y1: 1,
              fillcolor: item.color, opacity: 0.18,
              line: { width: 0 },
            });
            shapes.push({
              type: 'line', xref: 'x', yref: 'paper',
              x0: item.span[0], x1: item.span[0], y0: 0, y1: 1,
              line: { color: item.color, dash: 'dash', width: 2 },
            });
            shapes.push({
              type: 'line', xref: 'x', yref: 'paper',
              x0: item.span[1], x1: item.span[1], y0: 0, y1: 1,
              line: { color: item.color, dash: 'dash', width: 2 },
            });
            annotations.push({
              x: 0, y: 0.94, xref: 'x', yref: 'paper',
              text: `<b>${item.label}</b>`,
              showarrow: false,
              font: { color: item.color, size: 11 },
              bgcolor: ft.bg,
              bordercolor: item.color,
              borderwidth: 1,
            });
          }
        }
      }
    }

    // 10. H-SLS: In-sector sidelobes
    else if (metric.id === 'hsls') {
      if (isPolar) {
        const thetaWedge = arc(-60, 60);
        traces.push({
          type: 'scatterpolar',
          mode: 'lines',
          theta: [-60, ...thetaWedge, 60],
          r: [-floorDb, ...thetaWedge.map(() => 0), -floorDb],
          fill: 'toself',
          fillcolor: 'rgba(138, 90, 0, 0.12)',
          line: { width: 0 },
          hoverinfo: 'none',
          showlegend: false,
        } as unknown as PlotlyNativeData);
        [-60, 60].forEach(deg => {
          traces.push({
            type: 'scatterpolar',
            mode: 'lines',
            theta: [deg, deg],
            r: [-floorDb, 0],
            line: { color: '#8a5a00', dash: 'dash', width: 1.5 },
            hoverinfo: 'none',
            showlegend: false,
          } as unknown as PlotlyNativeData);
        });
        traces.push({
          type: 'scatterpolar',
          mode: 'markers+text',
          theta: [45],
          r: [-18.5],
          marker: { color: '#cf222e', size: 10, symbol: 'x' },
          text: ['<b>H-SLS: 18.5 dB (+45°)</b>'],
          textposition: 'top right',
          textfont: { color: '#cf222e', size: 11 },
          hovertemplate: '<b>Horizontal Sidelobe Suppression (H-SLS): 18.5 dB</b><br>Angle: +45.0° · Level: −18.5 dB<extra></extra>',
          hoverlabel: { bgcolor: ft.bg, bordercolor: '#cf222e', font: { color: ft.fg, size: 12 } },
          showlegend: false,
        } as unknown as PlotlyNativeData);
      } else {
        [-60, 60].forEach(deg => {
          shapes.push({
            type: 'line', xref: 'x', yref: 'paper',
            x0: deg, x1: deg, y0: 0, y1: 1,
            line: { color: '#8a5a00', dash: 'dash', width: 1.5 },
          });
        });
        shapes.push({
          type: 'line', xref: 'paper', yref: 'y',
          x0: 0, x1: 1, y0: -18.5, y1: -18.5,
          line: { color: '#cf222e', dash: 'dash', width: 1.5 },
        });
        traces.push({
          type: 'scatter',
          mode: 'markers',
          x: [45],
          y: [-18.5],
          marker: { color: '#cf222e', size: 10, symbol: 'x' },
          hovertemplate: '<b>Horizontal Sidelobe Suppression (H-SLS): 18.5 dB</b><br>Angle: +45.0° · Level: −18.5 dB<extra></extra>',
          hoverlabel: { bgcolor: ft.bg, bordercolor: '#cf222e', font: { color: ft.fg, size: 12 } },
          showlegend: false,
        } as unknown as PlotlyNativeData);
        annotations.push({
          x: 45, y: -18.5, xref: 'x', yref: 'y',
          text: '<b>H-SLS: 18.5 dB (at +45°)</b>',
          showarrow: true,
          arrowhead: 2,
          arrowcolor: '#cf222e',
          font: { color: '#cf222e', size: 11 },
          bgcolor: ft.bg,
          bordercolor: '#cf222e',
          borderwidth: 1,
        });
      }
    }

    // 11. SPR / AIR
    else if (metric.id === 'spr') {
      if (isPolar) {
        const thetaInside = arc(-60, 60);
        traces.push({
          type: 'scatterpolar',
          mode: 'lines',
          name: 'Inside sector (±60°)',
          theta: [-60, ...thetaInside, 60],
          r: [-floorDb, ...thetaInside.map(() => 0), -floorDb],
          fill: 'toself',
          fillcolor: 'rgba(31, 136, 61, 0.18)',
          line: { width: 0 },
          hoverinfo: 'name',
          showlegend: true,
        } as unknown as PlotlyNativeData);

        const thetaOutside = arc(60, 300);
        traces.push({
          type: 'scatterpolar',
          mode: 'lines',
          name: 'Outside sector',
          theta: [60, ...thetaOutside, 300],
          r: [-floorDb, ...thetaOutside.map(() => 0), -floorDb],
          fill: 'toself',
          fillcolor: 'rgba(210, 153, 34, 0.14)',
          line: { width: 0 },
          hoverinfo: 'name',
          showlegend: true,
        } as unknown as PlotlyNativeData);

        [-60, 60].forEach(deg => {
          traces.push({
            type: 'scatterpolar',
            mode: 'lines',
            theta: [deg, deg],
            r: [-floorDb, 0],
            line: { color: ft.fg, dash: 'dot', width: 1.2 },
            hoverinfo: 'none',
            showlegend: false,
          } as unknown as PlotlyNativeData);
        });
      } else {
        shapes.push({
          type: 'rect', xref: 'x', yref: 'paper',
          x0: -60, x1: 60, y0: 0, y1: 1,
          fillcolor: '#1f883d', opacity: 0.12,
          line: { width: 0 },
        });
        shapes.push({
          type: 'rect', xref: 'x', yref: 'paper',
          x0: -180, x1: -60, y0: 0, y1: 1,
          fillcolor: '#d29922', opacity: 0.1,
          line: { width: 0 },
        });
        shapes.push({
          type: 'rect', xref: 'x', yref: 'paper',
          x0: 60, x1: 180, y0: 0, y1: 1,
          fillcolor: '#d29922', opacity: 0.1,
          line: { width: 0 },
        });
        annotations.push({
          x: 0, y: -2, xref: 'x', yref: 'y',
          text: '<b>Power inside sector</b>',
          showarrow: false,
          font: { color: '#1f883d', size: 11 },
          bgcolor: ft.bg,
        });
        annotations.push({
          x: 120, y: -20, xref: 'x', yref: 'y',
          text: '<b>Power outside</b>',
          showarrow: false,
          font: { color: '#d29922', size: 11 },
          bgcolor: ft.bg,
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Layout Construction
    // ─────────────────────────────────────────────────────────────────────────

    let layout: Partial<PlotlyNativeLayout>;

    if (isPolar) {
      if (isVertical) {
        annotations.push({
          text: '▲ above horizon',
          x: 0.5, y: 0.98, xref: 'paper', yref: 'paper',
          showarrow: false,
          font: { size: 10, color: ft.fg },
          opacity: 0.75,
        });
        annotations.push({
          text: '▼ below horizon',
          x: 0.5, y: 0.02, xref: 'paper', yref: 'paper',
          showarrow: false,
          font: { size: 10, color: ft.fg },
          opacity: 0.75,
        });
      }

      layout = {
        paper_bgcolor: ft.bg,
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: ft.fg, size: 11 },
        margin: { l: 20, r: 20, t: 24, b: 24 },
        showlegend: metric.id === 'tracking' || metric.id === 'spr' || (metric.id === 'du' && duKey === 'all'),
        legend: { orientation: 'h', y: -0.15, x: 0.5, xanchor: 'center' },
        annotations: annotations as unknown as PlotlyNativeLayout['annotations'],
        polar: {
          bgcolor: 'rgba(0,0,0,0)',
          angularaxis: {
            rotation: isVertical ? 0 : 90,
            direction: 'clockwise',
            dtick: 30,
            ...(isVertical ? verticalAngleTicks() : {}),
            gridcolor: ft.grid,
            linecolor: ft.grid,
          },
          radialaxis: {
            range: [-floorDb, 0],
            dtick: 10,
            angle: 270,
            tickangle: 0,
            tickfont: { size: 9 },
            ticksuffix: ' dB',
            gridcolor: ft.grid,
            linecolor: ft.grid,
          },
        },
      };
    } else {
      layout = {
        paper_bgcolor: ft.bg,
        plot_bgcolor: 'rgba(0,0,0,0)',
        hovermode: 'closest',
        font: { color: ft.fg, size: 11 },
        margin: { l: 48, r: 16, t: 16, b: 40 },
        showlegend: metric.id === 'tracking',
        legend: { orientation: 'h', y: 1.1, x: 0.5, xanchor: 'center' },
        shapes: shapes as unknown as PlotlyNativeLayout['shapes'],
        annotations: annotations as unknown as PlotlyNativeLayout['annotations'],
        xaxis: {
          range: [-180, 180],
          dtick: 30,
          title: { text: `${metric.cut === 'H' ? 'Azimuth' : 'Elevation'} (°)`, standoff: 6 },
          gridcolor: ft.grid,
          zeroline: false,
        },
        yaxis: {
          range: [-floorDb, 2],
          dtick: 10,
          title: { text: 'Relative level (dB)' },
          gridcolor: ft.grid,
        },
      };
    }

    void Plotly.react(el, traces, layout, { responsive: true, displayModeBar: false, scrollZoom: false });

    return () => { Plotly.purge(el); };
  }, [metric.id, metric.cut, activeMode, duKey, theme, ft]);

  return (
    <div
      ref={ref}
      className="encyc-mini-chart"
      role="img"
      aria-label={`Example ${activeMode === 'polar' ? 'polar' : 'rectangular'} radiation pattern for ${metric.name}`}
    />
  );
}
