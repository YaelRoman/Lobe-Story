import { useRef, useState, type FormEvent } from 'react';
import { parseTilt } from './tagEdit';
import type { Tags } from '../core/types';

export function TagEditor({ tags, onSave, onCancel }: { tags: Tags; onSave: (t: Tags) => void; onCancel: () => void }) {
  const [pol, setPol] = useState(tags.polarization ?? '');
  const [tilt, setTilt] = useState(tags.tiltDeg?.toString() ?? '');
  const [port, setPort] = useState(tags.port ?? '');
  const [array, setArray] = useState(tags.array ?? '');

  const [tiltError, setTiltError] = useState<string | null>(null);
  const tiltRef = useRef<HTMLInputElement>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseTilt(tilt);
    if (!parsed.ok) {
      // Nothing is saved: the message says why and the focus goes to the field.
      setTiltError(parsed.message);
      tiltRef.current?.focus();
      return;
    }
    onSave({
      polarization: pol.trim() || undefined,
      tiltDeg: parsed.value,
      port: port.trim() || undefined,
      array: array.trim() || undefined,
    });
  };

  return (
    <form
      className="tag-editor"
      aria-label="Tags"
      onSubmit={submit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <label htmlFor="tag-pol">Polarization</label>
      <input id="tag-pol" type="text" autoFocus value={pol} placeholder="+45 / -45" onChange={(e) => setPol(e.target.value)} />
      <label htmlFor="tag-tilt">Tilt (°)</label>
      <input
        id="tag-tilt"
        ref={tiltRef}
        type="text"
        inputMode="decimal"
        value={tilt}
        aria-invalid={tiltError !== null || undefined}
        aria-describedby={tiltError ? 'tag-tilt-msg' : undefined}
        onChange={(e) => {
          setTilt(e.target.value);
          setTiltError(null);
        }}
      />
      {tiltError && (
        <span id="tag-tilt-msg" className="field-message error" role="alert">
          {tiltError}
        </span>
      )}
      <label htmlFor="tag-port">Port</label>
      <input id="tag-port" type="text" value={port} onChange={(e) => setPort(e.target.value)} />
      <label htmlFor="tag-array">Array</label>
      <input id="tag-array" type="text" value={array} onChange={(e) => setArray(e.target.value)} />
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
