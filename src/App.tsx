import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from './state/store';
import { buildPanelGroups, selectErrors, selectInstances, selectWarnings } from './state/selectors';
import { analyzeAll } from './core/analysis/metrics';
import { styleMapByGroup } from './ui/colors';
import { Toolbar } from './ui/Toolbar';
import { FilePanel } from './ui/FilePanel';
import { useWindowDrop } from './ui/useWindowDrop';
import { PlotArea } from './ui/PlotArea';
import { HpbwChart } from './ui/HpbwChart';
import { MetricsTable } from './ui/MetricsTable';
import { BandStats } from './ui/BandStats';
import { Dialog } from './ui/Dialog';
import { useSimulation } from './ui/useSimulation';
import { StatusArea } from './ui/StatusArea';
import { useUnsavedGuard } from './ui/useUnsavedGuard';
import { EmptyState } from './ui/EmptyState';
import { HelpDialog, type OpenHelp } from './ui/HelpDialog';
import { useEscapeClear } from './ui/useEscapeClear';
import { PlotBoundary } from './ui/ErrorBoundary';
import { SkipLinks } from './ui/SkipLinks';

export default function App() {
  const files = useStore((s) => s.files);
  const overrides = useStore((s) => s.tagOverrides);
  const settings = useStore((s) => s.settings);
  const theme = useStore((s) => s.view.theme);
  const visible = useStore((s) => s.visible);
  const copies = useStore((s) => s.copies);
  const names = useStore((s) => s.names);
  const membership = useStore((s) => s.membership);
  const customGroups = useStore((s) => s.customGroups);

  const tagged = useMemo(
    () => selectInstances(files, overrides, copies, names, membership),
    [files, overrides, copies, names, membership],
  );
  const groups = useMemo(() => buildPanelGroups(tagged, customGroups), [tagged, customGroups]);
  const errors = useMemo(() => selectErrors(files), [files]);
  const warnings = useMemo(() => selectWarnings(files), [files]);
  const metrics = useMemo(() => analyzeAll(tagged, settings), [tagged, settings]);
  const sim = useSimulation(tagged, metrics, settings);
  // Colour only the currently-visible files, in panel order (groups, then items), so every
  // checked file gets its own colour and colours don't shift as unrelated files are added/removed.
  // With more than ten visible files the colour is the group's and the files differ by lightness.
  const styles = useMemo(
    () => styleMapByGroup(groups.map((g) => ({ ids: g.items.map((i) => i.pattern.id) })), visible),
    [groups, visible],
  );
  const colors = useMemo(() => new Map([...styles].map(([id, s]) => [id, s.color])), [styles]);
  const dragging = useWindowDrop();
  useUnsavedGuard();
  useEscapeClear();
  // Phone layout: the file panel is a drawer, closed until asked for (on wider screens it is always shown).
  const [filesOpen, setFilesOpen] = useState(false);
  // The Help dialog is open while `helpOpener` is set: the button that was clicked, which gets the focus back.
  const [helpOpener, setHelpOpener] = useState<HTMLElement | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const openHelp = useCallback<OpenHelp>((event) => {
    // The button is taken from its click event: the focused element at this point can be a stale one.
    setHelpOpener(event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
    setHelpOpen(true);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app">
      {tagged.length > 0 && <SkipLinks />}
      <Toolbar onHelp={openHelp} />
      <StatusArea hasErrors={errors.length > 0} beforeShowErrors={() => setFilesOpen(true)} />
      <div className="body">
        {files.length > 0 && (
          <>
            <button
              className="files-toggle"
              aria-expanded={filesOpen}
              aria-controls="file-panel"
              onClick={() => setFilesOpen((v) => !v)}
            >
              <span>
                Files ({files.length}){errors.length > 0 && ` · ${errors.length} with errors`}
              </span>
              <span aria-hidden="true">{filesOpen ? '▾' : '▸'}</span>
            </button>
            <FilePanel groups={groups} errors={errors} warnings={warnings} styles={styles} drawerOpen={filesOpen} />
          </>
        )}
        <main>
          {tagged.length === 0 ? (
            <EmptyState onHelp={openHelp} />
          ) : (
            <>
              {/* A figure that cannot be built or drawn fails inside its own box, below the controls (see PlotArea, HpbwChart and PlotlyChart). These are the last line for anything else in the two regions. */}
              <PlotBoundary className="plot">
                <PlotArea groups={groups} metrics={metrics} colors={colors} styles={styles} sim={sim} />
              </PlotBoundary>
              <PlotBoundary className="plot wide">
                <HpbwChart groups={groups} metrics={metrics} colors={colors} sim={sim} />
              </PlotBoundary>
              <MetricsTable groups={groups} metrics={metrics} colors={colors} sim={sim} onHelp={openHelp} />
              <BandStats tagged={tagged} metrics={metrics} sim={sim} onHelp={openHelp} />
            </>
          )}
        </main>
      </div>
      {dragging && <div className="drop-overlay">Drop pattern files or folders</div>}
      <Dialog />
      {helpOpen && <HelpDialog opener={helpOpener} onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
