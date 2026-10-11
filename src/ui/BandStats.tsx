import { memo, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import type { PatternMetrics, TaggedPattern } from '../core/analysis/metrics';
import { MIN_SAMPLES } from '../core/analysis/bandStats';
import { BAND_PARAMS, bandParamLabel, bandParamTitle, bandTable, columnSummary } from '../core/analysis/bandParams';
import { autoSubBands, buildDatasets, sanitizeSubBands, subBandsFor } from '../core/analysis/subBands';
import { bandCsv, cellDisplay, hintText, largestDataset, type BandSheet } from './bandView';
import { downloadText } from './download';
import { SubBandEditor } from './SubBandEditor';
import type { SimulationResult } from './useSimulation';

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
  const highlighted = useStore((s) => s.highlighted);
  const userSubBands = useStore((s) => s.view.subBands);
  const gainUnit = useStore((s) => s.view.gainUnit);
  const settings = useStore((s) => s.settings);
  const updateView = useStore((s) => s.updateView);
  const [chosen, setChosen] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const datasets = useMemo(() => buildDatasets(tagged, customGroups), [tagged, customGroups]);
  const largest = largestDataset(datasets);
  const dataset =
    datasets.find((d) => d.key === chosen) ??
    datasets.find((d) => d.items.some((i) => i.pattern.id === highlighted)) ??
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
        <table className="band">
          <thead>
            <tr>
              <th>Parameter</th>
              {columns.map((c, i) => (
                <th key={i} title={columnSummary(c)}>
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
                  return (
                    <td key={i} title={d.title} className={d.muted ? 'muted' : undefined}>
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
    </section>
  );
});
