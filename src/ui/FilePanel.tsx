import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useStore } from '../state/store';
import { fullTags, warningsFor, type ErrorEntry, type GroupView } from '../state/selectors';
import { UNGROUPED } from '../core/grouping';
import { nameOf } from '../core/names';
import { TagEditor } from './TagEditor';
import { sameTags } from './tagEdit';
import { offsetLabel } from './table';
import { confirmDialog, promptDialog } from './dialogs';
import { neighbourOrder } from './undoKeys';
import { moveFocus, onSpace, tabStopKey } from './rovingKeys';
import { filterGroups, filterTerms } from './panelFilter';

const DRAG_TYPE = 'text/x-pattern-id';

/** Said in the Create site dialog: what the new site also changes (see store `createSite`). */
const SITE_HINT =
  'The new site is shown alone, in the 3D overlay: every other file is unticked (tick them again to bring them back).';

/** Closes the <details> menu that contains `el` and puts the focus back on its trigger. */
const closeMenu = (el: HTMLElement) => {
  const menu = el.closest('details');
  menu?.removeAttribute('open');
  menu?.querySelector('summary')?.focus();
};

/** Up/Down/Home/End move between the items of an open menu. */
const onMenuKeys = (e: KeyboardEvent<HTMLElement>) => {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  moveFocus(e, items, document.activeElement as HTMLElement | null);
};

interface Props {
  groups: GroupView[];
  errors: ErrorEntry[];
  warnings: Map<string, string[]>;
  colors: Map<string, string>;
  /** Phone layout only: the panel is a drawer above the plots and shown when this is true. */
  drawerOpen?: boolean;
}

function NameEditor({
  initial,
  label,
  onSave,
  onCancel,
  onKeyClose,
}: {
  initial: string;
  label: string;
  onSave: (name: string) => void;
  onCancel: () => void;
  /** Called when Enter or Esc closes the editor (not when a click elsewhere does), to put the focus back. */
  onKeyClose: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <input
      type="text"
      className="name-editor"
      autoFocus
      aria-label={label}
      value={text}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') onKeyClose();
        if (e.key === 'Enter') onSave(text);
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={() => (text !== initial ? onSave(text) : onCancel())}
    />
  );
}

function FileMenu({
  id,
  name,
  inCustom,
  onRename,
  beforeRemove,
  tabIndex,
}: {
  id: string;
  name: string;
  inCustom: boolean;
  tabIndex?: number;
  onRename: () => void;
  /** Called just before the row is removed, so the panel can move the focus to a neighbour. */
  beforeRemove: () => void;
}) {
  const customGroups = useStore((s) => s.customGroups);
  const copyCount = useStore((s) => Object.values(s.copies).filter((c) => c.sourceId === id).length);
  const duplicate = useStore((s) => s.duplicate);
  const createGroup = useStore((s) => s.createGroup);
  const setMembership = useStore((s) => s.setMembership);
  const createSite = useStore((s) => s.createSite);
  const removeFile = useStore((s) => s.removeFile);

  return (
    <details className="menu" onClick={(e) => e.stopPropagation()}>
      <summary aria-label={`Actions for ${name}`} aria-haspopup="menu" tabIndex={tabIndex} data-focus-target>
        ⋯
      </summary>
      <div className="menu-items" role="menu" onKeyDown={onMenuKeys}>
        <button
          role="menuitem"
          onClick={(e) => {
            duplicate(id);
            closeMenu(e.currentTarget);
          }}
        >
          Duplicate
        </button>
        <button
          role="menuitem"
          onClick={(e) => {
            onRename();
            closeMenu(e.currentTarget);
          }}
        >
          Rename…
        </button>
        {customGroups.map((g) => (
          <button
            key={g.id}
            role="menuitem"
            onClick={(e) => {
              setMembership(id, g.id);
              closeMenu(e.currentTarget);
            }}
          >
            Move to {g.name}
          </button>
        ))}
        <button
          role="menuitem"
          onClick={(e) => {
            closeMenu(e.currentTarget);
            void promptDialog('Name of the new group', '').then((groupName) => {
              if (groupName !== null) setMembership(id, createGroup(groupName));
            });
          }}
        >
          Move to new group…
        </button>
        {inCustom && (
          <button
            role="menuitem"
            onClick={(e) => {
              setMembership(id, null);
              closeMenu(e.currentTarget);
            }}
          >
            Remove from group
          </button>
        )}
        <button
          role="menuitem"
          onClick={(e) => {
            closeMenu(e.currentTarget);
            void promptDialog('Number of sectors (2–12)', '3', (t) => {
              const n = Number(t);
              return t.trim() !== '' && Number.isInteger(n) && n >= 2 && n <= 12
                ? null
                : 'Enter a whole number from 2 to 12';
            }, SITE_HINT).then((answer) => {
              if (answer !== null) createSite(id, Number(answer));
            });
          }}
        >
          Create site…
        </button>
        <button
          role="menuitem"
          onClick={(e) => {
            closeMenu(e.currentTarget);
            if (copyCount === 0) {
              beforeRemove();
              removeFile(id);
              return;
            }
            void confirmDialog(
              `Remove ${name} and its ${copyCount} cop${copyCount === 1 ? 'y' : 'ies'}?`,
              'Remove',
            ).then((ok) => {
              if (!ok) return;
              beforeRemove();
              removeFile(id);
            });
          }}
        >
          Remove
        </button>
      </div>
    </details>
  );
}

function GroupMenu({
  id,
  name,
  onRename,
  beforeDelete,
  tabIndex,
}: {
  id: string;
  name: string;
  tabIndex?: number;
  onRename: () => void;
  beforeDelete: () => void;
}) {
  const duplicateGroup = useStore((s) => s.duplicateGroup);
  const deleteGroup = useStore((s) => s.deleteGroup);
  return (
    <details className="menu" onClick={(e) => e.stopPropagation()}>
      <summary aria-label={`Actions for group ${name}`} aria-haspopup="menu" tabIndex={tabIndex} data-focus-target>
        ⋯
      </summary>
      <div className="menu-items" role="menu" onKeyDown={onMenuKeys}>
        <button
          role="menuitem"
          onClick={(e) => {
            onRename();
            closeMenu(e.currentTarget);
          }}
        >
          Rename…
        </button>
        <button
          role="menuitem"
          onClick={(e) => {
            duplicateGroup(id);
            closeMenu(e.currentTarget);
          }}
        >
          Duplicate group
        </button>
        <button
          role="menuitem"
          onClick={(e) => {
            closeMenu(e.currentTarget);
            beforeDelete();
            deleteGroup(id);
          }}
        >
          Delete group
        </button>
      </div>
    </details>
  );
}

/** Starts dragging file `id` (to a group); stops the event so the row's own handler does not run it twice. */
function startDrag(e: DragEvent<HTMLElement>, id: string): void {
  e.stopPropagation();
  e.dataTransfer.setData(DRAG_TYPE, id);
}

export const FilePanel = memo(function FilePanel({ groups: allGroups, errors, warnings, colors, drawerOpen }: Props) {
  const visible = useStore((s) => s.visible);
  const highlighted = useStore((s) => s.highlighted);
  const selected = useStore((s) => s.selected);
  const copies = useStore((s) => s.copies);
  const offsets = useStore((s) => s.view.simulation.offsets);
  const groupOffsets = useStore((s) => s.view.simulation.groupOffsets);
  const toggleVisible = useStore((s) => s.toggleVisible);
  const setVisible = useStore((s) => s.setVisible);
  const select = useStore((s) => s.select);
  const pickFile = useStore((s) => s.pickFile);
  const setTags = useStore((s) => s.setTags);
  const setMembership = useStore((s) => s.setMembership);
  const rename = useStore((s) => s.rename);
  const renameGroup = useStore((s) => s.renameGroup);
  const removeFile = useStore((s) => s.removeFile);
  const setVisibleOnly = useStore((s) => s.setVisibleOnly);
  // The filter text and the folded groups are display-only: nothing here is saved in a project or counted as unsaved work.
  const [query, setQuery] = useState('');
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // The custom group (or tag group key) a dragged file is over: it is outlined as a drop target.
  const [dropKey, setDropKey] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  // The one row (or group header) that is a tab stop; the arrow keys move it (roving tabindex).
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Filtering a single file is noise: the box appears from two files on, and a stale text does not outlive the files.
  const fileCount = allGroups.reduce((n, g) => n + g.items.length, 0);
  const filterShown = fileCount >= 2;
  // The list follows the text a moment later, so typing stays instant even with hundreds of rows.
  const deferredQuery = useDeferredValue(query);
  const activeQuery = filterShown ? deferredQuery : '';
  const filtering = filterTerms(activeQuery).length > 0;
  const { groups, matchIds, allIds } = useMemo(() => filterGroups(allGroups, activeQuery), [allGroups, activeQuery]);
  const tickedCount = allIds.reduce((n, id) => n + (visible[id] ? 1 : 0), 0);
  const toggleFold = (key: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const navKeys = groups.flatMap((g) => [`group:${g.key}`, ...(folded.has(g.key) ? [] : g.items.map((i) => `file:${i.pattern.id}`))]);
  const stop = tabStopKey(navKeys, activeKey);
  /** tabIndex of the secondary controls of the row `key`: reachable by Tab only on the row that is the tab stop. */
  const subTab = (key: string): number | undefined => (key === stop ? undefined : -1);
  // Set just before a control is replaced by an editor: where the focus returns once the editor closes.
  const returnTo = useRef<{ key: string; selector: string } | null>(null);
  const returnFocus = (key: string, selector: string) => {
    returnTo.current = { key, selector };
  };
  // Set just before a row, an error or a group is removed: the keys of its neighbours, nearest first.
  const focusNext = useRef<string[] | null>(null);

  /** Remembers where the focus should go once the item `key` is gone (see the effect below). */
  const planFocus = (key: string) => {
    const kind = key.slice(0, key.indexOf(':') + 1);
    const keys = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[data-focus-key]') ?? [])
      .map((el) => el.dataset.focusKey ?? '')
      .filter((k) => k.startsWith(kind));
    focusNext.current = neighbourOrder(keys, key);
  };

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

  // A highlight set from the table or a plot brings the file's item into view in the panel.
  useEffect(() => {
    if (highlighted === null) return;
    const home = allGroups.find((g) => g.items.some((i) => i.pattern.id === highlighted));
    // A folded group would hide the highlighted file: open it.
    if (home && folded.has(home.key)) {
      setFolded((f) => new Set([...f].filter((k) => k !== home.key)));
      return;
    }
    panelRef.current?.querySelector<HTMLElement>('li.hl')?.scrollIntoView?.({ block: 'nearest' });
    // Only a change of the highlight brings the file into view, not a fold or a filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlighted]);

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
      onDragEnd={() => setDropKey(null)}
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
        <div className="panel-tools" role="search">
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
          <p className="count" data-testid="filter-count" aria-live="polite">
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
                  disabled={matchIds.length === 0}
                  onClick={() => setVisibleOnly(matchIds, `Showed only the ${matchIds.length} matching file${matchIds.length === 1 ? '' : 's'}`)}
                >
                  Only matches
                </button>
                <button
                  type="button"
                  disabled={matchIds.length === 0}
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
          {filtering && matchIds.length === 0 && (
            <p className="count">
              No file matches "{query.trim()}".{' '}
              <button type="button" onClick={() => setQuery('')}>
                Clear filter
              </button>
            </p>
          )}
        </div>
      )}
      {groups.map((g) => {
        const ids = g.items.map((i) => i.pattern.id);
        const custom = g.customId;
        const isFolded = folded.has(g.key);
        const ticked = ids.filter((id) => visible[id]).length;
        const isSelected = custom !== undefined && selected?.kind === 'group' && selected.id === custom;
        return (
          <section
            key={g.key}
            data-focus-key={`group:${g.key}`}
            className={`${custom ? 'group custom' : 'group'}${dropKey === g.key ? ' drop-target' : ''}`}
            onDragOver={(e) => {
              if (g.key !== UNGROUPED && e.dataTransfer.types.includes(DRAG_TYPE)) {
                e.preventDefault();
                if (dropKey !== g.key) setDropKey(g.key);
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropKey((k) => (k === g.key ? null : k));
            }}
            onDrop={(e) => {
              setDropKey(null);
              const id = e.dataTransfer.getData(DRAG_TYPE);
              if (!id || g.key === UNGROUPED) return;
              if (custom) setMembership(id, custom);
              else {
                setTags(id, fullTags(g.tags));
                setMembership(id, null);
              }
            }}
          >
            <header
              className={isSelected ? 'selected' : undefined}
              onClick={custom ? () => select({ kind: 'group', id: custom }) : undefined}
            >
              <button
                type="button"
                className="fold-group"
                aria-expanded={!isFolded}
                aria-label={`${isFolded ? 'Expand' : 'Collapse'} ${g.label}`}
                tabIndex={subTab(`group:${g.key}`)}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFold(g.key);
                }}
              >
                <span aria-hidden="true">{isFolded ? '▸' : '▾'}</span>
              </button>
              <input
                type="checkbox"
                aria-label={`Show all in ${g.label}`}
                data-focus-target={custom ? undefined : true}
                // A group made from tags has no name button: its checkbox is the header's list entry.
                data-nav={custom ? undefined : true}
                tabIndex={custom ? subTab(`group:${g.key}`) : stop === `group:${g.key}` ? 0 : -1}
                checked={ids.length > 0 && ids.every((id) => visible[id])}
                // Partly ticked: the box shows a dash instead of looking unticked.
                ref={(el) => {
                  if (el) el.indeterminate = ids.some((id) => visible[id]) && !ids.every((id) => visible[id]);
                }}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setVisible(ids, e.target.checked)}
              />
              {custom && renaming === `group:${custom}` ? (
                <NameEditor
                  initial={g.label}
                  label={`Name for group ${g.label}`}
                  onSave={(n) => {
                    renameGroup(custom, n);
                    setRenaming(null);
                  }}
                  onCancel={() => setRenaming(null)}
                  onKeyClose={() => returnFocus(`group:${g.key}`, '[data-nav]')}
                />
              ) : custom ? (
                <button
                  type="button"
                  className="row-main group-main"
                  data-nav
                  tabIndex={stop === `group:${g.key}` ? 0 : -1}
                  aria-current={isSelected || undefined}
                  title="Enter: select group · Space: show or hide all · Left/Right: fold or unfold · Up/Down: next row"
                  onDoubleClick={() => setRenaming(`group:${custom}`)}
                  {...onSpace(() => {
                    const all = ids.length > 0 && ids.every((id) => visible[id]);
                    setVisible(ids, !all);
                  })}
                >
                  {g.label}
                </button>
              ) : (
                <span>{g.label}</span>
              )}
              <span className="count" title={`${ticked} of ${ids.length} shown in the plots${filtering ? ' (matching files only)' : ''}`}>
                {ticked} / {ids.length}
              </span>
              {custom && groupOffsets[custom] && (
                <span
                  className="offset-badge"
                  title={offsetLabel(groupOffsets[custom])}
                  aria-label={`Group offsets: ${offsetLabel(groupOffsets[custom])}`}
                >
                  ±
                </span>
              )}
              {custom && (
                <GroupMenu
                  id={custom}
                  name={g.label}
                  onRename={() => setRenaming(`group:${custom}`)}
                  tabIndex={subTab(`group:${g.key}`)}
                  beforeDelete={() => planFocus(`group:${g.key}`)}
                />
              )}
            </header>
            {custom && ids.length === 0 && !filtering && (
              <p className="count empty-group">Empty: drag files here, or use ⋯ › Move to {g.label} on a file.</p>
            )}
            <ul hidden={isFolded}>
              {(isFolded ? [] : g.items).map(({ pattern, tags }) => {
                const id = pattern.id;
                const name = nameOf(pattern);
                const warn = warningsFor(id, warnings, copies);
                return (
                  <li
                    key={id}
                    data-focus-key={`file:${id}`}
                    className={highlighted === id ? 'hl' : undefined}
                    draggable
                    onDragStart={(e) => startDrag(e, id)}
                    onClick={() => pickFile(id)}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Show ${name}`}
                      tabIndex={subTab(`file:${id}`)}
                      checked={!!visible[id]}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleVisible(id)}
                    />
                    {renaming === id ? (
                      <>
                        <span className="swatch" style={{ background: colors.get(id) ?? 'transparent' }} />
                        <span>{pattern.frequencyMHz} MHz</span>
                        <NameEditor
                          initial={name}
                          label={`Name for ${name}`}
                          onSave={(n) => {
                            rename(id, n);
                            setRenaming(null);
                          }}
                          onCancel={() => setRenaming(null)}
                          onKeyClose={() => returnFocus(`file:${id}`, '[data-nav]')}
                        />
                      </>
                    ) : (
                      <button
                        type="button"
                        className="row-main"
                        // Firefox starts no drag from a button inside a draggable parent: the button is draggable itself.
                        draggable
                        onDragStart={(e) => startDrag(e, id)}
                        data-nav
                        tabIndex={stop === `file:${id}` ? 0 : -1}
                        aria-current={highlighted === id || undefined}
                        title="Enter: show and highlight (again: clear) · Space: show or hide · Up/Down: next row"
                        {...onSpace(() => toggleVisible(id))}
                      >
                        <span className="swatch" style={{ background: colors.get(id) ?? 'transparent' }} />
                        <span>{pattern.frequencyMHz} MHz</span>
                        <span className="fname" title={pattern.fileName}>
                          {name}
                        </span>
                      </button>
                    )}
                    {copies[id] && <span className="copy-tag">copy</span>}
                    {warn && (
                      <span className="warn" title={warn.join('\n')} aria-label={`${warn.length} warnings`}>
                        ⚠
                      </span>
                    )}
                    {offsets[id] && (
                      <span
                        className="offset-badge"
                        title={offsetLabel(offsets[id])}
                        aria-label={`Offsets: ${offsetLabel(offsets[id])}`}
                      >
                        ±
                      </span>
                    )}
                    <button
                      aria-label={`Edit tags of ${name}`}
                      aria-expanded={editing === id}
                      data-edit-tags
                      tabIndex={subTab(`file:${id}`)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(editing === id ? null : id);
                      }}
                    >
                      ✎
                    </button>
                    <FileMenu
                      id={id}
                      name={name}
                      inCustom={!!custom}
                      tabIndex={subTab(`file:${id}`)}
                      onRename={() => setRenaming(id)}
                      beforeRemove={() => planFocus(`file:${id}`)}
                    />
                    {editing === id && (
                      <TagEditor
                        tags={tags}
                        onSave={(t) => {
                          // Saving what is already shown must not turn inferred tags into an override.
                          if (!sameTags(t, tags)) setTags(id, t);
                          setEditing(null);
                          returnFocus(`file:${id}`, '[data-edit-tags]');
                        }}
                        onCancel={() => {
                          setEditing(null);
                          returnFocus(`file:${id}`, '[data-edit-tags]');
                        }}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </aside>
  );
});
