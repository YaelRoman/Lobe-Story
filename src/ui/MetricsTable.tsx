import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from '../state/store';
import type { GroupView } from '../state/selectors';
import type { PatternMetrics } from '../core/analysis/metrics';
import {
  ariaSort, buildRows, COLUMN_GROUPS, columnLabel, columnTitle, formatCell, nextSort, revealScrollTop, simulationLabel,
  shouldReveal, sortIfShown, sortRows, toCsv, visibleColumns, type SortKey, type SortState,
} from './table';
import { middleEllipsis } from './legend';
import { focusPreviews, hoverPreviews } from './hoverPreview';
import { useTablePreview } from './useTablePreview';
import { moveFocus, onSpace, tabStopKey } from './rovingKeys';
import { downloadText } from './download';
import { DefinitionsButton, type OpenHelp } from './HelpDialog';
import type { SimulationResult } from './useSimulation';

const FILE_NAME_MAX = 28;
export const SIMULATION_BLANK_NOTE =
  '— = not defined (e.g. the horizon cut leaves the main beam); hover a dotted cell for the reason.';

export const MetricsTable = memo(function MetricsTable({
  groups,
  metrics,
  sim,
  onHelp,
}: {
  onHelp: OpenHelp;
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
  const levelDb = useStore((s) => s.settings.levelDb);
  const tableGroups = useStore((s) => s.view.tableGroups);
  const updateView = useStore((s) => s.updateView);
  const columns = visibleColumns(tableGroups);
  const highlighted = useStore((s) => s.highlighted);
  const pickFile = useStore((s) => s.pickFile);
  const setVisible = useStore((s) => s.setVisible);

  // Sorting is a view of this table only (not saved in projects); the CSV export follows it.
  const [chosenSort, setSort] = useState<SortState | null>(null);
  // Hiding the sorted column clears the sort (rows and CSV would stay reordered with no indicator).
  const sort = sortIfShown(chosenSort, columns);
  useEffect(() => {
    if (chosenSort && !sort) setSort(null);
  }, [chosenSort, sort]);
  const wrapRef = useRef<HTMLDivElement>(null);
  // The one row that is a tab stop; Up/Down move it (roving tabindex).
  const [activeRow, setActiveRow] = useState<string | null>(null);
  const revealed = useRef<{ id: string | null; sort: SortState | null } | null>(null);

  const rows = useMemo(
    () =>
      sortRows(
        buildRows(groups, metrics, gainUnit, sim.tiltActive ? sim.metrics : undefined, sim.isTiltedId),
        sort,
      ),
    [groups, metrics, gainUnit, sim, sort],
  );

  // A highlight set from the panel or a plot brings its row into view inside the table (not the page).
  // Only when the highlighted file or the sort changes: rebuilt rows (slider ticks) must not move the scroll.
  useEffect(() => {
    const wrap = wrapRef.current;
    const cur = { id: highlighted, sort };
    const reveal = shouldReveal(revealed.current, cur);
    revealed.current = highlighted === null ? null : cur;
    const row = reveal ? wrap?.querySelector<HTMLElement>('tr.hl') : null;
    if (!wrap || !row) return;
    // Rounded up: a fractional header height (Firefox) must never leave the row clipped by a fraction of a pixel.
    const headerHeight = Math.ceil(wrap.querySelector('thead')?.getBoundingClientRect().height ?? 0);
    const top = revealScrollTop(
      { top: row.offsetTop, height: row.offsetHeight },
      { scrollTop: wrap.scrollTop, clientHeight: wrap.clientHeight, headerHeight },
    );
    if (top !== wrap.scrollTop) wrap.scrollTop = top;
  }, [highlighted, rows, sort]);

  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const setHoverId = useTablePreview(rowIds);
  const stop = tabStopKey(rows.map((r) => r.id), activeRow);
  const onBodyKeys = (e: KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.hasAttribute('data-nav')) moveFocus(e, Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-nav]')), target);
  };
  const toggleRow = (id: string) => setVisible([id], !useStore.getState().visible[id]);

  const sortLabel = (key: SortKey): string => {
    const fixed: Partial<Record<SortKey, string>> = { file: 'File', group: 'Group', freq: 'MHz', gain: `Gain (${gainUnit})` };
    const col = columns.find((c) => c.key === key);
    return fixed[key] ?? (col ? columnLabel(col, fbWindowDeg, uslsRangeDeg, levelDb) : key);
  };

  const header = (key: SortKey, content: string, title?: string, className?: string) => (
    <th key={key} scope="col" title={title} className={className} aria-sort={ariaSort(sort, key)}>
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
              '﻿' + toCsv(rows, gainUnit, fbWindowDeg, sim.tiltActive ? sim.effective : undefined, uslsRangeDeg, levelDb),
              'text/csv;charset=utf-8',
            )
          }
        >
          Export CSV
        </button>
        {sort && (
          <span className="count sort-hint" data-testid="sort-hint">
            Sorted by {sortLabel(sort.key)} {sort.dir === 'asc' ? '↑' : '↓'} (CSV follows)
            <button type="button" onClick={() => setSort(null)}>
              Clear sort
            </button>
          </span>
        )}
        <DefinitionsButton onHelp={onHelp} />
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
                  `${columnLabel(c, fbWindowDeg, uslsRangeDeg, levelDb)} (${c.unit})`,
                  columnTitle(c.key, { sectorEdgeDeg, siteSectors, uslsRangeDeg, lobeLimitFactor, levelDb, fbWindowDeg }),
                ),
              )}
            </tr>
          </thead>
          <tbody
            onKeyDown={onBodyKeys}
            onFocus={(e) => {
              const id = (e.target as HTMLElement).closest<HTMLElement>('tr')?.dataset.rowId;
              if (id) setActiveRow(id);
            }}
          >
            {rows.map((r) => (
              <tr
                key={r.id}
                data-row-id={r.id}
                className={r.id === highlighted ? 'hl' : undefined}
                onClick={() => pickFile(r.id)}
                onPointerEnter={(e) => hoverPreviews(e) && setHoverId(r.id)}
                onPointerLeave={() => setHoverId(null)}
                onFocus={(e) => focusPreviews(e.target) && setHoverId(r.id)}
                onBlur={() => setHoverId(null)}
              >
                <td>
                  <button
                    type="button"
                    className="row-main file-cell"
                    data-nav
                    tabIndex={stop === r.id ? 0 : -1}
                    aria-current={r.id === highlighted || undefined}
                    title={
                      (r.file.length > FILE_NAME_MAX ? `${r.file}\n${r.id}` : r.id) +
                      '\nEnter: show and highlight (again: clear) · Space: show or hide · Up/Down: next row'
                    }
                    {...onSpace(() => toggleRow(r.id))}
                  >
                    {middleEllipsis(r.file, FILE_NAME_MAX)}
                  </button>
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
