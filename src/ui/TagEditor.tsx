import { useState, type FormEvent } from 'react';
import type { Tags } from '../core/types';

export function TagEditor({ tags, onSave, onCancel }: { tags: Tags; onSave: (t: Tags) => void; onCancel: () => void }) {
  const [pol, setPol] = useState(tags.polarization ?? '');
  const [tilt, setTilt] = useState(tags.tiltDeg?.toString() ?? '');
  const [port, setPort] = useState(tags.port ?? '');
  const [array, setArray] = useState(tags.array ?? '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = Number(tilt);
    onSave({
      polarization: pol.trim() || undefined,
      tiltDeg: tilt.trim() !== '' && Number.isFinite(t) ? t : undefined,
      port: port.trim() || undefined,
      array: array.trim() || undefined,
    });
  };

  return (
    <form className="tag-editor" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
      <label htmlFor="tag-pol">Polarization</label>
      <input id="tag-pol" type="text" value={pol} placeholder="+45 / -45" onChange={(e) => setPol(e.target.value)} />
      <label htmlFor="tag-tilt">Tilt (°)</label>
      <input id="tag-tilt" type="text" inputMode="decimal" value={tilt} onChange={(e) => setTilt(e.target.value)} />
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
