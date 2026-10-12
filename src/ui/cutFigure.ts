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
import { traceUid } from './traceUid';

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
  /** The pinned reference file: drawn on top in the theme's text colour, thick and dashed, never dimmed, named "(reference)". */
  reference?: boolean;
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
/** `readout: false`: the ray is drawn but the read-out says it in one item of its own (see `notes`). */
interface Ray { angle: number; label: string; dash?: 'dot' | 'dashdot'; readout?: boolean }
/** A band drawn along the outer radius (polar) or near the top (rectangular); `slot` stacks several. */
interface Arc { from: number; to: number; slot: number; label: string }
/** `notes`: read-out items that belong to no single mark. */
interface MarkerSpec { sectors: Sector[]; rings: Ring[]; points: Point[]; rays: Ray[]; arcs: Arc[]; notes: string[] }

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
  const spec: MarkerSpec = { sectors: [], rings: [], points: [], rays: [], arcs: [], notes: [] };
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
    for (const g of groups) point({ value: g.value, angle: g.angle }, (v) => `${g.labels.join(' = ')} ${v.toFixed(1)} dB`);
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
      spec.rays.push({ angle, label: `Sector edge ${sign > 0 ? '+' : '−'}${o.sectorEdgeDeg}°`, dash: 'dashdot', readout: false });
    }
    // The edges carry the roll-off value of the table (the worse of the two edges): one item says it.
    if (m.rollOff.value !== null) spec.notes.push(`Roll-off at ±${o.sectorEdgeDeg}°: ${m.rollOff.value.toFixed(1)} dB`);
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
    ...spec.rays.filter((r) => r.readout !== false).map((r) => r.label),
    ...spec.notes,
    ...spec.arcs.map((a) => a.label),
  ];
}

/**
 * Screen angle of the radial axis (counter-clockwise from the right; 270 = straight down). The
 * horizontal cut's beam points up, so the axis runs down the rear, turned with the azimuth; the
 * vertical cut's beam lies along the horizon, so up/down is free.
 */
function radialAxisAngle(o: CutBaseOptions): number {
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
const REFERENCE_WIDTH = 3.5;

/**
 * How a file trace looks while `emphasised` is the emphasised file (null: none): the line width and the opacity
 * (null = Plotly's default, fully opaque). The figure builder and the hover preview share this, so a preview
 * restores exactly what the figure was built with. The dashed original of the emphasised file stays bright, thin.
 * The `reference` file's trace never takes part in dimming and keeps its width.
 */
export function traceStyle(seriesId: string, emphasised: string | null, reference = false): { width: number; opacity: number | null } {
  if (reference) return { width: REFERENCE_WIDTH, opacity: null };
  const dimmed = emphasised !== null && seriesId !== emphasised && seriesId !== `${emphasised}#original`;
  return { width: seriesId === emphasised ? EMPHASISED_WIDTH : BASE_WIDTH, opacity: dimmed ? DIMMED_OPACITY : null };
}

/** What a cut figure needs apart from the highlighted file: the files' traces, the axes and the colours. */
export type CutBaseOptions = Omit<CutFigureOptions, 'markers' | 'markerTarget'>;

/**
 * The part of a cut figure that belongs to the highlighted file (`markerTarget`): its marker traces, which follow the
 * file traces in the figure's data, and the layout keys it sets (the title with the file's beamwidth; in the
 * rectangular plot also the marker shapes).
 */
export interface CutOverlay {
  data: Data[];
  layout: Partial<Layout>;
}

const NO_MARKERS: MarkerSpec = { sectors: [], rings: [], points: [], rays: [], arcs: [], notes: [] };

/** The file traces, drawn in series order with the emphasised file last but for the reference, and the top of the level axis. */
function fileTraces(o: CutBaseOptions, emphasised: string | null): { data: FileTrace[]; top: number } {
  const data: FileTrace[] = [];
  let largest = 0;
  // With a highlighted file, the other files are dimmed and the highlighted trace is drawn last
  // (on top); its own dashed original stays bright so the comparison is readable.
  const order = o.series.map((s, i) => ({ s, i }));
  if (emphasised !== null) order.sort((p, q) => Number(p.s.id === emphasised) - Number(q.s.id === emphasised) || p.i - q.i);
  // The reference file is drawn last of all (on top).
  order.sort((p, q) => Number(!!p.s.reference) - Number(!!q.s.reference));
  for (const { s, i } of order) {
    const { x, y } = sortedCut(s.cut, s.rotationDeg ?? o.rotationDeg ?? 0);
    const r = y.map((v) => level(v, o.floorDb));
    for (const v of r) if (v > largest) largest = v;
    const legendName = middleEllipsis(s.label, LEGEND_NAME_MAX);
    const style = traceStyle(s.id, emphasised, !!s.reference);
    // `uid` carries the series id (as a safe CSS identifier), so a highlight or a hover preview can restyle a file's traces without a rebuild.
    const extra = { uid: traceUid(s.id, !!s.reference), legendrank: s.reference ? -1 : i, ...(style.opacity !== null ? { opacity: style.opacity } : {}) };
    const line = {
      color: s.reference ? o.theme.fg : s.color,
      width: style.width,
      ...(s.dash || s.reference ? { dash: 'dash' as const } : s.lineDash ? { dash: s.lineDash } : {}),
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
  return { data, top: Math.ceil(largest / 5) * 5 };
}

/**
 * The highlighted file's part of the figure `buildCutFigure(o)`: see `CutOverlay`. Without a target among the series
 * it holds no marker, and the title names no beamwidth.
 */
export function buildCutOverlay(o: CutFigureOptions): CutOverlay {
  const target = o.series.find((s) => s.id === o.markerTarget);
  const spec = target ? markerSpec(target, o) : NO_MARKERS;
  const hpbw = target ? (o.cut === 'H' ? target.metrics.h : target.metrics.v).hpbw.value : null;
  const cone = o.cut === 'H' && o.series.some((s) => s.coneCut) ? ' · cut through the tilted beam peak' : '';
  const text = `${o.cut === 'H' ? 'Horizontal' : 'Vertical'} cut${hpbw !== null ? ` — ${bwName(o.levelDb)} ${hpbw.toFixed(1)}°` : ''}${cone}`;
  const title = { text, font: { size: 14 } };
  if (o.mode === 'polar') return { data: polarMarkers(spec, o) as Data[], layout: { title } };
  const rect = rectMarkers(spec, o);
  return { data: rect.traces as Data[], layout: { title, shapes: rect.shapes } };
}

/** The figure's layout apart from the highlighted file's part (`CutOverlay.layout`). */
function baseLayout(o: CutBaseOptions, top: number): Partial<Layout> {
  const base: Partial<Layout> = {
    paper_bgcolor: o.theme.bg,
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: o.theme.fg },
    margin: { l: 50, r: 30, t: 50, b: 40 },
    showlegend: showFileLegend(o.series.length),
    legend: LEGEND,
  };
  if (o.mode === 'polar') {
    return {
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
    };
  }
  return {
    ...base,
    hovermode: 'x unified',
    xaxis: { range: [-180, 180], dtick: 30, automargin: true, title: { text: 'Angle (°)', standoff: 8 }, gridcolor: o.theme.grid, zeroline: false },
    yaxis: { range: [-o.floorDb, top], dtick: 10, title: { text: 'Relative level (dB)' }, gridcolor: o.theme.grid },
  };
}

/**
 * The complete cut figure: the file traces with the highlighted file (`markerTarget`) thick, on top, and the others
 * dimmed, then its marker traces. This is what an exported image is made from.
 */
export function buildCutFigure(o: CutFigureOptions): Figure {
  const emphasised = o.series.some((s) => s.id === o.markerTarget) ? o.markerTarget : null;
  const files = fileTraces(o, emphasised);
  const overlay = buildCutOverlay(o);
  return { data: [...(files.data as Data[]), ...overlay.data], layout: { ...baseLayout(o, files.top), ...overlay.layout } };
}

/**
 * The cut figure without a highlighted file: every file trace in its plain look and in series order, no marker. It
 * does not depend on the highlight, so highlighting a file builds no trace again: the plot restyles the traces it has
 * (see `previewRestyle`) and takes the file's markers and title from `buildCutOverlay`. The plot hands the traces to
 * the library with the highlighted one on top (see `drawingOrder`). Without a simulation that is the order
 * `buildCutFigure` gives an exported image. Under a tilt simulation the two differ in one place: on screen the
 * highlighted file's dashed original moves right under it, while the export keeps it at its place in the series.
 */
export function buildCutBase(o: CutBaseOptions): Figure {
  const files = fileTraces(o, null);
  const overlay = buildCutOverlay({ ...o, markers: { hpbw: false, fb: false, usls: false, null: false, peak: false, sector: false }, markerTarget: null });
  return { data: files.data as Data[], layout: { ...baseLayout(o, files.top), ...overlay.layout } };
}

/**
 * One caption line saying what the markers that are on mean in an exported cut image, or undefined when none is
 * drawn for this cut. Only the markers of this cut are listed (the F/B window, sector edges and D/U arcs are horizontal
 * only; the null fill and lower sidelobe are vertical only). The words follow what the plot mode really draws: a ring,
 * wedge, ray and arc on the polar plot; a line, band, vertical line and segment on the rectangular one. The line says
 * "highlighted file" only when `highlighted` (default) is true, else "the only ticked file".
 */
export function markerCaption(
  cut: 'H' | 'V',
  markers: Record<MarkerKey, boolean>,
  o: { levelDb: number; fbWindowDeg: number; sectorEdgeDeg: number; uslsRangeDeg: number; mode?: PlotMode; highlighted?: boolean },
): string | undefined {
  const polar = (o.mode ?? 'polar') === 'polar';
  const parts: string[] = [];
  if (markers.hpbw) parts.push(`${polar ? 'dashed ring' : 'dashed line'}: the −${o.levelDb} dB level; ${polar ? 'shaded wedge' : 'shaded band'}: the ${bwName(o.levelDb)}`);
  if (markers.fb && cut === 'H') parts.push(`${polar ? 'light wedge' : 'light band'}: the F/B window (180° ± ${o.fbWindowDeg}°); ×: the F/B level`);
  if (markers.usls) parts.push(cut === 'H' ? '×: the highest horizontal sidelobe (H-SLS)' : `×: the first upper sidelobe and the USLS peaks within ${o.uslsRangeDeg}°`);
  if (markers.null && cut === 'V') parts.push('×: the null fill and the first lower sidelobe');
  if (markers.peak) parts.push(`${polar ? 'dotted ray' : 'dotted vertical line'}: the beam direction (${cut === 'H' ? 'squint' : 'tilt'})`);
  if (markers.sector && cut === 'H') {
    parts.push(`${polar ? 'dash-dot rays' : 'dash-dot vertical lines'}: the sector edges (±${o.sectorEdgeDeg}°); ${polar ? 'thick arcs' : 'thick segments'}: the D/U apertures (16, 64, 256 QAM)`);
  }
  return parts.length > 0 ? `Markers of ${o.highlighted === false ? 'the only ticked file' : 'the highlighted file'}: ${parts.join('; ')}` : undefined;
}
