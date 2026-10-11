import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { DEFAULT_SETTINGS, type AnalysisSettings } from '../core/analysis/metrics';

const DEFAULT_FLOOR_DB = 40;

const FIELDS: { key: keyof AnalysisSettings; label: string }[] = [
  { key: 'levelDb', label: 'Beamwidth level (dB)' },
  { key: 'fbWindowDeg', label: 'F/B window ± (°)' },
  { key: 'uslsRangeDeg', label: 'USLS range above peak (°)' },
  { key: 'nullSearchDeg', label: 'Null search range (°)' },
  { key: 'sectorEdgeDeg', label: 'Tracking window ± (°)' },
];

/**
 * A number input backed by its own draft string so the user can freely clear/retype a
 * value (including "0.5") without every keystroke being coerced back into the store.
 * The draft commits on blur/Enter when it parses to a finite number > 0; an invalid
 * draft reverts to the last committed `value` instead of applying a wrong number.
 */
function NumberField({
  label,
  value,
  min,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n > 0) onCommit(n);
    else setText(String(value));
  };

  return (
    <label style={{ display: 'contents' }}>
      <span>{label}</span>
      <input
        type="number"
        min={min}
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

export function SettingsPanel() {
  const settings = useStore((s) => s.settings);
  const floorDb = useStore((s) => s.view.floorDb);
  const updateSettings = useStore((s) => s.updateSettings);
  const updateView = useStore((s) => s.updateView);

  return (
    <div className="settings" role="dialog" aria-label="Analysis settings">
      {FIELDS.map((f) => (
        <NumberField
          key={f.key}
          label={f.label}
          value={settings[f.key]}
          min={1}
          onCommit={(n) => updateSettings({ [f.key]: n })}
        />
      ))}
      <NumberField
        label="Plot floor (dB)"
        value={floorDb}
        min={5}
        onCommit={(n) => updateView({ floorDb: Math.max(5, settings.levelDb + 1, n) })}
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
    </div>
  );
}
