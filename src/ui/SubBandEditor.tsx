import { useEffect, useState } from 'react';
import { MAX_FREQUENCY_MHZ, MAX_SUB_BANDS, sanitizeSubBands, SUB_BAND_PRESETS, type SubBand } from '../core/analysis/subBands';
import { editSubBand, sameSubBands } from './bandView';

/**
 * An input backed by its own draft string; commits on blur / Enter. A rejected draft reverts, and so does a
 * draft that changes nothing (`onCommit` returns false), so Enter followed by blur commits once.
 */
function DraftField({
  label,
  value,
  type,
  accept,
  onCommit,
}: {
  label: string;
  value: string;
  type: 'text' | 'number';
  accept: (text: string) => boolean;
  onCommit: (text: string) => boolean;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (!accept(text) || !onCommit(text)) setText(value);
  };
  return (
    <input
      type={type}
      aria-label={label}
      value={text}
      min={type === 'number' ? 0 : undefined}
      max={type === 'number' ? MAX_FREQUENCY_MHZ : undefined}
      step={type === 'number' ? 'any' : undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

const positive = (text: string): boolean => {
  const n = text.trim() === '' ? NaN : Number(text);
  return Number.isFinite(n) && n > 0 && n <= MAX_FREQUENCY_MHZ;
};

export function SubBandEditor({
  subBands,
  automatic,
  onChange,
}: {
  subBands: SubBand[];
  automatic: SubBand[];
  onChange(next: SubBand[]): void;
}) {
  const atMax = subBands.length >= MAX_SUB_BANDS;
  const add = (b: SubBand) => onChange(sanitizeSubBands([...subBands, b]));
  /** Applies an edit; false (and no `onChange`) when it leaves the sub-bands as they are. */
  const edit = (index: number, patch: Partial<SubBand>): boolean => {
    const next = editSubBand(subBands, index, patch);
    if (sameSubBands(next, subBands)) return false;
    onChange(next);
    return true;
  };
  const span = automatic.length
    ? { minMHz: Math.min(...automatic.map((b) => b.minMHz)), maxMHz: Math.max(...automatic.map((b) => b.maxMHz)) }
    : { minMHz: 1, maxMHz: 6000 };

  return (
    <div className="subbands" role="group" aria-label="Sub-bands">
      {subBands.length === 0 ? (
        <div className="subband-row">
          <span className="count">Automatic: one sub-band per group of frequencies no more than 100 MHz apart.</span>
          <button disabled={automatic.length === 0} onClick={() => onChange(automatic)}>
            Start from automatic
          </button>
        </div>
      ) : (
        subBands.map((b, i) => (
          <div className="subband-row" key={i}>
            <DraftField
              type="text"
              label={`Sub-band ${i + 1} name`}
              value={b.name}
              accept={() => true}
              onCommit={(t) => edit(i, { name: t })}
            />
            <DraftField
              type="number"
              label={`Sub-band ${i + 1} min (MHz)`}
              value={String(b.minMHz)}
              accept={positive}
              onCommit={(t) => edit(i, { minMHz: Number(t) })}
            />
            <DraftField
              type="number"
              label={`Sub-band ${i + 1} max (MHz)`}
              value={String(b.maxMHz)}
              accept={positive}
              onCommit={(t) => edit(i, { maxMHz: Number(t) })}
            />
            <button aria-label={`Remove sub-band ${i + 1}`} onClick={() => onChange(subBands.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))
      )}
      <div className="subband-row">
        <button disabled={atMax} onClick={() => add({ name: '', ...span })}>
          Add sub-band
        </button>
        <select
          aria-label="Add a common sub-band"
          value=""
          disabled={atMax}
          onChange={(e) => {
            const preset = SUB_BAND_PRESETS[Number(e.target.value)];
            if (preset) add(preset);
          }}
        >
          <option value="">Common sub-bands…</option>
          {SUB_BAND_PRESETS.map((p, i) => (
            <option key={p.name} value={i}>
              {p.name}
            </option>
          ))}
        </select>
        {subBands.length > 0 && <button onClick={() => onChange([])}>Use automatic</button>}
      </div>
    </div>
  );
}
