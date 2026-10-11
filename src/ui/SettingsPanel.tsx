import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { DEFAULT_SETTINGS, type AnalysisSettings } from '../core/analysis/metrics';

const DEFAULT_FLOOR_DB = 40;

const LOBE_LIMIT_TITLE =
  'BASTA uses 1.78. Raise it to report a first sidelobe that lies further from the peak instead of the merged-lobe level.';

const FIELDS: { key: keyof AnalysisSettings; label: string }[] = [
  { key: 'levelDb', label: 'Beamwidth level (dB)' },
  { key: 'fbWindowDeg', label: 'F/B window ± (°)' },
  { key: 'uslsRangeDeg', label: 'USLS window (°)' },
  { key: 'lobeLimitFactor', label: 'First-lobe limit (× V-HPBW)' },
  { key: 'sectorEdgeDeg', label: 'Sector edge (±°)' },
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
  max,
  step,
  title,
  accepts,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max?: number;
  step?: number;
  title?: string;
  /** Extra check on top of "finite and > 0"; a rejected draft reverts like any invalid one. */
  accepts?: (n: number) => boolean;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n > 0 && (!accepts || accepts(n))) onCommit(n);
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
          max={f.key === 'sectorEdgeDeg' ? 179 : f.key === 'lobeLimitFactor' ? 10 : undefined}
          step={f.key === 'lobeLimitFactor' ? 0.01 : undefined}
          title={f.key === 'lobeLimitFactor' ? LOBE_LIMIT_TITLE : undefined}
          accepts={
            f.key === 'sectorEdgeDeg'
              ? (n) => n >= 1 && n <= 179
              : f.key === 'lobeLimitFactor'
                ? (n) => n >= 1 && n <= 10
                : undefined
          }
          onCommit={(n) => updateSettings({ [f.key]: n })}
        />
      ))}
      <NumberField
        label="Sectors per site"
        value={settings.siteSectors}
        min={2}
        max={12}
        accepts={(n) => Number.isInteger(n) && n >= 2 && n <= 12}
        onCommit={(n) => updateSettings({ siteSectors: n })}
      />
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
