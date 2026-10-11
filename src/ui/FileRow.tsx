import { memo, useEffect, type DragEvent } from 'react';
import { useStore, type OffsetState } from '../state/store';
import type { Pattern, Tags } from '../core/types';
import { nameOf } from '../core/names';
import { TagEditor } from './TagEditor';
import { sameTags } from './tagEdit';
import { offsetLabel } from './table';
import { onSpace } from './rovingKeys';
import { FileMenu, NameEditor } from './FilePanelMenus';
import { swatchBackground, type LineDash } from './colors';
import { hoverStore, setHoverId } from './hoverPreview';

export const DRAG_TYPE = 'text/x-pattern-id';

/** Starts dragging file `id` (to a group); stops the event so the row's own handler does not run it twice. */
function startDrag(e: DragEvent<HTMLElement>, id: string): void {
  e.stopPropagation();
  e.dataTransfer.setData(DRAG_TYPE, id);
}

interface Props {
  pattern: Pattern;
  tags: Tags;
  color: string | undefined;
  /** Line pattern of the file's traces (not solid only when a hue repeats among many groups). */
  dash: LineDash | undefined;
  /** Ticked: drawn in the plots. */
  shown: boolean;
  highlighted: boolean;
  isCopy: boolean;
  warn: string[] | undefined;
  offset: OffsetState | undefined;
  inCustom: boolean;
  editingTags: boolean;
  renaming: boolean;
  /** This row is the panel's one tab stop: its controls are reachable by Tab. */
  tabStop: boolean;
  // The callbacks below must be stable (state setters, or useCallback in the panel) or the memo is void.
  setEditing: (id: string | null) => void;
  setRenaming: (key: string | null) => void;
  planFocus: (key: string) => void;
  returnFocus: (key: string, selector: string) => void;
}

/** One file of the panel. Memoised: its props are plain values, so highlighting or ticking one row leaves the others alone. */
export const FileRow = memo(function FileRow({
  pattern,
  tags,
  color,
  dash,
  shown,
  highlighted,
  isCopy,
  warn,
  offset,
  inCustom,
  editingTags,
  renaming,
  tabStop,
  setEditing,
  setRenaming,
  planFocus,
  returnFocus,
}: Props) {
  const toggleVisible = useStore((s) => s.toggleVisible);
  const pickFile = useStore((s) => s.pickFile);
  const setTags = useStore((s) => s.setTags);
  const rename = useStore((s) => s.rename);
  const id = pattern.id;
  const name = nameOf(pattern);
  const subTab = tabStop ? undefined : -1;
  // A row that goes away (filtered out, removed) while previewed would never see its pointer leave.
  useEffect(
    () => () => {
      if (hoverStore.getState().id === id) setHoverId(null);
    },
    [id],
  );
  return (
    <li
      data-focus-key={`file:${id}`}
      className={highlighted ? 'hl' : undefined}
      draggable
      onDragStart={(e) => startDrag(e, id)}
      onClick={() => pickFile(id)}
      // Previews the file's trace in the cut plots (a separate tiny store: nothing re-renders).
      onPointerEnter={() => setHoverId(id)}
      onPointerLeave={() => setHoverId(null)}
      onFocus={() => setHoverId(id)}
      onBlur={() => setHoverId(null)}
    >
      <input
        type="checkbox"
        aria-label={`Show ${name}`}
        tabIndex={subTab}
        checked={shown}
        onClick={(e) => e.stopPropagation()}
        onChange={() => toggleVisible(id)}
      />
      {renaming ? (
        <>
          <span className="swatch" style={{ background: color ? swatchBackground(color, dash ?? 'solid') : 'transparent' }} />
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
          tabIndex={tabStop ? 0 : -1}
          aria-current={highlighted || undefined}
          title="Enter: show and highlight (again: clear) · Space: show or hide · Up/Down: next row"
          {...onSpace(() => toggleVisible(id))}
        >
          <span className="swatch" style={{ background: color ? swatchBackground(color, dash ?? 'solid') : 'transparent' }} />
          <span>{pattern.frequencyMHz} MHz</span>
          <span className="fname" title={pattern.fileName}>
            {name}
          </span>
        </button>
      )}
      {isCopy && <span className="copy-tag">copy</span>}
      {warn && (
        <span className="warn" title={warn.join('\n')} aria-label={`${warn.length} warnings`}>
          ⚠
        </span>
      )}
      {offset && (
        <span className="offset-badge" title={offsetLabel(offset)} aria-label={`Offsets: ${offsetLabel(offset)}`}>
          ±
        </span>
      )}
      <button
        aria-label={`Edit tags of ${name}`}
        aria-expanded={editingTags}
        data-edit-tags
        tabIndex={subTab}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(editingTags ? null : id);
        }}
      >
        ✎
      </button>
      <FileMenu
        id={id}
        name={name}
        inCustom={inCustom}
        tabIndex={subTab}
        onRename={() => setRenaming(id)}
        beforeRemove={() => planFocus(`file:${id}`)}
      />
      {editingTags && (
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
});
