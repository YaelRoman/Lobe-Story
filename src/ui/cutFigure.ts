import type { Data, Layout, PlotData, Shape } from 'plotly.js';
import { bwName } from './bwLabel';
import type { Cut } from '../core/types';
import type { PatternMetrics } from '../core/analysis/metrics';
import { signed } from '../core/analysis/grid';
import type { LobeResult } from '../core/analysis/sidelobes';
import { DU_LEVELS } from '../core/analysis/sector';
import type { MarkerKey, PlotMode } from '../state/store';
import { LEGEND, type Figure, type FigureTheme } from './figureTheme';
import { LEGEND_NAME_MAX, middleEllipsis, showFileLegend } from './legend';

export interface PlotSeries {
  id: string;
  label: string;
  color: string;
  cut: Cut;
  metrics: PatternMetrics;
  /** The dashed original of a tilted file. */
  dash?: boolean;
  /** Line pattern of a live trace when several groups share a hue (see `groupStyle`); an original is always dashed. */
  lineDash?: 'dot' | 'dashdot' | 'longdash';
  /** Per-series rotation in degrees; overrides the figure's rotationDeg. */
  rotationDeg?: number;
  /** A simulated horizontal cut of a mechanically tilted file (the cut through the tilted beam peak). */
  coneCut?: boolean;
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

/** `readout: false` marks a band that only shades the plot and carries no value of its own. */
interface Sector { from: number; to: number; label: string; opacity: number; readout?: boolean }
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
    spec.sectors.push({ from: beam.edges[0] + rot, to: beam.edges[1] + rot, label: `${bwName(o.levelDb)} ${beam.hpbw.value.toFixed(1)}°`, opacity: 0.15 });
  }
  if (o.markers.fb && o.cut === 'H') {
    spec.sectors.push({ from: 180 - o.fbWindowDeg + rot, to: 180 + o.fbWindowDeg + rot, label: `F/B window ±${o.fbWindowDeg}°`, opacity: 0.08, readout: false });
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
      showlegend: false,
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
      showlegend: false,
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
      showlegend: false,
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
      showlegend: false,
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
      showlegend: false,
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
      showlegend: false,
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
      showlegend: false,
    });
  }
  return { traces, shapes };
}

/**
 * The values of the markers drawn for the target series (HPBW, squint, F/B, sidelobes, D/U widths…),
 * as plain text lines for the read-out under the plot; the markers are not repeated in the legend.
 */
export function markerReadout(o: CutFigureOptions): string[] {
  const target = o.series.find((s) => s.id === o.markerTarget);
  if (!target) return [];
  const spec = markerSpec(target, o);
  return [
    ...spec.sectors.filter((s) => s.readout !== false).map((s) => s.label),
    ...spec.points.map((p) => p.label),
    ...spec.rays.map((r) => r.label),
    ...spec.arcs.map((a) => a.label),
  ];
}

/**
 * Screen angle of the radial axis (counter-clockwise from the right; 270 = straight down). The
 * horizontal cut's beam points up, so the axis runs down the rear, turned with the azimuth; the
 * vertical cut's beam lies along the horizon, so up/down is free.
 */
function radialAxisAngle(o: CutFigureOptions): number {
  if (o.cut === 'V') return 270;
  const rot = o.rotationDeg ?? o.series[0]?.rotationDeg ?? 0;
  return (((270 - rot) % 360) + 360) % 360;
}

// Plotly has `meta` (referenced as %{meta} in hover labels); @types/plotly.js does not declare it.
type FileTrace = Partial<PlotData> & { meta?: string; legendrank?: number };

/** Opacity of the other files' traces while one file is highlighted. */
export const DIMMED_OPACITY = 0.35;
const BASE_WIDTH = 1.5;
const EMPHASISED_WIDTH = 2.5;

/**
 * How a file trace looks while `emphasised` is the emphasised file (null: none): the line width and the opacity
 * (null = Plotly's default, fully opaque). The figure builder and the hover preview share this, so a preview
 * restores exactly what the figure was built with. The dashed original of the emphasised file stays bright, thin.
 */
export function traceStyle(seriesId: string, emphasised: string | null): { width: number; opacity: number | null } {
  const dimmed = emphasised !== null && seriesId !== emphasised && seriesId !== `${emphasised}#original`;
  return { width: seriesId === emphasised ? EMPHASISED_WIDTH : BASE_WIDTH, opacity: dimmed ? DIMMED_OPACITY : null };
}

export function buildCutFigure(o: CutFigureOptions): Figure {
  const data: FileTrace[] = [];
  let largest = 0;
  // With a highlighted file, the other files are dimmed and the highlighted trace is drawn last
  // (on top); its own dashed original stays bright so the comparison is readable.
  const emphasised = o.series.some((s) => s.id === o.markerTarget) ? o.markerTarget : null;
  const order = o.series.map((s, i) => ({ s, i }));
  if (emphasised !== null) order.sort((p, q) => Number(p.s.id === emphasised) - Number(q.s.id === emphasised) || p.i - q.i);
  for (const { s, i } of order) {
    const { x, y } = sortedCut(s.cut, s.rotationDeg ?? o.rotationDeg ?? 0);
    const r = y.map((v) => level(v, o.floorDb));
    for (const v of r) if (v > largest) largest = v;
    const legendName = middleEllipsis(s.label, LEGEND_NAME_MAX);
    const style = traceStyle(s.id, emphasised);
    // `uid` carries the series id, so the hover preview can restyle a file's traces without a rebuild.
    const extra = { uid: s.id, legendrank: i, ...(style.opacity !== null ? { opacity: style.opacity } : {}) };
    const line = {
      color: s.color,
      width: style.width,
      ...(s.dash ? { dash: 'dash' as const } : s.lineDash ? { dash: s.lineDash } : {}),
    };
    if (o.mode === 'polar') {
      data.push({
        type: 'scatterpolar',
        mode: 'lines',
        name: legendName,
        meta: s.label,
        theta: [...x, x[0]],
        r: [...r, r[0]],
        line,
        ...extra,
        hovertemplate: '%{theta:.0f}°  %{r:.2f} dB<extra>%{meta}</extra>',
      });
    } else {
      data.push({ type: 'scatter', mode: 'lines', name: legendName, meta: s.label, x, y: r, line, ...extra, hovertemplate: '%{x:.0f}°  %{y:.2f} dB<extra>%{meta}</extra>' });
    }
  }

  // Normally 0. A trace above its nominal peak (e.g. a file with a negative offset) widens the
  // range to the next 5 dB so it is never clipped.
  const top = Math.ceil(largest / 5) * 5;

  const target = o.series.find((s) => s.id === o.markerTarget);
  const spec = target ? markerSpec(target, o) : { sectors: [], rings: [], points: [], rays: [], arcs: [] };
  const hpbw = target ? (o.cut === 'H' ? target.metrics.h : target.metrics.v).hpbw.value : null;
  const cone = o.cut === 'H' && o.series.some((s) => s.coneCut) ? ' · cut through the tilted beam peak' : '';
  const title = `${o.cut === 'H' ? 'Horizontal' : 'Vertical'} cut${hpbw !== null ? ` — ${bwName(o.levelDb)} ${hpbw.toFixed(1)}°` : ''}${cone}`;

  const base: Partial<Layout> = {
    title: { text: title, font: { size: 14 } },
    paper_bgcolor: o.theme.bg,
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: o.theme.fg },
    margin: { l: 50, r: 30, t: 50, b: 40 },
    showlegend: showFileLegend(o.series.length),
    legend: LEGEND,
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
            dtick: o.floorDb + top > 60 ? 20 : 10,
            // Tick labels run along the empty rear side of the pattern instead of over the beam.
            angle: radialAxisAngle(o),
            tickangle: 0,
            tickfont: { size: 10 },
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
      xaxis: { range: [-180, 180], dtick: 30, automargin: true, title: { text: 'Angle (°)', standoff: 8 }, gridcolor: o.theme.grid, zeroline: false },
      yaxis: { range: [-o.floorDb, top], dtick: 10, title: { text: 'Relative level (dB)' }, gridcolor: o.theme.grid },
    },
  };
}
