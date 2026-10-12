import { memo, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import type { PatternMetrics, TaggedPattern } from '../core/analysis/metrics';
import { MIN_SAMPLES } from '../core/analysis/bandStats';
import { BAND_PARAMS, bandParamLabel, bandParamTitle, bandTable, columnSummary, type BandParamKey } from '../core/analysis/bandParams';
import { autoSubBands, buildDatasets, datasetKeyOf, sanitizeSubBands, subBandsFor } from '../core/analysis/subBands';
import { ADJUSTED_LEGEND, anyAdjusted, bandCsv, bandTsv, cellDisplay, defaultDataset, filesText, hintText, largestDataset, lobeLimitWarning, type BandSheet } from './bandView';
import { bandHistCaption, buildBandHistFigure } from './bandHistFigure';
import { hasUsableFrequency } from '../core/gain';
import { downloadText } from './download';
import { withSimulated } from './exportFigure';
import { exportName, hCutLabel, simulatedCaption } from './simSummary';
import { copyAndAnnounce } from './clipboard';
import { FIGURE_THEMES } from './figureTheme';
import { PlotlyChart } from './PlotlyChart';
import { SubBandEditor } from './SubBandEditor';
import { DefinitionsButton, type OpenHelp } from './HelpDialog';
import type { SimulationResult } from './useSimulation';

/** A clicked cell; `scope` ties it to the dataset and sub-band it was clicked in. */
interface Picked {
  key: BandParamKey;
  column: number;
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
  const setCopyNote = useStore((s) => s.setCopyNote);
  const [chosen, setChosen] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const theme = useStore((s) => s.view.theme);
  const method3d = useStore((s) => s.view.method3d);

  const datasets = useMemo(() => buildDatasets(tagged, customGroups), [tagged, customGroups]);
  const largest = largestDataset(datasets);
  const noFrequency = useMemo(() => tagged.filter((t) => !t.copyOf && !hasUsableFrequency(t.pattern.frequencyMHz)).length, [tagged]);
  const dataset =
    datasets.find((d) => d.key === chosen) ??
    datasets.find((d) => d.key === highlightedKey) ??
    defaultDataset(datasets);

  const subBands = useMemo(() => (dataset ? subBandsFor(dataset.items, userSubBands) : []), [dataset, userSubBands]);
  const ctx = useMemo(() => ({ gainUnit, settings }), [gainUnit, settings]);
  const columns = useMemo(
    () => (dataset ? bandTable(dataset.items, metrics, subBands, ctx) : []),
    [dataset, metrics, subBands, ctx],
  );
  const tiltedColumns = useMemo(
    () => (dataset && sim.tiltActive ? bandTable(dataset.items, sim.metrics, subBands, ctx) : null),
    [dataset, sim.tiltActive, sim.metrics, subBands, ctx],
  );

  const pickedColumn =
    picked && dataset && columns[picked.column] && scopeOf(dataset.key, columns[picked.column].subBand) === picked.scope
      ? columns[picked.column]
      : null;
  const pickedCell = picked && pickedColumn ? (tiltedColumns?.[picked.column] ?? pickedColumn).cells[picked.key] : null;
  const pickedDetail =
    picked && pickedColumn ? cellDisplay(pickedColumn.cells[picked.key], tiltedColumns?.[picked.column].cells[picked.key]).title : '';
  const pickedSpec = picked ? BAND_PARAMS.find((p) => p.key === picked.key) : undefined;
  // The histogram needs samples; the tilt range row has only the nominal tilts.
  const histogramCell = pickedCell && pickedCell.values.length > 0 && pickedCell.key !== 'tiltRange' ? pickedCell : null;
  const figure = useMemo(
    () =>
      histogramCell && pickedSpec
        ? buildBandHistFigure(
            {
              values: histogramCell.values,
              stat: histogramCell.stat,
              label: bandParamLabel(pickedSpec, settings),
              unit: histogramCell.unit,
            },
            FIGURE_THEMES[theme],
          )
        : null,
    [histogramCell, pickedSpec, settings, theme],
  );

  const exportCaption = useMemo(
    () =>
      histogramCell && pickedSpec && pickedColumn && dataset
        ? bandHistCaption({
            antenna: dataset.label,
            subBand: pickedColumn.subBand,
            parameter: bandParamLabel(pickedSpec, settings),
            stat: histogramCell.stat,
            unit: histogramCell.unit,
            n: histogramCell.n,
            tilted: tiltedColumns !== null,
          })
        : null,
    [histogramCell, pickedSpec, pickedColumn, dataset, settings, tiltedColumns],
  );

  if (!dataset || largest < MIN_SAMPLES) {
    return (
      <section data-testid="band-stats">
        <div className="controls">
          <h2>Band statistics</h2>
          <DefinitionsButton onHelp={onHelp} />
        </div>
        <p className="count" data-testid="band-stats-hint">
          {hintText(largest)}
        </p>
      </section>
    );
  }

  const lobeWarning = lobeLimitWarning(settings);
  // Only the files the histogram is made from count; the CSV lists every dataset.
  const histogramSimulated = sim.simulatedAmong(dataset.items.map((i) => i.pattern.id));

  // The tilted values of the horizontal rows are of the cut at the horizon: the exports and the note say so.
  const horizonCut = sim.tiltActive && sim.hCut === 'horizon';

  const exportCsv = () => {
    const sheets: BandSheet[] = datasets.map((d) => {
      const bands = subBandsFor(d.items, userSubBands);
      return {
        label: d.label,
        columns: bandTable(d.items, metrics, bands, ctx),
        ...(sim.tiltActive ? { tilted: bandTable(d.items, sim.metrics, bands, ctx) } : {}),
      };
    });
    downloadText(exportName('band-statistics', sim.simulatedAmong(datasets.flatMap((d) => d.items.map((i) => i.pattern.id))), '.csv'), '﻿' + bandCsv(sheets, settings, horizonCut), 'text/csv;charset=utf-8');
  };

  return (
    <section data-testid="band-stats">
      <div className="controls">
        <h2>Band statistics</h2>
        <DefinitionsButton onHelp={onHelp} />
        {datasets.length > 1 ? (
          <select aria-label="Antenna" value={dataset.key} onChange={(e) => setChosen(e.target.value)}>
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
        <button onClick={exportCsv}>Export band CSV</button>
        <button
          title="Copy the table below as shown to paste into a spreadsheet"
          onClick={() => void copyAndAnnounce(bandTsv(columns, tiltedColumns, settings, horizonCut), `Copied the band statistics of ${dataset.label}`, setCopyNote)}
        >
          Copy table
        </button>
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          Sub-bands
        </button>
      </div>
      {open && (
        <SubBandEditor
          subBands={userSubBands}
          automatic={autoSubBands(dataset.items.map((i) => i.pattern.frequencyMHz))}
          onChange={(next) => updateView({ subBands: sanitizeSubBands(next) })}
        />
      )}
      <p className="count">
        BASTA V13 Annex C statistics over every loaded file of the antenna in each sub-band (all tilts and ports; copies
        excluded; co-polar cuts).
        {noFrequency > 0 && ` ${noFrequency} loaded file${noFrequency === 1 ? ' has' : 's have'} no frequency above 0 MHz and ${noFrequency === 1 ? 'is' : 'are'} left out.`}
        {userSubBands.length === 0 && ' Sub-bands are automatic.'}
        {sim.tiltActive && ` Simulation active: cells show original → tilted where they differ (${hCutLabel(sim.hCut)}).`}
        {settings.levelDb !== 3 &&
          ` Beamwidth level is ${settings.levelDb} dB: the beamwidth, squint and tilt rows are not half-power values.`}
        {lobeWarning && ` ${lobeWarning}`}
      </p>
      <div className="table-wrap">
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
          <tbody>
            {BAND_PARAMS.map((p) => (
              <tr key={p.key}>
                <th scope="row" title={bandParamTitle(p, settings)}>
                  {bandParamLabel(p, settings)}
                </th>
                {columns.map((c, i) => {
                  const original = c.cells[p.key];
                  const tilted = tiltedColumns?.[i].cells[p.key];
                  const shown = tilted ?? original;
                  const d = cellDisplay(original, tilted);
                  const scope = scopeOf(dataset.key, c.subBand);
                  const isPicked = picked?.key === p.key && picked.column === i && picked.scope === scope;
                  const toggle = () => setPicked(isPicked ? null : { key: p.key, column: i, scope });
                  return (
                    <td key={i} title={d.title} className={d.muted ? 'muted' : undefined}>
                      <button type="button" aria-pressed={isPicked} onClick={toggle}>
                        {d.text}
                        {shown.n > 0 && <span className="count"> n={shown.n}</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pickedCell && pickedSpec && pickedColumn && (
        <p className="count">
          {bandParamLabel(pickedSpec, settings)} — {pickedColumn.subBand.name} — N = {pickedCell.n}
          {tiltedColumns ? ' (tilted)' : ''}
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
          ariaLabel="Band statistics plot"
          labelledExport={{ caption: withSimulated(exportCaption ?? undefined, histogramSimulated ? simulatedCaption(sim, method3d, sim.offsetsAmong(dataset.items.map((i) => i.pattern.id))) : undefined), filename: exportName('band-statistics-histogram', histogramSimulated) }}
        />
      )}
      {anyAdjusted(columns, tiltedColumns) && (
        <p className="count" data-testid="band-adjusted-legend">
          {ADJUSTED_LEGEND}
        </p>
      )}
    </section>
  );
});
