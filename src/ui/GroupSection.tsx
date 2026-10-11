import { memo, useEffect, useState } from 'react';
import { useStore, type OffsetState } from '../state/store';
import { fullTags, warningsFor, type GroupView } from '../state/selectors';
import { UNGROUPED } from '../core/grouping';
import { offsetLabel } from './table';
import { onSpace } from './rovingKeys';
import { GroupMenu, NameEditor } from './FilePanelMenus';
import { DRAG_TYPE, FileRow } from './FileRow';

interface Props {
  group: GroupView;
  visible: Record<string, boolean>;
  highlighted: string | null;
  /** The custom group is the selection (its header is marked). */
  isSelected: boolean;
  folded: boolean;
  filtering: boolean;
  copies: Record<string, { sourceId: string }>;
  offsets: Record<string, OffsetState>;
  groupOffset: OffsetState | undefined;
  colors: Map<string, string>;
  warnings: Map<string, string[]>;
  /** Key of the row or header that is the panel's tab stop. */
  stop: string | null;
  editing: string | null;
  renaming: string | null;
  // Stable callbacks (state setters or useCallback in the panel): they keep the memo of the section and its rows real.
  toggleFold: (key: string) => void;
  setEditing: (id: string | null) => void;
  setRenaming: (key: string | null) => void;
  planFocus: (key: string) => void;
  returnFocus: (key: string, selector: string) => void;
}

/** One group of the panel: its header, the drop target and its file rows. */
export const GroupSection = memo(function GroupSection({
  group: g,
  visible,
  highlighted,
  isSelected,
  folded: isFolded,
  filtering,
  copies,
  offsets,
  groupOffset,
  colors,
  warnings,
  stop,
  editing,
  renaming,
  toggleFold,
  setEditing,
  setRenaming,
  planFocus,
  returnFocus,
}: Props) {
  const select = useStore((s) => s.select);
  const setVisible = useStore((s) => s.setVisible);
  const setTags = useStore((s) => s.setTags);
  const setMembership = useStore((s) => s.setMembership);
  const renameGroup = useStore((s) => s.renameGroup);
  // A dragged file is over this group: it is outlined as a drop target.
  const [dropping, setDropping] = useState(false);
  // A drag that ends elsewhere (Esc, dropped outside) must not leave the outline behind.
  useEffect(() => {
    if (!dropping) return;
    const clear = () => setDropping(false);
    document.addEventListener('dragend', clear);
    return () => document.removeEventListener('dragend', clear);
  }, [dropping]);

  const ids = g.items.map((i) => i.pattern.id);
  const custom = g.customId;
  const ticked = ids.filter((id) => visible[id]).length;
  const groupFocusKey = `group:${g.key}`;
  const subTab = stop === groupFocusKey ? undefined : -1;
  return (
    <section
      data-focus-key={groupFocusKey}
      className={`${custom ? 'group custom' : 'group'}${dropping ? ' drop-target' : ''}`}
      onDragOver={(e) => {
        if (g.key !== UNGROUPED && e.dataTransfer.types.includes(DRAG_TYPE)) {
          e.preventDefault();
          if (!dropping) setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        setDropping(false);
        const id = e.dataTransfer.getData(DRAG_TYPE);
        if (!id || g.key === UNGROUPED) return;
        if (custom) setMembership(id, custom);
        else {
          setTags(id, fullTags(g.tags));
          setMembership(id, null);
        }
      }}
    >
      <header className={isSelected ? 'selected' : undefined} onClick={custom ? () => select({ kind: 'group', id: custom }) : undefined}>
        <button
          type="button"
          className="fold-group"
          aria-expanded={!isFolded}
          aria-label={`${isFolded ? 'Expand' : 'Collapse'} ${g.label}`}
          tabIndex={subTab}
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
          tabIndex={custom ? subTab : stop === groupFocusKey ? 0 : -1}
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
            onKeyClose={() => returnFocus(groupFocusKey, '[data-nav]')}
          />
        ) : custom ? (
          <button
            type="button"
            className="row-main group-main"
            data-nav
            tabIndex={stop === groupFocusKey ? 0 : -1}
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
        {custom && groupOffset && (
          <span className="offset-badge" title={offsetLabel(groupOffset)} aria-label={`Group offsets: ${offsetLabel(groupOffset)}`}>
            ±
          </span>
        )}
        {custom && (
          <GroupMenu
            id={custom}
            name={g.label}
            onRename={() => setRenaming(`group:${custom}`)}
            tabIndex={subTab}
            beforeDelete={() => planFocus(groupFocusKey)}
          />
        )}
      </header>
      {custom && ids.length === 0 && !filtering && (
        <p className="count empty-group">Empty: drag files here, or use ⋯ › Move to {g.label} on a file.</p>
      )}
      <ul hidden={isFolded}>
        {(isFolded ? [] : g.items).map(({ pattern, tags }) => {
          const id = pattern.id;
          return (
            <FileRow
              key={id}
              pattern={pattern}
              tags={tags}
              color={colors.get(id)}
              shown={!!visible[id]}
              highlighted={highlighted === id}
              isCopy={!!copies[id]}
              warn={warningsFor(id, warnings, copies)}
              offset={offsets[id]}
              inCustom={!!custom}
              editingTags={editing === id}
              renaming={renaming === id}
              tabStop={stop === `file:${id}`}
              setEditing={setEditing}
              setRenaming={setRenaming}
              planFocus={planFocus}
              returnFocus={returnFocus}
            />
          );
        })}
      </ul>
    </section>
  );
});
