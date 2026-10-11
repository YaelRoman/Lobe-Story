import { memo, useMemo } from 'react';
import { useStore } from '../state/store';
import type { GroupView } from '../state/selectors';
import type { PatternMetrics } from '../core/analysis/metrics';
import { buildRows, COLUMN_GROUPS, columnLabel, columnTitle, formatCell, simulationLabel, toCsv, visibleColumns } from './table';
import { downloadText } from './download';
import type { SimulationResult } from './useSimulation';

export const MetricsTable = memo(function MetricsTable({
  groups,
  metrics,
  sim,
}: {
  groups: GroupView[];
  metrics: Map<string, PatternMetrics>;
  colors: Map<string, string>;
  sim: SimulationResult;
}) {
  const gainUnit = useStore((s) => s.view.gainUnit);
  const fbWindowDeg = useStore((s) => s.settings.fbWindowDeg);
  const sectorEdgeDeg = useStore((s) => s.settings.sectorEdgeDeg);
  const siteSectors = useStore((s) => s.settings.siteSectors);
  const tableGroups = useStore((s) => s.view.tableGroups);
  const updateView = useStore((s) => s.updateView);
  const columns = visibleColumns(tableGroups);
  const highlighted = useStore((s) => s.highlighted);
  const setHighlighted = useStore((s) => s.setHighlighted);
  const setVisible = useStore((s) => s.setVisible);

  const rows = useMemo(
    () => buildRows(groups, metrics, gainUnit, sim.tiltActive ? sim.metrics : undefined, sim.isTiltedId),
    [groups, metrics, gainUnit, sim],
  );

  return (
    <section>
      <div className="controls">
        <h2>Metrics</h2>
        <button
          onClick={() =>
            downloadText(
              'pattern-metrics.csv',
              '﻿' + toCsv(rows, gainUnit, fbWindowDeg, sim.tiltActive ? sim.effective : undefined),
              'text/csv;charset=utf-8',
            )
          }
        >
          Export CSV
        </button>
        <span className="count">Columns</span>
        {COLUMN_GROUPS.map(({ key, label }) => (
          <label key={key}>
            <input
              type="checkbox"
              aria-label={`Show ${label} columns`}
              checked={tableGroups[key]}
              onChange={(e) => updateView({ tableGroups: { ...tableGroups, [key]: e.target.checked } })}
            />
            {label}
          </label>
        ))}
        {sim.tiltActive && <p className="count">{simulationLabel(sim.tilt, sim.offsetCount, sim.groupOffsetCount)}</p>}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Group</th>
              <th>MHz</th>
              <th>Gain ({gainUnit})</th>
              {columns.map((c) => (
                <th key={c.key} title={columnTitle(c.key, { sectorEdgeDeg, siteSectors })}>
                  {columnLabel(c, fbWindowDeg)} ({c.unit})
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={r.id === highlighted ? 'hl' : undefined}
                onClick={() => {
                  setVisible([r.id], true);
                  setHighlighted(r.id);
                }}
              >
                <td title={r.id}>{r.file}</td>
                <td>{r.group}</td>
                <td>{r.freq}</td>
                <td>{r.gain === null ? '—' : r.gain.toFixed(2)}</td>
                {columns.map((c) => {
                  const cell = formatCell(r.cells[c.key], r.tilted?.[c.key]);
                  return (
                    <td key={c.key} title={cell.title}>
                      {cell.text}
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
