import { useState, type KeyboardEvent } from 'react';
import { useStore } from '../state/store';
import { confirmDialog, promptDialog } from './dialogs';
import { moveFocus } from './rovingKeys';

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

export function NameEditor({
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

export function FileMenu({
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

export function GroupMenu({
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
