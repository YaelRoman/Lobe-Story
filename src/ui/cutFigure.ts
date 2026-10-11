import type { Data, Layout, PlotData, Shape } from 'plotly.js';
import type { Cut } from '../core/types';
import type { PatternMetrics } from '../core/analysis/metrics';
import { signed } from '../core/analysis/grid';
import type { LobeResult } from '../core/analysis/sidelobes';
import { DU_LEVELS } from '../core/analysis/sector';
import type { MarkerKey, PlotMode } from '../state/store';
import type { Figure, FigureTheme } from './figureTheme';

export interface PlotSeries {
  id: string;
  label: string;
  color: string;
  cut: Cut;
  metrics: PatternMetrics;
  dash?: boolean;
  /** Per-series rotation in degrees; overrides the figure's rotationDeg. */
  rotationDeg?: number;
}

export interface CutFigureOptions {
  series: PlotSeries[];
  cut: 'H' | 'V';
  mode: PlotMode;
  floorDb: number;
  markers: Record<MarkerKey, boolean>;
  markerTarget: string | null;
  theme: FigureTheme;
  levelDb: number;
  fbWindowDeg: number;
  /** Sector half-width in degrees, for the "sector" marker. */
  sectorEdgeDeg: number;
  /** Size of the USLS windows in degrees, for the sidelobe marker labels. */
  uslsRangeDeg: number;
  rotationDeg?: number;
}

interface Sector { from: number; to: number; label: string; opacity: number }
interface Ring { db: number; label: string }
interface Point { angle: number; db: number; label: string }
interface Ray { angle: number; label: string; dash?: 'dot' | 'dashdot' }
/** A band drawn along the outer radius (polar) or near the top (rectangular); `slot` stacks several. */
interface Arc { from: number; to: number; slot: number; label: string }
interface MarkerSpec { sectors: Sector[]; rings: Ring[]; points: Point[]; rays: Ray[]; arcs: Arc[] }

function sortedCut(cut: Cut, rotationDeg: number): { x: number[]; y: number[] } {
  const pts = cut.angles
    .map((a, k) => [signed(a + rotationDeg), cut.atten[k]] as const)
    .sort((p, q) => p[0] - q[0]);
  return { x: pts.map((p) => p[0]), y: pts.map((p) => p[1]) };
}

const level = (atten: number, floorDb: number) => Math.max(-atten, -floorDb);

function arc(from: number, to: number): number[] {
  const out: number[] = [];
  for (let a = from; a < to; a++) out.push(a);
  out.push(to);
  return out;
}

function markerSpec(target: PlotSeries, o: CutFigureOptions): MarkerSpec {
  const spec: MarkerSpec = { sectors: [], rings: [], points: [], rays: [], arcs: [] };
  const m = target.metrics;
  const beam = o.cut === 'H' ? m.h : m.v;
  const offset = Math.min(...target.cut.atten);
  const rot = target.rotationDeg ?? o.rotationDeg ?? 0;
  const point = (r: { value: number | null; angle?: number }, label: (v: number) => string) => {
    if (r.value !== null && r.angle !== undefined) {
      spec.points.push({ angle: signed(r.angle + rot), db: -(offset + r.value), label: label(r.value) });
    }
  };

  if (o.markers.hpbw && beam.edges && beam.hpbw.value !== null) {
    spec.rings.push({ db: -(offset + o.levelDb), label: `−${o.levelDb} dB` });
    spec.sectors.push({ from: beam.edges[0] + rot, to: beam.edges[1] + rot, label: `HPBW ${beam.hpbw.value.toFixed(1)}°`, opacity: 0.15 });
  }
  if (o.markers.fb && o.cut === 'H') {
    spec.sectors.push({ from: 180 - o.fbWindowDeg + rot, to: 180 + o.fbWindowDeg + rot, label: `F/B window ±${o.fbWindowDeg}°`, opacity: 0.08 });
    point(m.fbWindow, (v) => `F/B ±${o.fbWindowDeg}° ${v.toFixed(1)} dB`);
  }
  const lobeMarkers = (items: { label: string; r: LobeResult }[]) => {
    const groups: { angle: number; value: number; labels: string[] }[] = [];
    for (const { label, r } of items) {
      if (r.value === null || r.angle === undefined) continue;
      const text = r.kind === 'merged' ? `${label} (merged)` : label;
      const same = groups.find((g) => Math.abs(g.angle - r.angle!) < 1e-6 && Math.abs(g.value - r.value!) < 1e-6);
      if (same) same.labels.push(text);
      else groups.push({ angle: r.angle, value: r.value, labels: [text] });
    }
    for (const g of groups) point({ value: g.value, angle: g.angle }, (v) => `${g.labels.join(' · ')} ${v.toFixed(1)} dB`);
  };
  if (o.markers.usls && o.cut === 'V') {
    lobeMarkers([
      { label: 'First USLS', r: m.firstUsls },
      { label: `USLS peak to ${o.uslsRangeDeg}°`, r: m.usls },
      { label: `USLS horizon to ${o.uslsRangeDeg}°`, r: m.uslsHorizon },
    ]);
  }
  if (o.markers.usls && o.cut === 'H') lobeMarkers([{ label: 'H-SLS', r: m.hSls }]);
  if (o.markers.null && o.cut === 'V') {
    lobeMarkers([
      { label: 'Null fill', r: m.nullFill },
      { label: 'First LSLS', r: m.firstLsls },
    ]);
  }
  if (o.markers.peak && beam.direction.value !== null) {
    const name = o.cut === 'H' ? 'Squint' : 'Tilt';
    spec.rays.push({ angle: signed(beam.direction.value + rot), label: `${name} ${beam.direction.value.toFixed(1)}°` });
  }
  if (o.markers.sector && o.cut === 'H') {
    for (const sign of [1, -1]) {
      const angle = signed(sign * o.sectorEdgeDeg + rot);
      spec.rays.push({ angle, label: `Sector edge ${sign > 0 ? '+' : '−'}${o.sectorEdgeDeg}°`, dash: 'dashdot' });
    }
    DU_LEVELS.forEach((l, slot) => {
      const r = m.du[l.key];
      if (r.value === null || !r.edges) return;
      spec.arcs.push({
        from: r.edges[0] + rot,
        to: r.edges[1] + rot,
        slot,
        label: `D/U ${l.label} (≥ ${l.db} dB): ${r.value.toFixed(1)}°`,
      });
    });
  }
  return spec;
}

function polarMarkers(spec: MarkerSpec, o: CutFigureOptions): Partial<PlotData>[] {
  const floor = -o.floorDb;
  const out: Partial<PlotData>[] = [];
  for (const s of spec.sectors) {
    const theta = arc(s.from, s.to);
    out.push({
      type: 'scatterpolar',
      mode: 'lines',
      name: s.label,
      theta: [s.from, ...theta, s.to],
      r: [floor, ...theta.map(() => 0), floor],
      fill: 'toself',
      fillcolor: o.theme.accent,
      opacity: s.opacity,
      line: { width: 0 },
      hoverinfo: 'name',
    });
  }
  for (const ring of spec.rings) {
    const theta = arc(0, 360);
    out.push({
      type: 'scatterpolar',
      mode: 'lines',
      name: ring.label,
      theta,
      r: theta.map(() => ring.db),
      line: { color: o.theme.accent, dash: 'dash', width: 1 },
      hoverinfo: 'name',
    });
  }
  for (const p of spec.points) {
    out.push({
      type: 'scatterpolar',
      mode: 'markers',
      name: p.label,
      theta: [p.angle],
      r: [Math.max(p.db, floor)],
      marker: { color: o.theme.accent, size: 10, symbol: 'x' },
      hoverinfo: 'name',
    });
  }
  for (const ray of spec.rays) {
    out.push({
      type: 'scatterpolar',
      mode: 'lines',
      name: ray.label,
      theta: [ray.angle, ray.angle],
      r: [floor, 0],
      line: { color: o.theme.accent, dash: ray.dash ?? 'dot', width: 1.5 },
      hoverinfo: 'name',
    });
  }
  for (const a of spec.arcs) {
    const theta = arc(a.from, Math.min(a.to, a.from + 360));
    out.push({
      type: 'scatterpolar',
      mode: 'lines',
      name: a.label,
      theta,
      r: theta.map(() => floor * 0.03 * (a.slot + 1)),
      line: { color: o.theme.accent, width: 5 },
      opacity: 0.6,
      hoverinfo: 'name',
    });
  }
  return out;
}

function rectMarkers(spec: MarkerSpec, o: CutFigureOptions): { traces: Partial<PlotData>[]; shapes: Partial<Shape>[] } {
  const shapes: Partial<Shape>[] = [];
  const traces: Partial<PlotData>[] = [];
  const rect = (x0: number, x1: number, opacity: number) =>
    shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0, x1, y0: 0, y1: 1, fillcolor: o.theme.accent, opacity, line: { width: 0 } });
  for (const s of spec.sectors) {
    let from = s.from;
    let to = s.to;
    while (from > 180) {
      from -= 360;
      to -= 360;
    }
    while (from <= -180) {
      from += 360;
      to += 360;
    }
    if (to > 180) {
      rect(from, 180, s.opacity);
      rect(-180, to - 360, s.opacity);
    } else rect(from, to, s.opacity);
  }
  for (const ring of spec.rings) {
    shapes.push({ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: ring.db, y1: ring.db, line: { color: o.theme.accent, dash: 'dash', width: 1 } });
  }
  for (const ray of spec.rays) {
    shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: ray.angle, x1: ray.angle, y0: 0, y1: 1, line: { color: o.theme.accent, dash: ray.dash ?? 'dot', width: 1.5 } });
  }
  for (const p of spec.points) {
    traces.push({
      type: 'scatter',
      mode: 'markers',
      name: p.label,
      x: [p.angle],
      y: [Math.max(p.db, -o.floorDb)],
      marker: { color: o.theme.accent, size: 10, symbol: 'x' },
      hoverinfo: 'name',
    });
  }
  for (const a of spec.arcs) {
    const x: (number | null)[] = [];
    for (const t of arc(a.from, Math.min(a.to, a.from + 360))) {
      // +180 and -180 coincide: begin at -180 so a full-circle bar has no isolated start point.
      const v = x.length === 0 && signed(t) === 180 ? -180 : signed(t);
      if (x.length && v < (x[x.length - 1] ?? v) - 180) x.push(null);
      x.push(v);
    }
    traces.push({
      type: 'scatter',
      mode: 'lines',
      name: a.label,
      x,
      y: x.map(() => -o.floorDb * 0.03 * (a.slot + 1)),
      line: { color: o.theme.accent, width: 5 },
      opacity: 0.6,
      hoverinfo: 'name',
    });
  }
  return { traces, shapes };
}

export function buildCutFigure(o: CutFigureOptions): Figure {
  const data: Partial<PlotData>[] = [];
  let largest = 0;
  for (const s of o.series) {
    const { x, y } = sortedCut(s.cut, s.rotationDeg ?? o.rotationDeg ?? 0);
    const r = y.map((v) => level(v, o.floorDb));
    for (const v of r) if (v > largest) largest = v;
    const line = {
      color: s.color,
      width: s.id === o.markerTarget ? 2.5 : 1.5,
      ...(s.dash ? { dash: 'dash' as const } : {}),
    };
    if (o.mode === 'polar') {
      data.push({
        type: 'scatterpolar',
        mode: 'lines',
        name: s.label,
        theta: [...x, x[0]],
        r: [...r, r[0]],
        line,
        hovertemplate: '%{theta:.0f}°  %{r:.2f} dB',
      });
    } else {
      data.push({ type: 'scatter', mode: 'lines', name: s.label, x, y: r, line, hovertemplate: '%{x:.0f}°  %{y:.2f} dB' });
    }
  }

  // Normally 0. A trace above its nominal peak (e.g. a file with a negative offset) widens the
  // range to the next 5 dB so it is never clipped.
  const top = Math.ceil(largest / 5) * 5;

  const target = o.series.find((s) => s.id === o.markerTarget);
  const spec = target ? markerSpec(target, o) : { sectors: [], rings: [], points: [], rays: [], arcs: [] };
  const hpbw = target ? (o.cut === 'H' ? target.metrics.h : target.metrics.v).hpbw.value : null;
  const title = `${o.cut === 'H' ? 'Horizontal' : 'Vertical'} cut${hpbw !== null ? ` — HPBW ${hpbw.toFixed(1)}°` : ''}`;

  const base: Partial<Layout> = {
    title: { text: title, font: { size: 14 } },
    paper_bgcolor: o.theme.bg,
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: o.theme.fg },
    margin: { l: 50, r: 30, t: 50, b: 40 },
    showlegend: true,
    legend: { orientation: 'h', y: -0.12 },
  };

  if (o.mode === 'polar') {
    data.push(...polarMarkers(spec, o));
    return {
      data: data as Data[],
      layout: {
        ...base,
        polar: {
          bgcolor: 'rgba(0,0,0,0)',
          angularaxis: {
            rotation: o.cut === 'H' ? 90 : 0,
            direction: 'clockwise',
            dtick: 30,
            gridcolor: o.theme.grid,
            linecolor: o.theme.grid,
          },
          radialaxis: {
            range: [-o.floorDb, top],
            dtick: 10,
            ticksuffix: ' dB',
            gridcolor: o.theme.grid,
            linecolor: o.theme.grid,
          },
        },
      },
    };
  }

  const rect = rectMarkers(spec, o);
  data.push(...rect.traces);
  return {
    data: data as Data[],
    layout: {
      ...base,
      hovermode: 'x unified',
      shapes: rect.shapes,
      xaxis: { range: [-180, 180], dtick: 30, title: { text: 'Angle (°)' }, gridcolor: o.theme.grid, zeroline: false },
      yaxis: { range: [-o.floorDb, top], dtick: 10, title: { text: 'Relative level (dB)' }, gridcolor: o.theme.grid },
    },
  };
}
