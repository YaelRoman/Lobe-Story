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
import { needsAngularRegions } from './ui/table';
import { BandStats } from './ui/BandStats';
import { Dialog } from './ui/Dialog';
import { useSettledSimulation, useSimulation } from './ui/useSimulation';
import { drawnFiles, estimatedUnits, useSliderKind } from './ui/sliderHold';
import { useFollowsDrag, usePassStart } from './ui/passCost';
import { StatusArea } from './ui/StatusArea';
import { useUnsavedGuard } from './ui/useUnsavedGuard';
import { EmptyState } from './ui/EmptyState';
import { HelpDialog, type OpenHelp } from './ui/HelpDialog';
import { useEscapeClear } from './ui/useEscapeClear';
import { useFirstFilesFocus } from './ui/useFirstFilesFocus';
import { PlotBoundary } from './ui/ErrorBoundary';
import { SkipLinks } from './ui/SkipLinks';
import { NotDefaultLine } from './ui/NotDefaultLine';
import { lagNote } from './ui/updateHint';

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
  // The angular-region estimate integrates over the sphere: it is computed only while its columns are shown or plotted.
  const withAngularRegions = useStore((s) => needsAngularRegions(s.view.tableGroups, s.view.freqMetric));
  const method3d = useStore((s) => s.view.method3d);
  const back3d = useStore((s) => s.view.back3d);
  const areMethod = withAngularRegions ? method3d : undefined;
  // The back of the vertical cut changes the untilted files' numbers only through the angular-region estimate.
  const areBackHalf = withAngularRegions && back3d;
  const metrics = useMemo(() => analyzeAll(tagged, settings, { areMethod, areBackHalf }), [tagged, settings, areMethod, areBackHalf]);
  // With many files a slider is not followed while it is dragged: the simulation is made once, when it stops.
  const tickedCount = useMemo(() => tagged.reduce((n, i) => n + (visible[i.pattern.id] ? 1 : 0), 0), [tagged, visible]);
  // Whether it is goes by what the passes of the slider's kind took on this machine (the file counts are the first
  // guess, and scale them): an azimuth is far cheaper than a tilt.
  // The 3D methods compared draw one file twice: that counts as two drawn files.
  const comparingMethods = useStore((s) => s.view.dimension === '3d' && s.view.compare3d);
  const drawn = drawnFiles(tickedCount, comparingMethods);
  const load = useMemo(() => ({ files: tagged.length, drawn, angularRegions: withAngularRegions }), [tagged.length, drawn, withAngularRegions]);
  const follows = useFollowsDrag(load)[useSliderKind()];
  const settled = useSettledSimulation(follows);
  // A pass is timed from here (before the simulation is worked out) to the cut plots having drawn it, and only while
  // nothing else changes: not the files, the ticks, the settings or the view.
  const dimension = useStore((s) => s.view.dimension);
  const cutView = useStore((s) => s.view.cut);
  const plotMode = useStore((s) => s.view.mode);
  usePassStart(settled.state, [tagged, visible, settings, method3d, back3d, withAngularRegions, dimension, cutView, plotMode], estimatedUnits(load), dimension !== '3d');
  const sim = useSimulation(tagged, metrics, settings, withAngularRegions, settled.state);
  const simLag = settled.waiting ? 'waiting' : settled.behind ? 'behind' : 'none';
  // Said and shown only where the lag lasts (the page does not follow a drag): where it does, the simulation is a
  // moment behind at every step and nothing flashes for it, as before.
  const simStale = simLag !== 'none' && !follows;
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
  useFirstFilesFocus(tagged.length);
  // Phone layout: the file panel is a drawer, closed until asked for (on wider screens it is always shown).
  const [filesOpen, setFilesOpen] = useState(false);
  // The Help dialog is open while `helpOpener` is set: the button that was clicked, which gets the focus back.
  const [helpOpener, setHelpOpener] = useState<HTMLElement | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpTerm, setHelpTerm] = useState<string | undefined>(undefined);
  const openHelp = useCallback<OpenHelp>((event, term) => {
    // The button is taken from its click event: the focused element at this point can be a stale one.
    setHelpOpener(event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
    setHelpTerm(term);
    setHelpOpen(true);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app">
      {tagged.length > 0 && <SkipLinks />}
      <Toolbar onHelp={openHelp} />
      {/* What is not at its default and changes the numbers, each with a click to put it back (none: no line, no room). */}
      <NotDefaultLine />
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
        <main data-sim-behind={simStale || undefined}>
          {tagged.length === 0 ? (
            <EmptyState onHelp={openHelp} />
          ) : (
            <>
              {/* A figure that cannot be built or drawn fails inside its own box, below the controls (see PlotArea, HpbwChart and PlotlyChart). These are the last line for anything else in the two regions. */}
              <PlotBoundary className="plot">
                <PlotArea groups={groups} metrics={metrics} colors={colors} styles={styles} sim={sim} simLag={simLag} simStale={simStale} onHelp={openHelp} />
              </PlotBoundary>
              {/* What is made from the simulation and is not the cut plots (they have their own line): marked, for the eye
                  and for a screen reader, while it shows an older simulation than the sliders. One box around the three,
                  so that none of them renders again for the mark. */}
              {/* Why they are dimmed, said where they are: a slider moved by a held key can be far above, with its bar and
                  the plots' line off the screen. The sentence takes no room and stays at the top of the page while the
                  chart, the table or the statistics are on it (see `.follows-note-anchor`); outside the dimmed box, so it is
                  not dimmed itself. Hidden from a screen reader, which has the same sentence in the bar and `aria-busy` on the box. */}
              <div className="follows-note-anchor">
                {simStale && (
                  <p className="count sim-lag" data-testid="follows-note" aria-hidden="true">
                    {lagNote(simLag, dimension === '3d')}
                  </p>
                )}
              </div>
              <div className="follows-sim" aria-busy={simStale || undefined}>
                <PlotBoundary className="plot wide">
                  <HpbwChart groups={groups} metrics={metrics} colors={colors} sim={sim} />
                </PlotBoundary>
                <MetricsTable groups={groups} metrics={metrics} colors={colors} sim={sim} onHelp={openHelp} />
                <BandStats tagged={tagged} metrics={metrics} sim={sim} onHelp={openHelp} />
              </div>
            </>
          )}
        </main>
      </div>
      {dragging && <div className="drop-overlay">Drop pattern files or folders</div>}
      <Dialog />
      {helpOpen && <HelpDialog opener={helpOpener} term={helpTerm} onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
