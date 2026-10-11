import { useEffect, useMemo, useState } from 'react';
import { useStore } from './state/store';
import { buildPanelGroups, selectErrors, selectInstances, selectWarnings } from './state/selectors';
import { analyzeAll } from './core/analysis/metrics';
import { colorMap } from './ui/colors';
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
  const visibleIds = useMemo(
    () =>
      groups
        .flatMap((g) => g.items)
        .map((i) => i.pattern.id)
        .filter((id) => visible[id]),
    [groups, visible],
  );
  const colors = useMemo(() => colorMap(visibleIds), [visibleIds]);
  const dragging = useWindowDrop();
  useUnsavedGuard();
  // Phone layout: the file panel is a drawer, closed until asked for (on wider screens it is always shown).
  const [filesOpen, setFilesOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app">
      <Toolbar />
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
            <FilePanel groups={groups} errors={errors} warnings={warnings} colors={colors} drawerOpen={filesOpen} />
          </>
        )}
        <main>
          {tagged.length === 0 ? (
            <p className="empty">
              Open or drop Planet pattern files (.msi, .pln, .txt) or whole folders. Files are read in your
              browser and never uploaded.
            </p>
          ) : (
            <>
              <PlotArea groups={groups} metrics={metrics} colors={colors} sim={sim} />
              <HpbwChart groups={groups} metrics={metrics} colors={colors} sim={sim} />
              <MetricsTable groups={groups} metrics={metrics} colors={colors} sim={sim} />
              <BandStats tagged={tagged} metrics={metrics} sim={sim} />
            </>
          )}
        </main>
      </div>
      {dragging && <div className="drop-overlay">Drop pattern files or folders</div>}
      <Dialog />
    </div>
  );
}
