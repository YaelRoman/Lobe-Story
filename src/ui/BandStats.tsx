import { memo, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import type { PatternMetrics, TaggedPattern } from '../core/analysis/metrics';
import { MIN_SAMPLES } from '../core/analysis/bandStats';
import { BAND_PARAMS, bandParamLabel, bandParamTitle, bandTable, columnSummary, type BandParamKey } from '../core/analysis/bandParams';
import { autoSubBands, buildDatasets, datasetKeyOf, sanitizeSubBands, subBandsFor } from '../core/analysis/subBands';
import { ADJUSTED_LEGEND, anyAdjusted, bandCsv, cellDisplay, hintText, largestDataset, type BandSheet } from './bandView';
import { buildBandHistFigure } from './bandHistFigure';
import { downloadText } from './download';
import { FIGURE_THEMES } from './figureTheme';
import { PlotlyChart } from './PlotlyChart';
import { SubBandEditor } from './SubBandEditor';
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
}: {
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
  const [chosen, setChosen] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const theme = useStore((s) => s.view.theme);

  const datasets = useMemo(() => buildDatasets(tagged, customGroups), [tagged, customGroups]);
  const largest = largestDataset(datasets);
  const dataset =
    datasets.find((d) => d.key === chosen) ??
    datasets.find((d) => d.key === highlightedKey) ??
    datasets[0];

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
  const figure = useMemo(
    () =>
      pickedCell && pickedSpec
        ? buildBandHistFigure(
            {
              values: pickedCell.values,
              stat: pickedCell.stat,
              label: bandParamLabel(pickedSpec, settings),
              unit: pickedCell.unit,
            },
            FIGURE_THEMES[theme],
          )
        : null,
    [pickedCell, pickedSpec, settings, theme],
  );

  if (!dataset || largest < MIN_SAMPLES) {
    return (
      <section data-testid="band-stats">
        <h2>Band statistics</h2>
        <p className="count" data-testid="band-stats-hint">
          {hintText(largest)}
        </p>
      </section>
    );
  }

  const exportCsv = () => {
    const sheets: BandSheet[] = datasets.map((d) => {
      const bands = subBandsFor(d.items, userSubBands);
      return {
        label: d.label,
        columns: bandTable(d.items, metrics, bands, ctx),
        ...(sim.tiltActive ? { tilted: bandTable(d.items, sim.metrics, bands, ctx) } : {}),
      };
    });
    downloadText('band-statistics.csv', '﻿' + bandCsv(sheets, settings), 'text/csv;charset=utf-8');
  };

  return (
    <section data-testid="band-stats">
      <div className="controls">
        <h2>Band statistics</h2>
        {datasets.length > 1 ? (
          <select aria-label="Antenna" value={dataset.key} onChange={(e) => setChosen(e.target.value)}>
            {datasets.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label} ({d.items.length})
              </option>
            ))}
          </select>
        ) : (
          <span className="count">
            {dataset.label} ({dataset.items.length} files)
          </span>
        )}
        <button onClick={exportCsv}>Export band CSV</button>
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
        {userSubBands.length === 0 && ' Sub-bands are automatic.'}
        {sim.tiltActive && ' Simulation active: cells show original → tilted where they differ.'}
        {settings.levelDb !== 3 &&
          ` Beamwidth level is ${settings.levelDb} dB: the beamwidth, squint and tilt rows are not half-power values.`}
      </p>
      <div className="table-wrap">
        <table className="band" aria-label={`Band statistics for ${dataset.label}`}>
          <thead>
            <tr>
              <th scope="col">Parameter</th>
              {columns.map((c, i) => (
                <th key={i} scope="col" title={columnSummary(c)}>
                  {c.subBand.name}
                  <span className="count"> {c.files} files</span>
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
                  const clickable = shown.values.length > 0 && p.key !== 'tiltRange';
                  const isPicked = picked?.key === p.key && picked.column === i && picked.scope === scope;
                  const toggle = () => setPicked(isPicked ? null : { key: p.key, column: i, scope });
                  return (
                    <td
                      key={i}
                      title={d.title}
                      className={[d.muted ? 'muted' : '', isPicked ? 'sel' : ''].filter(Boolean).join(' ') || undefined}
                      aria-selected={clickable ? isPicked : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={clickable ? toggle : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggle();
                              }
                            }
                          : undefined
                      }
                    >
                      {d.text}
                      {shown.n > 0 && <span className="count"> n={shown.n}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {figure && pickedCell && pickedSpec && pickedColumn && (
        <>
          <p className="count">
            {bandParamLabel(pickedSpec, settings)} — {pickedColumn.subBand.name} — N = {pickedCell.n}
            {tiltedColumns ? ' (tilted)' : ''}
          </p>
          <p className="count band-detail" data-testid="band-detail">
            {pickedDetail}
          </p>
          <PlotlyChart className="plot wide" figure={figure} testId="plot-band" />
        </>
      )}
      {anyAdjusted(columns, tiltedColumns) && (
        <p className="count" data-testid="band-adjusted-legend">
          {ADJUSTED_LEGEND}
        </p>
      )}
    </section>
  );
});
