import { useEffect, useMemo, useState } from 'react';
import { clampSim, SIM_LIMITS, useStore, type SimulationKey } from '../state/store';
import type { Method3d } from '../core/analysis/pattern3d';
import { anyTilted, combineOffsets } from '../core/analysis/tilt';
import { instanceIds, instanceName } from '../state/selectors';
import { Seg } from './Seg';
import { choiceDialog } from './dialogs';

const SLIDERS: { key: SimulationKey; label: string }[] = [
  { key: 'electricalDeg', label: 'Electrical tilt Δ (°)' },
  { key: 'mechanicalDeg', label: 'Mechanical tilt (°)' },
  { key: 'azimuthDeg', label: 'Azimuth (°)' },
];

/** Range slider plus a number box; the box holds a draft and commits (clamped) on blur/Enter. */
function NumberSlider({
  k,
  label,
  value,
  onChange,
}: {
  k: SimulationKey;
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  const { min, max, step } = SIM_LIMITS[k];
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n)) {
      onChange(n);
      setText(String(clampSim(k, n)));
    } else setText(String(value));
  };

  return (
    <div className="sim-field" role="group" aria-label={label}>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        aria-label={`${label} value`}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </div>
  );
}

function GlobalField({ k, label }: { k: SimulationKey; label: string }) {
  const value = useStore((s) => s.view.simulation[k]);
  const updateSimulation = useStore((s) => s.updateSimulation);
  return <NumberSlider k={k} label={label} value={value} onChange={(n) => updateSimulation({ [k]: n })} />;
}

function OffsetField({ id, k, label }: { id: string; k: SimulationKey; label: string }) {
  const value = useStore((s) => s.view.simulation.offsets[id]?.[k] ?? 0);
  const setOffset = useStore((s) => s.setOffset);
  return <NumberSlider k={k} label={label} value={value} onChange={(n) => setOffset(id, { [k]: n })} />;
}

const OFFSET_SLIDERS: { key: SimulationKey; label: string }[] = [
  { key: 'electricalDeg', label: 'Electrical tilt offset (°)' },
  { key: 'mechanicalDeg', label: 'Mechanical tilt offset (°)' },
  { key: 'azimuthDeg', label: 'Azimuth offset (°)' },
];

function GroupOffsetField({ id, k, label }: { id: string; k: SimulationKey; label: string }) {
  const value = useStore((s) => s.view.simulation.groupOffsets[id]?.[k] ?? 0);
  const setGroupOffset = useStore((s) => s.setGroupOffset);
  return <NumberSlider k={k} label={label} value={value} onChange={(n) => setGroupOffset(id, { [k]: n })} />;
}

function OffsetsRow() {
  const selected = useStore((s) => s.selected);
  const title = useStore((s) => {
    const sel = s.selected;
    if (!sel) return null;
    if (sel.kind === 'group') {
      const g = s.customGroups.find((x) => x.id === sel.id);
      return g ? `group ${g.name}` : null;
    }
    const src = s.copies[sel.id]?.sourceId ?? sel.id;
    const f = s.files.find((x) => x.id === src);
    if (!f || !f.result.ok) return null;
    return instanceName(sel.id, f.result.pattern.fileName, s.names) ?? f.result.pattern.fileName;
  });
  const clearOffsets = useStore((s) => s.clearOffsets);
  const clearGroupOffsets = useStore((s) => s.clearGroupOffsets);
  return (
    <div className="sim-offsets" role="group" aria-label="Per-file and group offsets">
      {selected && title ? (
        <>
          <strong>Offsets for {title}</strong>
          {OFFSET_SLIDERS.map((s) =>
            selected.kind === 'group' ? (
              <GroupOffsetField key={s.key} id={selected.id} k={s.key} label={s.label} />
            ) : (
              <OffsetField key={s.key} id={selected.id} k={s.key} label={s.label} />
            ),
          )}
          <button
            onClick={() => (selected.kind === 'group' ? clearGroupOffsets(selected.id) : clearOffsets(selected.id))}
          >
            Clear offsets
          </button>
        </>
      ) : (
        <span className="count">Click a file or a custom group to set its own offsets.</span>
      )}
    </div>
  );
}

export function SimulationBar({ is3d }: { is3d: boolean }) {
  const sim = useStore((s) => s.view.simulation);
  const files = useStore((s) => s.files);
  const copies = useStore((s) => s.copies);
  const membership = useStore((s) => s.membership);
  const customGroups = useStore((s) => s.customGroups);
  const method = useStore((s) => s.view.method3d);
  const updateView = useStore((s) => s.updateView);
  const updateSimulation = useStore((s) => s.updateSimulation);
  const resetSimulation = useStore((s) => s.resetSimulation);

  // Only successfully parsed loaded files (and their copies) count: a failed file's leftover
  // offset (kept across a same-path reload) shouldn't flag the badge or inflate the offset count.
  const okIds = useMemo(() => instanceIds(files, copies), [files, copies]);
  const combined = useMemo(
    () => combineOffsets(okIds, sim.offsets, sim.groupOffsets, membership),
    [okIds, sim.offsets, sim.groupOffsets, membership],
  );
  const groupCount = customGroups.filter((g) => sim.groupOffsets[g.id]).length;
  const fileCount = Object.keys(sim.offsets).filter((id) => okIds.includes(id)).length;
  const global = useMemo(
    () => ({ electricalDeg: sim.electricalDeg, mechanicalDeg: sim.mechanicalDeg, azimuthDeg: sim.azimuthDeg }),
    [sim.electricalDeg, sim.mechanicalDeg, sim.azimuthDeg],
  );
  // The loaded files' effective tilt (global + offset), so a cancelling offset (e.g. +3/-3)
  // is correctly untilted instead of flagged from the raw global/offset fields alone.
  const tiltActive = useMemo(() => anyTilted(okIds, global, combined), [okIds, global, combined]);
  const anyActive = tiltActive || sim.azimuthDeg !== 0 || fileCount > 0 || groupCount > 0;

  return (
    <div className="sim-bar" role="group" aria-label="Simulation">
      <strong>Simulation</strong>
      {SLIDERS.map((s) => (
        <GlobalField key={s.key} k={s.key} label={s.label} />
      ))}
      <Seg<Method3d>
        label="3D method"
        value={method}
        options={[
          ['summation', 'Summation'],
          ['weighted', 'Weighted'],
        ]}
        onChange={(method3d) => updateView({ method3d })}
        disabled={!tiltActive && !is3d}
      />
      <label>
        <input
          type="checkbox"
          checked={sim.showOriginal}
          onChange={(e) => updateSimulation({ showOriginal: e.target.checked })}
        />
        Show original
      </label>
      <button
        onClick={() => {
          const n = Object.keys(sim.offsets).length;
          const m = Object.keys(sim.groupOffsets).length;
          if (n + m === 0) {
            resetSimulation();
            return;
          }
          const parts = [
            n > 0 ? `${n} file${n === 1 ? '' : 's'}` : '',
            m > 0 ? `${m} group${m === 1 ? '' : 's'}` : '',
          ].filter(Boolean);
          void choiceDialog(`Reset the global sliders. Per-file offsets are set on ${parts.join(' and ')}.`, [
            { value: 'sliders', label: 'Reset sliders only' },
            { value: 'all', label: 'Reset everything' },
          ]).then((choice) => {
            if (choice === 'sliders' || choice === 'all') resetSimulation(choice);
          });
        }}
      >
        Reset
      </button>
      {anyActive && (
        <span className="badge" data-testid="sim-badge">
          Simulated
        </span>
      )}
      <OffsetsRow />
    </div>
  );
}
