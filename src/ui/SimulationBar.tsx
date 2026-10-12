import { useEffect, useMemo, useState } from 'react';
import { clampSim, SIM_LIMITS, useStore, type SimulationKey } from '../state/store';
import type { Method3d } from '../core/analysis/pattern3d';
import { anyTilted, combineOffsets, type HCutMode } from '../core/analysis/tilt';
import { instanceIds, instanceName } from '../state/selectors';
import { Seg } from './Seg';
import { choiceDialog } from './dialogs';
import { H_CUT_3D_NOTE, H_CUT_HINT, hCutAnnouncement, METHOD_UNUSED_NOTE, methodUseNote, simSummary, summaryHCut, summaryMethod, weightedHorizonNote } from './simSummary';
import type { OpenHelp } from './HelpDialog';
import { announce } from './announce';
import { needsAngularRegions } from './table';
import { gripByKey, gripByPointer, gripKey } from './sliderHold';
import { usePhoneLayout } from './phoneLayout';

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
        // With many files the page follows when the slider stops, not at every step (see `followsDrag`).
        onPointerDown={gripByPointer}
        onKeyDown={(e) => {
          if (gripKey(e.key)) gripByKey();
        }}
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

const H_CUT_TITLE =
  'Which horizontal cut the files show. Through the beam peak: the file cut, and under a tilt the cone at the elevation of the tilted beam peak (the cut data sheets give). At the horizon: the cut at 0° elevation of every file, tilted or not, read from the 3D reconstruction: what each antenna puts on the horizon, and how that changes under a tilt; its levels are below the 3D peak.';

export function SimulationBar({ is3d, onHelp }: { is3d: boolean; onHelp: OpenHelp }) {
  const sim = useStore((s) => s.view.simulation);
  const files = useStore((s) => s.files);
  const copies = useStore((s) => s.copies);
  const membership = useStore((s) => s.membership);
  const customGroups = useStore((s) => s.customGroups);
  const method = useStore((s) => s.view.method3d);
  const withAngularRegions = useStore((s) => needsAngularRegions(s.view.tableGroups, s.view.freqMetric));
  const updateView = useStore((s) => s.updateView);
  const updateSimulation = useStore((s) => s.updateSimulation);
  const resetSimulation = useStore((s) => s.resetSimulation);
  const collapsed = useStore((s) => s.view.collapsed.simBar);
  const setCollapsed = (simBar: boolean) => updateView({ collapsed: { ...useStore.getState().view.collapsed, simBar } });

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
  // The cut at the horizon is a reconstructed cut of every loaded file, with or without a tilt.
  const horizonActive = sim.hCut === 'horizon' && okIds.length > 0;
  const anyActive = tiltActive || horizonActive || sim.azimuthDeg !== 0 || fileCount > 0 || groupCount > 0;

  // The method matters in the 3D view, under a tilt, for a horizon cut, and for the angular-region estimate (integrated over the reconstruction).
  const methodUses = { view3d: is3d, tilt: tiltActive, horizonCut: sim.hCut === 'horizon', angularRegions: withAngularRegions };
  const methodUsed = methodUses.view3d || methodUses.tilt || methodUses.horizonCut || methodUses.angularRegions;
  const weightedNote = weightedHorizonNote(sim.hCut, method);
  const phone = usePhoneLayout();

  // The lines about the Horizontal cut take the bar's whole width (beside the buttons they made the row so wide that
  // Reset went to a row of its own at 1024 px). On a phone they come directly under the control; on a wide screen
  // under the control's row, which Show original and Reset end. They are placed there in the page, not by the
  // stylesheet, so that Tab reaches "What is this?" in the order the bar is read.
  const notes = (
    <div className="sim-notes">
      <span className="count sim-hint">
        <span id="sim-hcut-hint" data-testid="sim-hcut-hint">
          {H_CUT_HINT}
        </span>{' '}
        {/* A real button, so the explanation is one Tab or one tap away (a tooltip on the box reaches neither). It ends
            the line it explains and follows the control in the Tab order. */}
        <button type="button" className="link" aria-haspopup="dialog" onClick={(e) => onHelp(e, 'Horizon cut')}>
          What is this?
        </button>
      </span>
      {/* The control stays usable in 3D (the table and the charts below follow it): the line says what it does not change. */}
      {is3d && (
        <span id="sim-hcut-3d" className="count sim-hint" data-testid="sim-hcut-3d">
          {H_CUT_3D_NOTE}
        </span>
      )}
      {/* Not blocked, but said where the two are chosen: the Weighted rule reshapes this cut. */}
      {weightedNote && (
        <span className="sim-hint sim-caveat" role="note" data-testid="sim-weighted-note">
          {weightedNote}
        </span>
      )}
    </div>
  );

  return (
    <div className="sim-bar" role="group" aria-label="Simulation">
      <button
        className="fold"
        aria-expanded={!collapsed}
        aria-controls="sim-body"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span> Simulation
      </button>
      {/* The badge's place is kept while the bar is open and nothing is simulated: a badge that appeared at the first
          step of a drag would push the sliders along under the held pointer. Folded there is no slider to protect,
          and on a phone the kept place would push the summary onto a second line. */}
      {anyActive ? (
        <span className="badge" data-testid="sim-badge">
          Simulated
        </span>
      ) : (
        !collapsed && (
          <span className="badge ghost" aria-hidden="true">
            Simulated
          </span>
        )
      )}
      {collapsed && (
        <span className="count" data-testid="sim-summary">
          {simSummary(global, fileCount, groupCount, summaryMethod(method, tiltActive, withAngularRegions, sim.hCut), summaryHCut(sim.hCut, tiltActive))}
        </span>
      )}
      <div id="sim-body" className="sim-body" hidden={collapsed}>
      {SLIDERS.map((s) => (
        <GlobalField key={s.key} k={s.key} label={s.label} />
      ))}
      <div className="sim-choice">
        <span>3D method</span>
        <Seg<Method3d>
          label="3D method"
          value={method}
          options={[
            ['summation', 'Summation'],
            ['weighted', 'Weighted'],
          ]}
          onChange={(method3d) => updateView({ method3d })}
          disabled={!methodUsed}
        />
        {/* A disabled button cannot be focused or tapped for a tooltip: the reason is written beside it (under it on a
            phone). The same place says what uses the method once something does: the two lines lie on one another and
            the reason, the longer one, sets the size, so nothing in the bar moves when a slider's first step enables
            the control, and no empty band is kept for it. */}
        <span className="count sim-hint sim-slot">
          <span className={methodUsed ? 'ghost' : undefined} aria-hidden={methodUsed || undefined} data-testid="sim-method-hint">
            {METHOD_UNUSED_NOTE}
          </span>
          <span className={methodUsed ? undefined : 'ghost'} aria-hidden={!methodUsed || undefined} data-testid="sim-method-use">
            {methodUsed ? methodUseNote(methodUses) : ''}
          </span>
        </span>
      </div>
      <div className="sim-choice" title={H_CUT_TITLE}>
        <span>Horizontal cut</span>
        <Seg<HCutMode>
          label="Horizontal cut"
          value={sim.hCut}
          options={[
            ['beam', 'Through the beam peak'],
            ['horizon', 'At the horizon'],
          ]}
          describedBy={is3d ? 'sim-hcut-hint sim-hcut-3d' : 'sim-hcut-hint'}
          onChange={(hCut) => {
            if (hCut === sim.hCut) return;
            updateSimulation({ hCut });
            // The plot, a table column and most horizontal cells change at once: say so in the status region (read out, not shown: a toast would cover the bar).
            announce(hCutAnnouncement(hCut));
          }}
        />
      </div>
      {phone && notes}
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
          void choiceDialog(`Reset the global sliders. Per-file offsets are set on ${parts.join(' and ')}. "Reset everything" also returns the horizontal cut to "Through the beam peak".`, [
            { value: 'sliders', label: 'Reset sliders only' },
            { value: 'all', label: 'Reset everything' },
          ]).then((choice) => {
            if (choice === 'sliders' || choice === 'all') resetSimulation(choice);
          });
        }}
      >
        Reset
      </button>
      {!phone && notes}
      <OffsetsRow />
      </div>
    </div>
  );
}
