import { useEffect, useRef, useState, type RefObject } from 'react';
import { useStore } from '../state/store';
import { DEFAULT_SETTINGS, type AnalysisSettings } from '../core/analysis/metrics';
import { resetPrefs } from '../state/prefs';
import { confirmDialog } from './dialogs';
import { trapTab } from './trapTab';
import { clampFloor, clampSetting, FLOOR_LIMITS, SETTING_LIMITS } from '../core/analysis/settingLimits';
import { SETTING_HELP, SETTING_LABELS } from './settingsHelp';

const DEFAULT_FLOOR_DB = 40;

const LOBE_LIMIT_TITLE =
  'BASTA uses 1.78. Raise it to report a first sidelobe that lies further from the peak instead of the merged-lobe level.';

/** The analysis settings, in the order of the panel. */
const FIELDS: (keyof AnalysisSettings)[] = ['levelDb', 'fbWindowDeg', 'uslsRangeDeg', 'lobeLimitFactor', 'sectorEdgeDeg', 'siteSectors'];

/** What a rejected entry is told: the accepted range, and that the previous value stays. */
function rangeMessage(limit: { min: number; max: number; integer?: boolean }, kept: number): string {
  return `Not applied: enter ${limit.integer ? 'a whole number' : 'a number'} from ${limit.min} to ${limit.max} (kept ${kept}).`;
}

/**
 * A number input backed by its own draft string so the user can freely clear/retype a
 * value (including "0.5") without every keystroke being coerced back into the store.
 * The draft commits on blur/Enter when `accept` returns a number. A rejected draft is not
 * applied: the field goes back to the last committed `value` and a message beside it says
 * which range is accepted. The message goes away when the user types again.
 */
function NumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  integer,
  title,
  help,
  accept,
  adjusted,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  title?: string;
  /** One line under the field: what the setting changes. Read out with the field. */
  help: string;
  /** The value to commit for a typed number, or null to reject it. */
  accept: (n: number) => number | null;
  /** What to tell the user when `accept` returned a different number than the one typed. */
  adjusted?: (used: number) => string;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  // 'error': the entry was rejected; 'note': it was accepted but changed to fit.
  const [message, setMessage] = useState<{ kind: 'error' | 'note'; text: string } | null>(null);

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const n = text.trim() === '' ? NaN : Number(text);
    const ok = accept(n);
    if (ok === null) {
      setText(String(value));
      setMessage({ kind: 'error', text: rangeMessage({ min, max, integer }, value) });
      return;
    }
    setMessage(ok !== n && adjusted ? { kind: 'note', text: adjusted(ok) } : null);
    setText(String(ok));
    onCommit(ok);
  };

  return (
    <>
      <label style={{ display: 'contents' }} title={title}>
        <span>
          {label}
          <small className="range-hint" aria-hidden="true">{`${min}–${max}`}</small>
        </span>
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={text}
          aria-describedby={message ? `${id}-help ${id}-msg` : `${id}-help`}
          onChange={(e) => {
            setText(e.target.value);
            setMessage(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
      </label>
      <span id={`${id}-help`} className="setting-help">
        {help}
      </span>
      {message && (
        <span id={`${id}-msg`} className={message.kind === 'error' ? 'field-message error' : 'field-message'} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </span>
      )}
    </>
  );
}

/**
 * `onClose(true)`: closed from the keyboard (Esc), so the focus goes back to the Settings button;
 * `onClose(false)`: the user moved on (a click or Tab elsewhere), so the focus stays where they put it.
 */
export function SettingsPanel({ onClose, opener }: { onClose: (restoreFocus: boolean) => void; opener: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  const settings = useStore((s) => s.settings);
  const floorDb = useStore((s) => s.view.floorDb);
  const updateSettings = useStore((s) => s.updateSettings);
  const updateView = useStore((s) => s.updateView);
  // Bumped by Reset so every field drops what was typed (and its message) even when the value was already the default.
  const [epoch, setEpoch] = useState(0);
  // The floor was lifted by a level change (not typed): the hint beside the floor field stays while the clamp is what holds it.
  const [floorLifted, setFloorLifted] = useState(false);
  const floorHeld = floorLifted && floorDb === settings.levelDb + 1;
  useEffect(() => {
    if (floorLifted && !floorHeld) setFloorLifted(false);
  }, [floorLifted, floorHeld]);

  // With a line of help under each field the panel is taller than a low window: it then ends at the window's foot and scrolls.
  useEffect(() => {
    const fit = () => {
      const panel = ref.current;
      if (panel) panel.style.maxHeight = `${Math.max(160, window.innerHeight - panel.getBoundingClientRect().top - 8)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // The panel takes the focus when it opens and closes when the user clicks outside it.
  useEffect(() => {
    ref.current?.querySelector('input')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !opener.current?.contains(t) && !useStore.getState().dialog) onClose(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose, opener]);

  return (
    <div
      className="settings"
      role="dialog"
      aria-modal="true"
      aria-label="Analysis settings"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !useStore.getState().dialog) onClose(true);
        // Tab stays inside while the panel is open (as in the dialogs); Esc or a click elsewhere closes it.
        else trapTab(e);
      }}
      onBlur={(e) => {
        // Tab (or a programmatic move) to something outside the panel and its button closes it.
        const to = e.relatedTarget as Node | null;
        if (to && !ref.current?.contains(to) && !opener.current?.contains(to) && !useStore.getState().dialog) onClose(false);
      }}
    >
      {FIELDS.map((key) => (
        <NumberField
          key={`${key}-${epoch}`}
          id={`setting-${key}`}
          label={SETTING_LABELS[key]}
          value={settings[key]}
          {...SETTING_LIMITS[key]}
          title={key === 'lobeLimitFactor' ? LOBE_LIMIT_TITLE : undefined}
          help={SETTING_HELP[key]}
          accept={(n) => clampSetting(key, n)}
          onCommit={(n) => {
            const floorBefore = useStore.getState().view.floorDb;
            updateSettings({ [key]: n });
            const floorNow = useStore.getState().view.floorDb;
            if (floorNow !== floorBefore) setFloorLifted(true);
          }}
        />
      ))}
      <NumberField
        key={`floor-${epoch}`}
        id="setting-floorDb"
        label="Plot floor (dB)"
        value={floorDb}
        {...FLOOR_LIMITS}
        help={SETTING_HELP.floorDb}
        accept={(n) => clampFloor(n, settings.levelDb)}
        adjusted={(used) => `Used ${used}: the plot floor must lie at least 1 dB beyond the ${settings.levelDb} dB level ring.`}
        onCommit={(n) => {
          setFloorLifted(false);
          updateView({ floorDb: n });
        }}
      />
      {floorHeld && (
        <span className="field-message" role="status" data-testid="floor-raised-hint">
          Raised to stay below the −{settings.levelDb} dB level
        </span>
      )}
      <span id="setting-reset-help" className="setting-help">
        {SETTING_HELP.reset}
      </span>
      <span />
      <button
        aria-describedby="setting-reset-help"
        onClick={() => {
          updateSettings(DEFAULT_SETTINGS);
          updateView({ floorDb: DEFAULT_FLOOR_DB });
          setFloorLifted(false);
          setEpoch((n) => n + 1);
        }}
      >
        Reset
      </button>
      <span id="setting-reset-prefs-help" className="setting-help">
        {SETTING_HELP.resetPreferences}
      </span>
      <button
        style={{ gridColumn: '1 / -1' }}
        aria-describedby="setting-reset-prefs-help"
        title="Theme, gain unit, cut, plot mode, plot floor, markers, table columns, ticked-files-only table, frequency-chart metric, 3D options, collapsed controls and analysis settings go back to their defaults, and the browser forgets them. Your sub-bands and the loaded files are not touched."
        onClick={() =>
          void confirmDialog('Reset the theme, gain unit, cut, plot mode, plot floor, markers, table columns, ticked-files-only table, frequency-chart metric, 3D options, collapsed controls and analysis settings to their defaults? Your sub-bands and the loaded files are not touched.', 'Reset preferences').then(
            (ok) => {
              if (ok) resetPrefs();
            },
          )
        }
      >
        Reset preferences
      </button>
    </div>
  );
}
