import { memo, useMemo, useState, type KeyboardEvent } from 'react';
import { useStore } from '../state/store';
import type { PatternMetrics, TaggedPattern } from '../core/analysis/metrics';
import { MIN_SAMPLES } from '../core/analysis/bandStats';
import { BAND_PARAMS, bandParamLabel, bandParamTitle, bandTable, columnSummary, type BandParamKey } from '../core/analysis/bandParams';
import { autoSubBands, buildDatasets, datasetKeyOf, sanitizeSubBands, subBandsFor, type BandDataset } from '../core/analysis/subBands';
import { compareSubBands } from '../core/analysis/bandCompare';
import { ADJUSTED_LEGEND, anyAdjusted, bandCsv, bandHistogramMarks, bandStateNote, bandTsv, cellDisplay, defaultDataset, filesText, hintText, largestDataset, levelNote, lobeLimitWarning, subBandsNote, type BandSheet } from './bandView';
import { anySubstituted, compareDiffs, compareNote, compareTsv, diffDisplay, SUBSTITUTED_LEGEND } from './bandCompareView';
import { bandCompareHistCaption, bandHistCaption, buildBandCompareHistFigure, buildBandHistFigure } from './bandHistFigure';
import { hasUsableFrequency } from '../core/gain';
import { downloadText } from './download';
import { withSimulated } from './exportFigure';
import { exportName, simulatedCaption, weightedHorizonNote } from './simSummary';
import { catchUpSimulation } from './simCurrent';
import { useLatest } from './useLatest';
import { pairWords } from './table';
import { copyAndAnnounce } from './clipboard';
import { FIGURE_THEMES } from './figureTheme';
import { PlotlyChart } from './PlotlyChart';
import { SubBandEditor } from './SubBandEditor';
import { SKIP_TARGETS } from './SkipLinks';
import { gridTarget } from './rovingKeys';
import { DefinitionsButton, type OpenHelp } from './HelpDialog';
import type { SimulationResult } from './useSimulation';

/** Which cell of a sub-band: the antenna shown (or A of a comparison), B, or B − A. */
type Side = 'a' | 'b' | 'd';
const SIDES: readonly Side[] = ['a', 'b', 'd'];

/** A clicked cell; `scope` ties it to the dataset(s) and sub-band it was clicked in. */
interface Picked {
  key: BandParamKey;
  column: number;
  side: Side;
  scope: string;
}

const scopeOf = (datasetKey: string, b: { name: string; minMHz: number; maxMHz: number }): string =>
  `${datasetKey}\u0000${b.name}\u0000${b.minMHz}\u0000${b.maxMHz}`;

export const BandStats = memo(function BandStats({
  tagged,
  metrics,
  sim,
  onHelp,
}: {
  onHelp: OpenHelp;
  tagged: TaggedPattern[];
  metrics: Map<string, PatternMetrics>;
  sim: SimulationResult;
}) {
  const customGroups = useStore((s) => s.customGroups);
  // Key of the highlighted file's dataset (a string), so moving the highlight within one dataset does not re-render.
  const highlightedKey = useStore((s) => {
    const item = s.highlighted === null ? undefined : tagged.find((t) => t.pattern.id === s.highlighted);
    return item ? datasetKeyOf(item, s.customGroups) : null;
  });
  const userSubBands = useStore((s) => s.view.subBands);
  const gainUnit = useStore((s) => s.view.gainUnit);
  const settings = useStore((s) => s.settings);
  const updateView = useStore((s) => s.updateView);
  const dropSubBands = useStore((s) => s.dropSubBands);
  const setCopyNote = useStore((s) => s.setCopyNote);
  const [chosen, setChosen] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  // The one cell of the band table that is a tab stop; the arrow keys move it (roving tabindex), as in the metrics table.
  const [stop, setStop] = useState({ row: 0, col: 0 });
  const theme = useStore((s) => s.view.theme);
  const method3d = useStore((s) => s.view.method3d);

  const datasets = useMemo(() => buildDatasets(tagged, customGroups), [tagged, customGroups]);
  const largest = largestDataset(datasets);
  const noFrequency = useMemo(() => tagged.filter((t) => !t.copyOf && !hasUsableFrequency(t.pattern.frequencyMHz)).length, [tagged]);
  const bandCompare = useStore((s) => s.view.bandCompare);
  // A comparison of two antennas that are both loaded; else one antenna is shown, as without one.
  const compareA = bandCompare ? datasets.find((d) => d.key === bandCompare.a) : undefined;
  const compareB = bandCompare ? datasets.find((d) => d.key === bandCompare.b) : undefined;
  const other: BandDataset | undefined = compareA && compareB && compareA !== compareB ? compareB : undefined;
  const dataset =
    (other ? compareA : undefined) ??
    datasets.find((d) => d.key === chosen) ??
    datasets.find((d) => d.key === highlightedKey) ??
    defaultDataset(datasets);

  const subBands = useMemo(
    () => (dataset ? (other ? compareSubBands(dataset.items, other.items, userSubBands) : subBandsFor(dataset.items, userSubBands)) : []),
    [dataset, other, userSubBands],
  );
  const ctx = useMemo(() => ({ gainUnit, settings }), [gainUnit, settings]);
  const columns = useMemo(
    () => (dataset ? bandTable(dataset.items, metrics, subBands, ctx) : []),
    [dataset, metrics, subBands, ctx],
  );
  const tiltedColumns = useMemo(
    () => (dataset && sim.simActive ? bandTable(dataset.items, sim.metrics, subBands, ctx) : null),
    [dataset, sim.simActive, sim.metrics, subBands, ctx],
  );
  const otherColumns = useMemo(() => (other ? bandTable(other.items, metrics, subBands, ctx) : null), [other, metrics, subBands, ctx]);
  const otherTilted = useMemo(
    () => (other && sim.simActive ? bandTable(other.items, sim.metrics, subBands, ctx) : null),
    [other, sim.simActive, sim.metrics, subBands, ctx],
  );
  const sheetA = useMemo<BandSheet | null>(
    () => (dataset ? { label: dataset.label, columns, ...(tiltedColumns ? { tilted: tiltedColumns } : {}) } : null),
    [dataset, columns, tiltedColumns],
  );
  const sheetB = useMemo<BandSheet | null>(
    () => (other && otherColumns ? { label: other.label, columns: otherColumns, ...(otherTilted ? { tilted: otherTilted } : {}) } : null),
    [other, otherColumns, otherTilted],
  );
  const diffs = useMemo(() => (sheetA && sheetB ? compareDiffs(sheetA, sheetB) : null), [sheetA, sheetB]);
  // A clicked cell belongs to the antenna (or the two antennas) and sub-band it was clicked in.
  const scopeKey = dataset ? (other ? `${dataset.key}\u0001${other.key}` : dataset.key) : '';

  const pickedColumn =
    picked && dataset && columns[picked.column] && scopeOf(scopeKey, columns[picked.column].subBand) === picked.scope && (picked.side === 'a' || sheetB)
      ? columns[picked.column]
      : null;
  // With no tilt on any file nothing is "tilted": a pair is file cut → horizon cut.
  const words = pairWords(sim.hCut === 'horizon', sim.tiltActive);
  const horizonOnly = sim.hCut === 'horizon' && !sim.tiltActive;
  const sheetOf = (side: 'a' | 'b'): BandSheet | null => (side === 'b' ? sheetB : sheetA);
  /** The value a side's cell shows (the tilted one under a simulation). */
  const shownCell = (side: 'a' | 'b') => {
    const sheet = sheetOf(side);
    return picked && pickedColumn && sheet ? (sheet.tilted ?? sheet.columns)[picked.column].cells[picked.key] : null;
  };
  const pickedSide = picked && pickedColumn ? picked.side : null;
  const pickedCell = pickedSide === 'a' || pickedSide === 'b' ? shownCell(pickedSide) : null;
  const pickedPair = pickedSide === 'd' ? { a: shownCell('a'), b: shownCell('b') } : null;
  const pickedDiff = picked && pickedSide === 'd' && diffs ? diffDisplay(diffs[picked.column][picked.key].original, diffs[picked.column][picked.key].tilted, words) : null;
  let pickedDetail = '';
  if (picked && pickedColumn && (pickedSide === 'a' || pickedSide === 'b')) {
    const sheet = sheetOf(pickedSide)!;
    pickedDetail = cellDisplay(sheet.columns[picked.column].cells[picked.key], sheet.tilted?.[picked.column].cells[picked.key], words).title;
  } else if (pickedDiff) pickedDetail = pickedDiff.title;
  const pickedSpec = picked ? BAND_PARAMS.find((p) => p.key === picked.key) : undefined;
  // The histogram needs samples; the tilt range row has only the nominal tilts.
  const histogramCell = pickedCell && pickedCell.values.length > 0 && pickedCell.key !== 'tiltRange' ? pickedCell : null;
  // A B − A cell: both antennas' samples, when both have some.
  const pairA = pickedPair?.a && pickedPair.b && pickedPair.a.values.length > 0 && pickedPair.b.values.length > 0 && pickedPair.a.key !== 'tiltRange' ? pickedPair.a : null;
  const pairB = pairA ? pickedPair!.b : null;
  const histogramPair = pairA && pairB ? { a: pairA, b: pairB } : null;
  const figure = useMemo(() => {
    if (!pickedSpec) return null;
    const label = bandParamLabel(pickedSpec, settings);
    if (histogramCell) return buildBandHistFigure({ values: histogramCell.values, stat: histogramCell.stat, label, unit: histogramCell.unit }, FIGURE_THEMES[theme]);
    if (pairA && pairB && dataset && other) {
      return buildBandCompareHistFigure(
        {
          a: { name: `A: ${dataset.label}`, values: pairA.values, stat: pairA.stat },
          b: { name: `B: ${other.label}`, values: pairB.values, stat: pairB.stat },
          label,
          unit: pairA.unit,
        },
        FIGURE_THEMES[theme],
      );
    }
    return null;
  }, [histogramCell, pairA, pairB, dataset, other, pickedSpec, settings, theme]);

  // The files the histogram is made of: the antenna clicked, or both for a B − A cell.
  const histogramItems = pickedSide === 'b' ? (other?.items ?? []) : pickedSide === 'd' ? [...(dataset?.items ?? []), ...(other?.items ?? [])] : (dataset?.items ?? []);
  const histogramIds = histogramItems.map((i) => i.pattern.id);
  const marks = bandHistogramMarks(picked?.key, (hCutCounts) => sim.simulatedAmong(histogramIds, hCutCounts, false));
  const histogramTilted = tiltedColumns !== null && marks.simulated;
  const histogramState = histogramTilted ? (horizonOnly ? ('horizon cut' as const) : ('tilted' as const)) : undefined;

  const exportCaption = (() => {
    if (!pickedSpec || !pickedColumn || !dataset) return null;
    const parameter = bandParamLabel(pickedSpec, settings);
    if (histogramCell) {
      return bandHistCaption({
        antenna: pickedSide === 'b' && other ? other.label : dataset.label,
        subBand: pickedColumn.subBand,
        parameter,
        stat: histogramCell.stat,
        unit: histogramCell.unit,
        n: histogramCell.n,
        tilted: histogramTilted,
        ...(histogramState ? { state: histogramState } : {}),
      });
    }
    if (histogramPair && other && pickedDiff) {
      return bandCompareHistCaption({
        a: { name: dataset.label, stat: histogramPair.a.stat, n: histogramPair.a.n },
        b: { name: other.label, stat: histogramPair.b.stat, n: histogramPair.b.n },
        subBand: pickedColumn.subBand,
        parameter,
        unit: histogramPair.a.unit,
        difference: pickedDiff.text,
        ...(histogramState ? { state: histogramState } : {}),
      });
    }
    return null;
  })();

  // The simulated values of the horizontal rows are of the cut at the horizon (every file's, tilted or not): the exports and the note say so.
  const horizonCut = sim.hCut === 'horizon';

  // The exports are of the sliders as they stand: a simulation that is behind them is first brought up, and the export
  // is taken from the render that made (see `catchUpSimulation`, and the same in the metrics table).
  const exports = useLatest({
    exportCsv: () => {
      const sheets: BandSheet[] = datasets.map((d) => {
        const bands = subBandsFor(d.items, userSubBands);
        return {
          label: d.label,
          columns: bandTable(d.items, metrics, bands, ctx),
          ...(sim.simActive ? { tilted: bandTable(d.items, sim.metrics, bands, ctx) } : {}),
        };
      });
      const comparison = sheetA && sheetB ? { a: sheetA, b: sheetB } : undefined;
      downloadText(exportName('band-statistics', sim.simulatedAmong(datasets.flatMap((d) => d.items.map((i) => i.pattern.id)), true, false), '.csv'), '﻿' + bandCsv(sheets, settings, horizonCut, sim.tiltActive, comparison), 'text/csv;charset=utf-8');
    },
    copyTable: () =>
      void (sheetA && sheetB
        ? copyAndAnnounce(compareTsv(sheetA, sheetB, settings, horizonCut, sim.tiltActive), `Copied the band statistics of ${sheetB.label} compared with ${sheetA.label}`, setCopyNote)
        : copyAndAnnounce(bandTsv(columns, tiltedColumns, settings, horizonCut, sim.tiltActive), `Copied the band statistics of ${dataset?.label ?? ''}`, setCopyNote)),
  });
  const current = () => {
    catchUpSimulation();
    return exports.current;
  };

  if (!dataset || largest < MIN_SAMPLES) {
    return (
      <section data-testid="band-stats">
        <div className="controls">
          <h2 id={SKIP_TARGETS.band} tabIndex={-1}>Band statistics</h2>
          <DefinitionsButton onHelp={onHelp} />
        </div>
        <p className="count" data-testid="band-stats-hint">
          {hintText(largest)}
        </p>
      </section>
    );
  }

  const lobeWarning = lobeLimitWarning(settings);
  const levelLine = levelNote(settings.levelDb);
  // One button per sub-band, or three (A, B, B − A) while two antennas are compared.
  const perBand = sheetB ? SIDES.length : 1;
  const gridCols = columns.length * perBand;
  // The tab stop, kept inside the table as its columns change.
  const stopAt = { row: Math.min(stop.row, BAND_PARAMS.length - 1), col: Math.min(stop.col, Math.max(gridCols - 1, 0)) };
  const cellAt = (el: HTMLElement): { row: number; col: number } | null => {
    const button = el.closest<HTMLElement>('button[data-row][data-col]');
    return button ? { row: Number(button.dataset.row), col: Number(button.dataset.col) } : null;
  };
  const onCellKeys = (e: KeyboardEvent<HTMLElement>) => {
    const at = cellAt(e.target as HTMLElement);
    const to = at && gridTarget(e.key, e.ctrlKey || e.metaKey, at, { rows: BAND_PARAMS.length, cols: gridCols });
    if (!to) return;
    e.preventDefault();
    const next = e.currentTarget.querySelector<HTMLElement>(`button[data-row="${to.row}"][data-col="${to.col}"]`);
    next?.focus();
    next?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };
  const bandsNote = subBandsNote(other ? [...dataset.items, ...other.items] : dataset.items, userSubBands);
  // Only the files the histogram is made from count; the CSV lists every dataset.
  const histogramSimulated = marks.simulated;

  /** Changing antenna A: while comparing, the pair follows (picking B as A swaps the two). */
  const chooseA = (key: string) => {
    setChosen(key);
    if (!sheetB || !other) return;
    updateView({ bandCompare: key === other.key ? { a: key, b: dataset.key } : { a: key, b: other.key } });
  };
  const chooseB = (key: string) => {
    if (key === '') {
      // Leaving the comparison keeps A on screen.
      setChosen(dataset.key);
      updateView({ bandCompare: null });
    } else updateView({ bandCompare: { a: dataset.key, b: key } });
  };

  /** One cell button: the antenna shown (or A), B, or B − A of sub-band `i`. */
  const cell = (p: (typeof BAND_PARAMS)[number], row: number, i: number, side: Side) => {
    const col = i * perBand + SIDES.indexOf(side);
    let d: { text: string; title: string; muted: boolean };
    let n = 0;
    if (side === 'd') {
      const pair = diffs![i][p.key];
      d = diffDisplay(pair.original, pair.tilted, words);
    } else {
      const sheet = side === 'b' ? sheetB! : sheetA!;
      const original = sheet.columns[i].cells[p.key];
      const tilted = sheet.tilted?.[i].cells[p.key];
      d = cellDisplay(original, tilted, words);
      n = (tilted ?? original).n;
    }
    const scope = scopeOf(scopeKey, columns[i].subBand);
    const isPicked = picked?.key === p.key && picked.column === i && picked.side === side && picked.scope === scope;
    const toggle = () => setPicked(isPicked ? null : { key: p.key, column: i, side, scope });
    const classes = [d.muted ? 'muted' : '', sheetB && side === 'a' ? 'band-group' : '', side === 'd' ? 'band-diff' : ''].filter(Boolean).join(' ');
    return (
      <td key={`${i}${side}`} title={d.title} className={classes || undefined}>
        {/* A cell with no value shows a dash, which is no name for a button. */}
        <button
          type="button"
          data-row={row}
          data-col={col}
          tabIndex={stopAt.row === row && stopAt.col === col ? 0 : -1}
          aria-pressed={isPicked}
          aria-label={d.text === '—' ? (side === 'd' ? 'No difference' : 'No value') : undefined}
          onClick={toggle}
        >
          {d.text}
          {n > 0 && <span className="count"> n={n}</span>}
        </button>
      </td>
    );
  };

  return (
    <section data-testid="band-stats">
      <div className="controls">
        <h2 id={SKIP_TARGETS.band} tabIndex={-1}>Band statistics</h2>
        <DefinitionsButton onHelp={onHelp} />
        {datasets.length > 1 ? (
          <select aria-label="Antenna" value={dataset.key} onChange={(e) => chooseA(e.target.value)}>
            {datasets.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label} ({filesText(d.items.length)})
              </option>
            ))}
          </select>
        ) : (
          <span className="count">
            {dataset.label} ({filesText(dataset.items.length)})
          </span>
        )}
        {datasets.length > 1 && (
          <label>
            Compare with
            <select value={other?.key ?? ''} onChange={(e) => chooseB(e.target.value)}>
              <option value="">No comparison</option>
              {datasets
                .filter((d) => d.key !== dataset.key)
                .map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label} ({filesText(d.items.length)})
                  </option>
                ))}
            </select>
          </label>
        )}
        <button onClick={() => current().exportCsv()}>Export band CSV</button>
        <button title="Copy the table below as shown to paste into a spreadsheet" onClick={() => current().copyTable()}>
          Copy table
        </button>
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          Sub-bands
        </button>
      </div>
      {open && (
        <SubBandEditor
          subBands={userSubBands}
          automatic={autoSubBands((other ? [...dataset.items, ...other.items] : dataset.items).map((i) => i.pattern.frequencyMHz))}
          onChange={(next) => {
            const subBands = sanitizeSubBands(next);
            // Emptying the list ("Use automatic", or removing the last one) is "Back to automatic": typed work goes, an undo is offered.
            if (subBands.length === 0) dropSubBands();
            else updateView({ subBands });
          }}
        />
      )}
      <p className="count">
        BASTA V13 Annex C statistics over every loaded file of the antenna in each sub-band (all tilts and ports; copies
        excluded; co-polar cuts).
        {noFrequency > 0 && ` ${noFrequency} loaded file${noFrequency === 1 ? ' has' : 's have'} no frequency above 0 MHz and ${noFrequency === 1 ? 'is' : 'are'} left out.`}
        {sheetB && other && ` ${compareNote(dataset.label, other.label, !bandsNote.userDefined)}`}
        {!bandsNote.userDefined && ` ${bandsNote.text}`}
        {sim.simActive && ` ${bandStateNote(sim.hCut, sim.tiltActive)}`}
        {levelLine && ` ${levelLine}`}
        {lobeWarning && ` ${lobeWarning}`}
      </p>
      {bandsNote.userDefined && (
        <p className={bandsNote.outside > 0 ? 'warn subband-state' : 'count subband-state'} data-testid="subband-state">
          {bandsNote.text}{' '}
          <button
            type="button"
            title="Drop your sub-bands and use one per cluster of loaded frequencies again (can be undone)"
            onClick={dropSubBands}
          >
            Back to automatic
          </button>
        </p>
      )}
      <div className="table-wrap">
        {sheetB && other ? (
          <table className="band band-compare" aria-label={`Band statistics: ${other.label} compared with ${dataset.label}`}>
            <colgroup span={1} />
            {columns.map((_, i) => (
              <colgroup key={i} span={SIDES.length} />
            ))}
            <thead>
              <tr>
                <th scope="col" rowSpan={2} className="band-param">
                  Parameter
                </th>
                {columns.map((c, i) => (
                  <th key={i} scope="colgroup" colSpan={SIDES.length} className="band-group" title={`A: ${columnSummary(c)}\nB: ${columnSummary(sheetB.columns[i])}`}>
                    {c.subBand.name}
                  </th>
                ))}
              </tr>
              <tr>
                {columns.map((c, i) => [
                  <th key={`${i}a`} scope="col" className="band-group" title={`A: ${dataset.label} · ${columnSummary(c)}`}>
                    {/* Named "<sub-band>, A: <antenna>" for a screen reader (which may not read the spanning header); seen as "A". */}
                    <span className="visually-hidden">
                      {c.subBand.name}, A: {dataset.label},
                    </span>
                    <span aria-hidden="true">A</span>
                    <span className="count"> {filesText(c.files)}</span>
                  </th>,
                  <th key={`${i}b`} scope="col" title={`B: ${other.label} · ${columnSummary(sheetB.columns[i])}`}>
                    {/* Named "<sub-band>, B: <antenna>" for a screen reader (which may not read the spanning header); seen as "B". */}
                    <span className="visually-hidden">
                      {c.subBand.name}, B: {other.label},
                    </span>
                    <span aria-hidden="true">B</span>
                    <span className="count"> {filesText(sheetB.columns[i].files)}</span>
                  </th>,
                  <th key={`${i}d`} scope="col" title="B minus A: a signed difference of the two statistics, not a grade">
                    <span className="visually-hidden">{c.subBand.name}, B − A</span>
                    <span aria-hidden="true">B − A</span>
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody
              onKeyDown={onCellKeys}
              onFocus={(e) => {
                const at = cellAt(e.target as HTMLElement);
                if (at && (at.row !== stopAt.row || at.col !== stopAt.col)) setStop(at);
              }}
            >
              {BAND_PARAMS.map((p, row) => (
                <tr key={p.key}>
                  <th scope="row" title={bandParamTitle(p, settings)}>
                    {bandParamLabel(p, settings)}
                  </th>
                  {columns.map((_, i) => SIDES.map((side) => cell(p, row, i, side)))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="band" aria-label={`Band statistics for ${dataset.label}`}>
            <thead>
              <tr>
                <th scope="col">Parameter</th>
                {columns.map((c, i) => (
                  <th key={i} scope="col" title={columnSummary(c)}>
                    {c.subBand.name}
                    <span className="count"> {filesText(c.files)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody
              onKeyDown={onCellKeys}
              onFocus={(e) => {
                const at = cellAt(e.target as HTMLElement);
                if (at && (at.row !== stopAt.row || at.col !== stopAt.col)) setStop(at);
              }}
            >
              {BAND_PARAMS.map((p, row) => (
                <tr key={p.key}>
                  <th scope="row" title={bandParamTitle(p, settings)}>
                    {bandParamLabel(p, settings)}
                  </th>
                  {columns.map((_, i) => cell(p, row, i, 'a'))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pickedSpec && pickedColumn && (pickedCell || pickedPair) && (
        <p className="count">
          {bandParamLabel(pickedSpec, settings)} — {pickedColumn.subBand.name}
          {sheetB && other && pickedSide === 'a' && ` — A: ${dataset.label}`}
          {sheetB && other && pickedSide === 'b' && ` — B: ${other.label}`}
          {pickedCell && ` — N = ${pickedCell.n}`}
          {pickedPair && ` — B − A — N = ${pickedPair.a?.n ?? 0} (A), ${pickedPair.b?.n ?? 0} (B)`}
          {histogramTilted ? (horizonOnly ? ' (horizon cut)' : ' (tilted)') : ''}
        </p>
      )}
      <p className="count band-detail" data-testid="band-detail" aria-live="polite">
        {pickedDetail}
      </p>
      {figure && (
        <PlotlyChart
          className="plot wide"
          figure={figure}
          testId="plot-band"
          toolbar="xy"
          ariaLabel={pickedSide === 'd' ? 'Band statistics plot of A and B' : 'Band statistics plot'}
          labelledExport={{ caption: withSimulated(exportCaption ?? undefined, histogramSimulated ? simulatedCaption(marks.namesHCut ? sim : { ...sim, hCut: undefined }, method3d, sim.offsetsAmong(histogramIds)) : undefined, marks.namesHCut ? weightedHorizonNote(sim.hCut, method3d) : undefined), filename: exportName(pickedSide === 'd' ? 'band-comparison-histogram' : 'band-statistics-histogram', histogramSimulated) }}
        />
      )}
      {anyAdjusted([...columns, ...(otherColumns ?? [])], [...(tiltedColumns ?? []), ...(otherTilted ?? [])]) && (
        <p className="count" data-testid="band-adjusted-legend">
          {ADJUSTED_LEGEND}
        </p>
      )}
      {diffs && anySubstituted(diffs) && (
        <p className="count" data-testid="band-substituted-legend">
          {SUBSTITUTED_LEGEND}
        </p>
      )}
    </section>
  );
});
