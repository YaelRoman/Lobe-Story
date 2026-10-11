import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { GroupView } from '../state/selectors';
import type { PatternMetrics } from '../core/analysis/metrics';
import {
  ariaSort, buildRows, COLUMN_GROUPS, columnLabel, columnTitle, formatCell, nextSort, revealScrollTop, simulationLabel,
  sortRows, toCsv, visibleColumns, type SortKey, type SortState,
} from './table';
import { middleEllipsis } from './legend';
import { downloadText } from './download';
import type { SimulationResult } from './useSimulation';

const FILE_NAME_MAX = 28;
export const SIMULATION_BLANK_NOTE =
  '— = not defined (e.g. the horizon cut leaves the main beam); hover a dotted cell for the reason.';

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
  const uslsRangeDeg = useStore((s) => s.settings.uslsRangeDeg);
  const lobeLimitFactor = useStore((s) => s.settings.lobeLimitFactor);
  const tableGroups = useStore((s) => s.view.tableGroups);
  const updateView = useStore((s) => s.updateView);
  const columns = visibleColumns(tableGroups);
  const highlighted = useStore((s) => s.highlighted);
  const setHighlighted = useStore((s) => s.setHighlighted);
  const setVisible = useStore((s) => s.setVisible);

  // Sorting is a view of this table only (not saved in projects); the CSV export follows it.
  const [sort, setSort] = useState<SortState | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () =>
      sortRows(
        buildRows(groups, metrics, gainUnit, sim.tiltActive ? sim.metrics : undefined, sim.isTiltedId),
        sort,
      ),
    [groups, metrics, gainUnit, sim, sort],
  );

  // A highlight set from the panel or a plot brings its row into view inside the table (not the page).
  useEffect(() => {
    const wrap = wrapRef.current;
    const row = highlighted === null ? null : wrap?.querySelector<HTMLElement>('tr.hl');
    if (!wrap || !row) return;
    const headerHeight = wrap.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    const top = revealScrollTop(
      { top: row.offsetTop, height: row.offsetHeight },
      { scrollTop: wrap.scrollTop, clientHeight: wrap.clientHeight, headerHeight },
    );
    if (top !== wrap.scrollTop) wrap.scrollTop = top;
  }, [highlighted, rows]);

  const header = (key: SortKey, content: string, title?: string, className?: string) => (
    <th key={key} title={title} className={className} aria-sort={ariaSort(sort, key)}>
      <button type="button" className="sort-btn" onClick={() => setSort((cur) => nextSort(cur, key))}>
        {content}
        <span className="sort-arrow" aria-hidden="true">
          {sort?.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  );

  return (
    <section>
      <div className="controls">
        <h2>Metrics</h2>
        <button
          onClick={() =>
            downloadText(
              'pattern-metrics.csv',
              '﻿' + toCsv(rows, gainUnit, fbWindowDeg, sim.tiltActive ? sim.effective : undefined, uslsRangeDeg),
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
        {sim.tiltActive && (
          <p className="count">
            {simulationLabel(sim.tilt, sim.offsetCount, sim.groupOffsetCount)}
            <span data-testid="sim-blank-note"> · {SIMULATION_BLANK_NOTE}</span>
          </p>
        )}
      </div>
      <div className="table-wrap metrics-wrap" ref={wrapRef}>
        <table className="metrics">
          <thead>
            <tr>
              {header('file', 'File')}
              {header('group', 'Group')}
              {header('freq', 'MHz')}
              {header('gain', `Gain (${gainUnit})`)}
              {columns.map((c) =>
                header(
                  c.key,
                  `${columnLabel(c, fbWindowDeg, uslsRangeDeg)} (${c.unit})`,
                  columnTitle(c.key, { sectorEdgeDeg, siteSectors, uslsRangeDeg, lobeLimitFactor }),
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                data-row-id={r.id}
                className={r.id === highlighted ? 'hl' : undefined}
                onClick={() => {
                  setVisible([r.id], true);
                  setHighlighted(r.id);
                }}
              >
                <td title={r.file.length > FILE_NAME_MAX ? `${r.file}\n${r.id}` : r.id}>
                  {middleEllipsis(r.file, FILE_NAME_MAX)}
                </td>
                <td>{r.group}</td>
                <td>{r.freq}</td>
                <td>{r.gain === null ? '—' : r.gain.toFixed(2)}</td>
                {columns.map((c) => {
                  const cell = formatCell(r.cells[c.key], r.tilted?.[c.key]);
                  return (
                    <td key={c.key} title={cell.title} className={cell.title ? 'has-reason' : undefined}>
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
