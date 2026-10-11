import { useEffect, useRef, useState, type RefObject } from 'react';
import { useStore } from '../state/store';
import { DEFAULT_SETTINGS, type AnalysisSettings } from '../core/analysis/metrics';
import { resetPrefs } from '../state/prefs';
import { confirmDialog } from './dialogs';
import { clampFloor, clampSetting, FLOOR_LIMITS, SETTING_LIMITS } from '../core/analysis/settingLimits';

const DEFAULT_FLOOR_DB = 40;

const LOBE_LIMIT_TITLE =
  'BASTA uses 1.78. Raise it to report a first sidelobe that lies further from the peak instead of the merged-lobe level.';

const FIELDS: { key: keyof AnalysisSettings; label: string }[] = [
  { key: 'levelDb', label: 'Beamwidth level (dB)' },
  { key: 'fbWindowDeg', label: 'F/B window ± (°)' },
  { key: 'uslsRangeDeg', label: 'USLS window (°)' },
  { key: 'lobeLimitFactor', label: 'First-lobe limit (× V-HPBW)' },
  { key: 'sectorEdgeDeg', label: 'Sector edge (±°)' },
  { key: 'siteSectors', label: 'Sectors per site' },
];

/**
 * A number input backed by its own draft string so the user can freely clear/retype a
 * value (including "0.5") without every keystroke being coerced back into the store.
 * The draft commits on blur/Enter when `accept` returns a number; a rejected draft
 * reverts to the last committed `value` instead of applying a wrong number.
 */
function NumberField({
  label,
  value,
  min,
  max,
  step,
  title,
  accept,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  title?: string;
  /** The value to commit for a typed number, or null to reject it. */
  accept: (n: number) => number | null;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const n = text.trim() === '' ? NaN : Number(text);
    const ok = accept(n);
    if (ok !== null) onCommit(ok);
    else setText(String(value));
  };

  return (
    <label style={{ display: 'contents' }} title={title}>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </label>
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
      aria-label="Analysis settings"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !useStore.getState().dialog) onClose(true);
      }}
      onBlur={(e) => {
        // Tab (or a programmatic move) to something outside the panel and its button closes it.
        const to = e.relatedTarget as Node | null;
        if (to && !ref.current?.contains(to) && !opener.current?.contains(to) && !useStore.getState().dialog) onClose(false);
      }}
    >
      {FIELDS.map((f) => (
        <NumberField
          key={f.key}
          label={f.label}
          value={settings[f.key]}
          {...SETTING_LIMITS[f.key]}
          title={f.key === 'lobeLimitFactor' ? LOBE_LIMIT_TITLE : undefined}
          accept={(n) => clampSetting(f.key, n)}
          onCommit={(n) => updateSettings({ [f.key]: n })}
        />
      ))}
      <NumberField
        label="Plot floor (dB)"
        value={floorDb}
        {...FLOOR_LIMITS}
        accept={(n) => clampFloor(n, settings.levelDb)}
        onCommit={(n) => updateView({ floorDb: n })}
      />
      <span />
      <button
        onClick={() => {
          updateSettings(DEFAULT_SETTINGS);
          updateView({ floorDb: DEFAULT_FLOOR_DB });
        }}
      >
        Reset
      </button>
      <button
        style={{ gridColumn: '1 / -1' }}
        title="Theme, gain unit, cut, plot mode, plot floor, markers, table columns, 3D options, collapsed controls and analysis settings go back to their defaults, and the browser forgets them. Your sub-bands and the loaded files are not touched."
        onClick={() =>
          void confirmDialog('Reset the theme, gain unit, cut, plot mode, plot floor, markers, table columns, 3D options, collapsed controls and analysis settings to their defaults? Your sub-bands and the loaded files are not touched.', 'Reset preferences').then(
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
