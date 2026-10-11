import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from '../state/store';
import type { GroupView } from '../state/selectors';
import type { PatternMetrics } from '../core/analysis/metrics';
import {
  ariaSort, buildRows, COLUMN_GROUPS, columnLabel, columnTitle, nextSort, revealScrollTop, simulationLabel,
  cellText, clearOfSticky, gainText, markReference, rowCell, rowToTsv, shouldReveal, sortIfShown, sortRows, toCsv, toTsv, visibleColumns, type SortKey, type SortState,
} from './table';
import { middleEllipsis } from './legend';
import { focusPreviews, hoverPreviews } from './hoverPreview';
import { useTablePreview } from './useTablePreview';
import { moveFocus, onSpace, tabStopKey } from './rovingKeys';
import { downloadText } from './download';
import { copiedRow, copiedRows, copiedValue, copyAndAnnounce } from './clipboard';
import { copyShortcut } from './copyKeys';
import { DefinitionsButton, type OpenHelp } from './HelpDialog';
import { PinMark } from './PinMark';
import type { MetricColumn } from './table';
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
  const setCopyNote = useStore((s) => s.setCopyNote);
  const reference = useStore((s) => s.reference);
  const setReference = useStore((s) => s.setReference);
  const deltaChosen = useStore((s) => s.view.deltaVsReference);

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

  const baseRows = useMemo(
    () => buildRows(groups, metrics, gainUnit, sim.tiltActive ? sim.metrics : undefined, sim.isTiltedId),
    [groups, metrics, gainUnit, sim],
  );
  // The reference file's row (it may be missing: no metrics, or the file is not loaded yet).
  const referenceName = baseRows.find((r) => r.id === reference)?.file ?? null;
  const deltaOn = deltaChosen && referenceName !== null;
  const rows = useMemo(
    () => sortRows(markReference(baseRows, reference, deltaOn), sort),
    [baseRows, reference, deltaOn, sort],
  );
  const deltaVs = deltaOn ? (referenceName ?? undefined) : undefined;
  // In the difference view under a tilt simulation the differences are of the tilted values: the exports say so.
  const deltaTilted = deltaOn && sim.tiltActive;
  // The cell that has focus shows the one copy button (a row id and a column key).
  const [focusedCell, setFocusedCell] = useState<{ id: string; col: string } | null>(null);

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
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const copy = (text: string, done: string) => void copyAndAnnounce(text, done, setCopyNote);
  const copyRow = (id: string) => {
    const r = rowById.get(id);
    if (r) copy(rowToTsv(r, columns), copiedRow(r.file));
  };
  const copyCell = (id: string, key: string) => {
    const r = rowById.get(id);
    if (r) {
      const text = cellText(r, key as MetricColumn);
      copy(text, copiedValue(text));
    }
  };
  const onBodyKeys = (e: KeyboardEvent<HTMLElement>) => {
    let target = e.target as HTMLElement;
    // On the Copy value button the keys act as on its cell, except Enter and Space: those stay the button's own click.
    if (target.classList.contains('copy-cell')) {
      const cell = target.closest<HTMLElement>('td[data-col]');
      if (!cell || e.key === 'Enter' || e.key === ' ') return;
      target = cell;
    }
    const tr = target.closest<HTMLElement>('tr');
    if (target.hasAttribute('data-nav')) {
      if (copyShortcut(e) && tr?.dataset.rowId) {
        e.preventDefault();
        copyRow(tr.dataset.rowId);
      } else if (e.key === 'ArrowRight' && tr) {
        // Into the row's cells: Left/Right move along them, Up/Down along the column, Enter or Ctrl/Cmd+C copies the value.
        const first = tr.querySelector<HTMLElement>('td[data-col]');
        if (first) {
          e.preventDefault();
          first.focus();
        }
      } else moveFocus(e, Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-nav]')), target);
    } else if (target.matches('td[data-col]') && tr) {
      const cells = Array.from(tr.querySelectorAll<HTMLElement>('td[data-col]'));
      const at = cells.indexOf(target);
      const adjacent = (dir: 'previousElementSibling' | 'nextElementSibling') => {
        const other = tr[dir];
        return other?.querySelectorAll<HTMLElement>('td[data-col]')[at] ?? null;
      };
      let to: HTMLElement | null | undefined;
      if (copyShortcut(e) || e.key === 'Enter') {
        e.preventDefault();
        copyCell(tr.dataset.rowId ?? '', target.dataset.col ?? '');
        return;
      } else if (e.key === 'ArrowRight') to = cells[at + 1];
      else if (e.key === 'ArrowLeft') to = at === 0 ? tr.querySelector<HTMLElement>('[data-nav]') : cells[at - 1];
      else if (e.key === 'ArrowDown') to = adjacent('nextElementSibling');
      else if (e.key === 'ArrowUp') to = adjacent('previousElementSibling');
      else return;
      e.preventDefault();
      if (to) {
        to.focus({ preventScroll: true });
        to.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        revealCell(to);
      }
    }
  };
  // The browser's own scrolling knows nothing of the sticky File column and header: move the cell out from under them.
  const revealCell = (cell: HTMLElement) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const w = wrap.getBoundingClientRect();
    const area = { left: w.left, right: w.left + wrap.clientWidth, top: w.top, bottom: w.top + wrap.clientHeight };
    const coveredLeft = cell.closest('tr')?.firstElementChild?.getBoundingClientRect().width ?? 0;
    const coveredTop = Math.ceil(wrap.querySelector('thead')?.getBoundingClientRect().height ?? 0);
    const { dx, dy } = clearOfSticky(cell.getBoundingClientRect(), area, coveredLeft, coveredTop);
    if (dx) wrap.scrollLeft += dx;
    if (dy) wrap.scrollTop += dy;
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
              '﻿' + toCsv(rows, gainUnit, fbWindowDeg, sim.tiltActive ? sim.effective : undefined, uslsRangeDeg, levelDb, deltaVs, deltaTilted),
              'text/csv;charset=utf-8',
            )
          }
        >
          Export CSV
        </button>
        <button
          title="Copy the table as shown (visible columns, current order) to paste into a spreadsheet"
          onClick={() => copy(toTsv(rows, columns, gainUnit, fbWindowDeg, uslsRangeDeg, levelDb, deltaVs, deltaTilted), copiedRows(rows.length))}
        >
          Copy table
        </button>
        <label
          className="delta-toggle"
          title={
            referenceName === null
              ? 'Pin a reference file first: ⋯ menu of a file, Use as reference'
              : `Show every metric as the difference from ${referenceName} (signed, same unit). Under a tilt simulation the tilted value is used where a cell has one. Sorting, CSV and copy follow what is shown.`
          }
        >
          <input
            type="checkbox"
            checked={deltaOn}
            disabled={referenceName === null}
            onChange={(e) => updateView({ deltaVsReference: e.target.checked })}
          />
          Δ vs reference
        </label>
        {referenceName !== null && (
          <span className="count ref-note" data-testid="reference-note">
            <PinMark /> Reference: {referenceName}
            <button type="button" onClick={() => setReference(null)}>
              Clear reference
            </button>
          </span>
        )}
        {sort && (
          <span className="count sort-hint" data-testid="sort-hint">
            Sorted by {sortLabel(sort.key)} {sort.dir === 'asc' ? '↑' : '↓'} (CSV and copy follow)
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
              {header('gain', `${deltaOn ? 'Δ ' : ''}Gain (${gainUnit})`)}
              {columns.map((c) =>
                header(
                  c.key,
                  `${deltaOn ? 'Δ ' : ''}${columnLabel(c, fbWindowDeg, uslsRangeDeg, levelDb)} (${c.unit})`,
                  [
                    deltaOn ? `Difference from ${referenceName} (the reference row, first, shows its own values).` : '',
                    columnTitle(c.key, { sectorEdgeDeg, siteSectors, uslsRangeDeg, lobeLimitFactor, levelDb, fbWindowDeg }) ?? '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined,
                ),
              )}
            </tr>
          </thead>
          <tbody
            onKeyDown={onBodyKeys}
            onFocus={(e) => {
              const target = e.target as HTMLElement;
              const id = target.closest<HTMLElement>('tr')?.dataset.rowId;
              if (id) setActiveRow(id);
              const td = target.closest<HTMLElement>('td[data-col]');
              setFocusedCell(id && td?.dataset.col ? { id, col: td.dataset.col } : null);
            }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusedCell(null);
            }}
          >
            {rows.map((r) => (
              <tr
                key={r.id}
                data-row-id={r.id}
                className={[r.id === highlighted ? 'hl' : '', r.isReference ? 'ref' : ''].filter(Boolean).join(' ') || undefined}
                onClick={() => pickFile(r.id)}
                onPointerEnter={(e) => hoverPreviews(e) && setHoverId(r.id)}
                onPointerLeave={() => setHoverId(null)}
                onFocus={(e) => focusPreviews(e.target) && setHoverId(r.id)}
                onBlur={() => setHoverId(null)}
              >
                <td>
                  <div className="file-line">
                  <button
                    type="button"
                    className="row-main file-cell"
                    data-nav
                    tabIndex={stop === r.id ? 0 : -1}
                    aria-current={r.id === highlighted || undefined}
                    title={
                      (r.file.length > FILE_NAME_MAX ? `${r.file}\n${r.id}` : r.id) +
                      (r.isReference ? '\nReference file' : '') + '\nEnter: show and highlight (again: clear) · Space: show or hide · Up/Down: next row'
                    }
                    {...onSpace(() => toggleRow(r.id))}
                  >
                    {r.isReference && <PinMark />}
                    {middleEllipsis(r.file, FILE_NAME_MAX)}
                  </button>
                  <button
                    type="button"
                    className="copy-row"
                    tabIndex={stop === r.id ? 0 : -1}
                    aria-label={`Copy row ${r.file}`}
                    title="Copy this row (tab-separated). Ctrl/Cmd+C on the file name does the same; Right arrow moves into the cells."
                    onClick={(e) => {
                      e.stopPropagation();
                      copyRow(r.id);
                    }}
                  >
                    <span aria-hidden="true">⧉</span>
                  </button>
                  {r.isReference && deltaOn && <span className="ref-tag">reference</span>}
                  </div>
                </td>
                <td>{r.group}</td>
                <td>{r.freq}</td>
                <td>{gainText(r)}</td>
                {columns.map((c) => {
                  const cell = rowCell(r, c.key);
                  return (
                    <td key={c.key} data-col={c.key} tabIndex={-1} title={cell.title} className={cell.title ? 'has-reason' : undefined}>
                      {cell.text}
                      {focusedCell?.id === r.id && focusedCell.col === c.key && (
                        <button
                          type="button"
                          className="copy-cell"
                          aria-label={`Copy value ${cell.text}`}
                          title="Copy this value (Enter or Ctrl/Cmd+C on the cell does the same)"
                          // Keeps the focus on the cell where a click would not focus the button (Safari), so the button stays.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            copyCell(r.id, c.key);
                          }}
                        />
                      )}
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
