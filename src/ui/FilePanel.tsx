import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from '../state/store';
import type { ErrorEntry, GroupView } from '../state/selectors';
import { neighbourOrder } from './undoKeys';
import { moveFocus, tabStopAfterFold, tabStopKey } from './rovingKeys';
import { filterGroups, filterPending, filterTerms, highlightHiddenByFilter } from './panelFilter';
import { GroupSection } from './GroupSection';
import { useSessionSwap } from './useSessionSwap';
import type { FileStyle } from './colors';

interface Props {
  groups: GroupView[];
  errors: ErrorEntry[];
  warnings: Map<string, string[]>;
  /** Colour and line pattern of each shown file (the swatches). */
  styles: Map<string, FileStyle>;
  /** Phone layout only: the panel is a drawer above the plots and shown when this is true. */
  drawerOpen?: boolean;
}

export const FilePanel = memo(function FilePanel({ groups: allGroups, errors, warnings, styles, drawerOpen }: Props) {
  const visible = useStore((s) => s.visible);
  const highlighted = useStore((s) => s.highlighted);
  const selected = useStore((s) => s.selected);
  const copies = useStore((s) => s.copies);
  const offsets = useStore((s) => s.view.simulation.offsets);
  const groupOffsets = useStore((s) => s.view.simulation.groupOffsets);
  const removeFile = useStore((s) => s.removeFile);
  const setVisibleOnly = useStore((s) => s.setVisibleOnly);
  // The filter text and the folded groups are display-only: nothing here is saved in a project or counted as unsaved work.
  const [query, setQuery] = useState('');
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  // They belong to the session on screen: a project opened, an undo applied or Clear starts them afresh.
  useSessionSwap(() => {
    setQuery('');
    setFolded(new Set());
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  // The one row (or group header) that is a tab stop; the arrow keys move it (roving tabindex).
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Filtering a single file is noise: the box appears from two files on, and while it is hidden its text filters nothing.
  const fileCount = allGroups.reduce((n, g) => n + g.items.length, 0);
  const filterShown = fileCount >= 2;
  // The list follows the text a moment later, so typing stays instant even with hundreds of rows.
  const deferredQuery = useDeferredValue(query);
  const activeQuery = filterShown ? deferredQuery : '';
  const filtering = filterTerms(activeQuery).length > 0;
  // "Only matches" / "Add matches" act on the matches: not while the typed text is ahead of the list.
  const pending = filterShown && filterPending(query, deferredQuery);
  const highlightHidden = highlightHiddenByFilter(allGroups, activeQuery, highlighted);
  const { groups, matchIds, allIds } = useMemo(() => filterGroups(allGroups, activeQuery), [allGroups, activeQuery]);
  const tickedCount = allIds.reduce((n, id) => n + (visible[id] ? 1 : 0), 0);
  // The panel's groups for callbacks that must stay stable (a fold must know which rows the group holds).
  const groupsRef = useRef(allGroups);
  useEffect(() => {
    groupsRef.current = allGroups;
  }, [allGroups]);
  const toggleFold = useCallback((key: string) => {
    setFolded((f) => {
      const next = new Set(f);
      if (!next.delete(key)) next.add(key);
      return next;
    });
    // Folding the group that holds the tab stop must not send it back to the top of the list: it goes to the group's header.
    const fileKeys = (groupsRef.current.find((g) => g.key === key)?.items ?? []).map((i) => `file:${i.pattern.id}`);
    setActiveKey((cur) => tabStopAfterFold(cur, key, fileKeys));
  }, []);
  const navKeys = groups.flatMap((g) => [`group:${g.key}`, ...(folded.has(g.key) ? [] : g.items.map((i) => `file:${i.pattern.id}`))]);
  const stop = tabStopKey(navKeys, activeKey);
  // Set just before a control is replaced by an editor: where the focus returns once the editor closes.
  const returnTo = useRef<{ key: string; selector: string } | null>(null);
  const returnFocus = useCallback((key: string, selector: string) => {
    returnTo.current = { key, selector };
  }, []);
  // Set just before a row, an error or a group is removed: the keys of its neighbours, nearest first.
  const focusNext = useRef<string[] | null>(null);

  /** Remembers where the focus should go once the item `key` is gone (see the effect below). */
  const planFocus = useCallback((key: string) => {
    const kind = key.slice(0, key.indexOf(':') + 1);
    const keys = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[data-focus-key]') ?? [])
      .map((el) => el.dataset.focusKey ?? '')
      .filter((k) => k.startsWith(kind));
    focusNext.current = neighbourOrder(keys, key);
  }, []);

  // After a removal the focused control is gone and the browser would drop the focus on <body>.
  // Move it to the nearest neighbour that is still there, else to the panel itself.
  useEffect(() => {
    const panel = panelRef.current;
    const back = returnTo.current;
    if (back && panel) {
      returnTo.current = null;
      const holder = Array.from(panel.querySelectorAll<HTMLElement>('[data-focus-key]')).find((el) => el.dataset.focusKey === back.key);
      holder?.querySelector<HTMLElement>(back.selector)?.focus();
    }
    const wanted = focusNext.current;
    if (!wanted || !panel) return;
    focusNext.current = null;
    const present = new Map(
      Array.from(panel.querySelectorAll<HTMLElement>('[data-focus-key]')).map((el) => [el.dataset.focusKey ?? '', el]),
    );
    const next = wanted.map((k) => present.get(k)?.querySelector<HTMLElement>('[data-focus-target]')).find((el) => el);
    (next ?? panel).focus();
  });

  // A highlight set from the table or a plot brings the file's item into view in the panel. Only a change of the
  // highlight does (not a later fold or filter): `reveal` holds the file until its row is on the page, which is one
  // render later when its group had to be unfolded first.
  const reveal = useRef<string | null>(null);
  useEffect(() => {
    reveal.current = highlighted;
    if (highlighted === null) return;
    const home = allGroups.find((g) => g.items.some((i) => i.pattern.id === highlighted));
    // A folded group would hide the highlighted file: open it.
    if (home && folded.has(home.key)) setFolded((f) => new Set([...f].filter((k) => k !== home.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlighted]);
  useEffect(() => {
    if (reveal.current === null) return;
    const row = panelRef.current?.querySelector<HTMLElement>('li.hl');
    if (row) {
      reveal.current = null;
      row.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    // No row yet: wait for the unfolding render; hidden by the filter (or not a panel file): nothing to scroll to.
    const home = allGroups.find((g) => g.items.some((i) => i.pattern.id === reveal.current));
    if (!(home && folded.has(home.key))) reveal.current = null;
  });

  // The sticky tools block covers the top of the scrolling panel: its height is the scroll padding, so a row that is
  // scrolled or focused into view never ends up underneath it (it changes when the buttons wrap).
  const toolsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    const tools = toolsRef.current;
    if (!panel) return;
    if (!tools) {
      panel.style.removeProperty('--panel-tools-h');
      return;
    }
    const measure = () => panel.style.setProperty('--panel-tools-h', `${tools.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tools);
    return () => observer.disconnect();
  }, [filterShown]);

  // Menus close on an outside click or Esc; opening one menu closes the others. `<details>`
  // menus already stop clicks inside them from reaching `document`, so any click that gets
  // here is outside every menu. The `toggle` event doesn't bubble, so the listener below
  // is registered in the capture phase to still see it on its way down to the `<details>`.
  useEffect(() => {
    const root = panelRef.current;
    if (!root) return;
    const closeAll = (except?: EventTarget | null) => {
      root.querySelectorAll<HTMLDetailsElement>('details.menu[open]').forEach((d) => {
        if (d !== except) d.removeAttribute('open');
      });
    };
    const onDocClick = () => closeAll();
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Esc in an open menu hands the focus back to the button that opened it.
      const open = document.activeElement?.closest('details.menu[open]');
      closeAll();
      if (open && root.contains(open)) open.querySelector('summary')?.focus();
    };
    const onToggle = (e: Event) => {
      const d = e.target as HTMLDetailsElement;
      if (!d.open) return;
      closeAll(d);
      d.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    };
    // Tabbing (or clicking) to something outside an open menu closes it; the focus stays where it went.
    const onFocusOut = (e: FocusEvent) => {
      const menu = (e.target as HTMLElement).closest('details.menu[open]');
      const to = e.relatedTarget as Node | null;
      if (menu && to && !menu.contains(to)) menu.removeAttribute('open');
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    root.addEventListener('toggle', onToggle, true);
    root.addEventListener('focusout', onFocusOut);
    return () => {
      root.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('toggle', onToggle, true);
    };
  }, []);

  // Up/Down/Home/End move between the rows and group headers (the elements marked `data-nav`).
  const onPanelKeys = (e: KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (!target.hasAttribute('data-nav')) return;
    // Left folds and Right unfolds the group whose header has the focus.
    const groupKey = target.closest<HTMLElement>('[data-focus-key^="group:"]')?.dataset.focusKey?.slice(6);
    if (groupKey && target.closest('header') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      if (folded.has(groupKey) === (e.key === 'ArrowRight')) toggleFold(groupKey);
      return;
    }
    moveFocus(e, Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-nav]')), target);
  };

  return (
    <aside
      id="file-panel"
      className={drawerOpen ? 'panel open' : 'panel'}
      aria-label="Files and groups"
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={onPanelKeys}
      onFocus={(e) => {
        const key = (e.target as HTMLElement).closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey;
        if (key && navKeys.includes(key)) setActiveKey(key);
      }}
    >
      {errors.length > 0 && (
        <section className="group errors" data-testid="panel-errors" tabIndex={-1} aria-label="Files that could not be loaded">
          <header>
            <span>Errors</span>
            <span className="count">{errors.length}</span>
          </header>
          <ul className="errors-list">
            {errors.map((e) => (
              <li key={e.id} data-focus-key={`error:${e.id}`}>
                <span className="fname" title={e.path}>
                  {e.path}
                </span>
                <button
                  aria-label={`Remove ${e.path}`}
                  data-focus-target
                  onClick={() => {
                    planFocus(`error:${e.id}`);
                    removeFile(e.id);
                  }}
                >
                  ✕
                </button>
                <span className="reason">
                  {e.error}
                  {e.line !== undefined ? ` (line ${e.line})` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {filterShown && (
        <div className="panel-tools" role="search" ref={toolsRef}>
          <input
            type="search"
            className="panel-filter"
            aria-label="Filter files"
            placeholder="Filter: name, group, MHz"
            value={query}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query !== '') {
                e.preventDefault();
                setQuery('');
              } else if (e.key === 'ArrowDown') {
                const first = e.currentTarget.closest('aside')?.querySelector<HTMLElement>('[data-nav]');
                if (first) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          />
          <p className="count" data-testid="filter-count">
            {filtering ? `${matchIds.length} of ${allIds.length} files` : `${allIds.length} files · ${tickedCount} shown`}
          </p>
          <div className="bulk" role="group" aria-label="Show or hide files">
            <button type="button" disabled={tickedCount === allIds.length} onClick={() => setVisibleOnly(allIds, 'Showed all files')}>
              Show all
            </button>
            <button type="button" disabled={tickedCount === 0} onClick={() => setVisibleOnly([], 'Hid all files')}>
              Show none
            </button>
            {filtering && (
              <>
                <button
                  type="button"
                  disabled={pending || matchIds.length === 0}
                  onClick={() => setVisibleOnly(matchIds, `Showed only the ${matchIds.length} matching file${matchIds.length === 1 ? '' : 's'}`)}
                >
                  Only matches
                </button>
                <button
                  type="button"
                  disabled={pending || matchIds.length === 0}
                  onClick={() =>
                    setVisibleOnly(
                      [...new Set([...allIds.filter((id) => visible[id]), ...matchIds])],
                      `Added ${matchIds.length} matching file${matchIds.length === 1 ? '' : 's'}`,
                    )
                  }
                >
                  Add matches
                </button>
              </>
            )}
          </div>
          {highlightHidden && (
            <p className="count" data-testid="highlight-hidden" role="status" aria-live="polite">
              The highlighted file is hidden by the filter.{' '}
              <button type="button" onClick={() => setQuery('')}>
                Clear filter
              </button>
            </p>
          )}
          {filtering && matchIds.length === 0 && (
            <p className="count" role="status" aria-live="polite">
              No file matches "{query.trim()}".{' '}
              <button type="button" onClick={() => setQuery('')}>
                Clear filter
              </button>
            </p>
          )}
        </div>
      )}
      {groups.map((g) => (
        <GroupSection
          key={g.key}
          group={g}
          visible={visible}
          highlighted={highlighted}
          isSelected={g.customId !== undefined && selected?.kind === 'group' && selected.id === g.customId}
          folded={folded.has(g.key)}
          filtering={filtering}
          copies={copies}
          offsets={offsets}
          groupOffset={g.customId !== undefined ? groupOffsets[g.customId] : undefined}
          styles={styles}
          warnings={warnings}
          stop={stop}
          editing={editing}
          renaming={renaming}
          toggleFold={toggleFold}
          setEditing={setEditing}
          setRenaming={setRenaming}
          planFocus={planFocus}
          returnFocus={returnFocus}
        />
      ))}
    </aside>
  );
});
