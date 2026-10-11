import { memo, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { fullTags, warningsFor, type ErrorEntry, type GroupView } from '../state/selectors';
import { UNGROUPED } from '../core/grouping';
import { nameOf } from '../core/names';
import { TagEditor } from './TagEditor';
import { offsetLabel } from './table';
import { confirmDialog, promptDialog } from './dialogs';

const DRAG_TYPE = 'text/x-pattern-id';

/** Closes the <details> menu that contains `el`. */
const closeMenu = (el: HTMLElement) => el.closest('details')?.removeAttribute('open');

interface Props {
  groups: GroupView[];
  errors: ErrorEntry[];
  warnings: Map<string, string[]>;
  colors: Map<string, string>;
}

function NameEditor({
  initial,
  label,
  onSave,
  onCancel,
}: {
  initial: string;
  label: string;
  onSave: (name: string) => void;
  onCancel: () => void;
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
}: {
  id: string;
  name: string;
  inCustom: boolean;
  onRename: () => void;
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
      <summary aria-label={`Actions for ${name}`}>⋯</summary>
      <div className="menu-items" role="menu">
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
            }).then((answer) => {
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
              removeFile(id);
              return;
            }
            void confirmDialog(
              `Remove ${name} and its ${copyCount} cop${copyCount === 1 ? 'y' : 'ies'}?`,
              'Remove',
            ).then((ok) => {
              if (ok) removeFile(id);
            });
          }}
        >
          Remove
        </button>
      </div>
    </details>
  );
}

function GroupMenu({ id, name, onRename }: { id: string; name: string; onRename: () => void }) {
  const duplicateGroup = useStore((s) => s.duplicateGroup);
  const deleteGroup = useStore((s) => s.deleteGroup);
  return (
    <details className="menu" onClick={(e) => e.stopPropagation()}>
      <summary aria-label={`Actions for group ${name}`}>⋯</summary>
      <div className="menu-items" role="menu">
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
            deleteGroup(id);
            closeMenu(e.currentTarget);
          }}
        >
          Delete group
        </button>
      </div>
    </details>
  );
}

export const FilePanel = memo(function FilePanel({ groups, errors, warnings, colors }: Props) {
  const visible = useStore((s) => s.visible);
  const highlighted = useStore((s) => s.highlighted);
  const selected = useStore((s) => s.selected);
  const copies = useStore((s) => s.copies);
  const offsets = useStore((s) => s.view.simulation.offsets);
  const groupOffsets = useStore((s) => s.view.simulation.groupOffsets);
  const toggleVisible = useStore((s) => s.toggleVisible);
  const setVisible = useStore((s) => s.setVisible);
  const select = useStore((s) => s.select);
  const setTags = useStore((s) => s.setTags);
  const setMembership = useStore((s) => s.setMembership);
  const rename = useStore((s) => s.rename);
  const renameGroup = useStore((s) => s.renameGroup);
  const removeFile = useStore((s) => s.removeFile);
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  // A highlight set from the table or a plot brings the file's item into view in the panel.
  useEffect(() => {
    if (highlighted === null) return;
    panelRef.current?.querySelector<HTMLElement>('li.hl')?.scrollIntoView?.({ block: 'nearest' });
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
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    const onToggle = (e: Event) => {
      const d = e.target as HTMLDetailsElement;
      if (d.open) closeAll(d);
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    root.addEventListener('toggle', onToggle, true);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('toggle', onToggle, true);
    };
  }, []);

  return (
    <aside className="panel" aria-label="Files and groups" ref={panelRef}>
      {errors.length > 0 && (
        <section className="group errors" data-testid="panel-errors" tabIndex={-1} aria-label="Files that could not be read">
          <header>
            <span>Errors</span>
            <span className="count">{errors.length}</span>
          </header>
          <ul className="errors-list">
            {errors.map((e) => (
              <li key={e.id}>
                <span className="fname" title={e.path}>
                  {e.path}
                </span>
                <button aria-label={`Remove ${e.path}`} onClick={() => removeFile(e.id)}>
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
      {groups.map((g) => {
        const ids = g.items.map((i) => i.pattern.id);
        const custom = g.customId;
        const isSelected = custom !== undefined && selected?.kind === 'group' && selected.id === custom;
        return (
          <section
            key={g.key}
            className={custom ? 'group custom' : 'group'}
            onDragOver={(e) => {
              if (g.key !== UNGROUPED && e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
            }}
            onDrop={(e) => {
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
              <input
                type="checkbox"
                aria-label={`Show all in ${g.label}`}
                checked={ids.length > 0 && ids.every((id) => visible[id])}
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
                />
              ) : (
                <span onDoubleClick={custom ? () => setRenaming(`group:${custom}`) : undefined}>{g.label}</span>
              )}
              <span className="count">{ids.length}</span>
              {custom && groupOffsets[custom] && (
                <span
                  className="offset-badge"
                  title={offsetLabel(groupOffsets[custom])}
                  aria-label={`Group offsets: ${offsetLabel(groupOffsets[custom])}`}
                >
                  ±
                </span>
              )}
              {custom && <GroupMenu id={custom} name={g.label} onRename={() => setRenaming(`group:${custom}`)} />}
            </header>
            <ul>
              {g.items.map(({ pattern, tags }) => {
                const id = pattern.id;
                const name = nameOf(pattern);
                const warn = warningsFor(id, warnings, copies);
                return (
                  <li
                    key={id}
                    className={highlighted === id ? 'hl' : undefined}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, id)}
                    onClick={() => select({ kind: 'file', id })}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Show ${name}`}
                      checked={!!visible[id]}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleVisible(id)}
                    />
                    <span className="swatch" style={{ background: colors.get(id) ?? 'transparent' }} />
                    <span>{pattern.frequencyMHz} MHz</span>
                    {renaming === id ? (
                      <NameEditor
                        initial={name}
                        label={`Name for ${name}`}
                        onSave={(n) => {
                          rename(id, n);
                          setRenaming(null);
                        }}
                        onCancel={() => setRenaming(null)}
                      />
                    ) : (
                      <span className="fname" title={pattern.fileName}>
                        {name}
                      </span>
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
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(editing === id ? null : id);
                      }}
                    >
                      ✎
                    </button>
                    <FileMenu id={id} name={name} inCustom={!!custom} onRename={() => setRenaming(id)} />
                    {editing === id && (
                      <TagEditor
                        tags={tags}
                        onSave={(t) => {
                          setTags(id, t);
                          setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
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
