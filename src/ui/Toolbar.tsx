import { useCallback, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { inputsFromFileList } from '../state/files';
import { savedCounts, savedMessage, serializeProject } from '../state/project';
import { clearNeedsConfirm, clearQuestion } from '../state/undo';
import { openSelection } from './openSelection';
import { SettingsPanel } from './SettingsPanel';
import { confirmDialog, saveProjectDialog } from './dialogs';
import { downloadText } from './download';
import type { OpenHelp } from './HelpDialog';
import { undoWording } from './undoKeys';
import { isTouchOnly } from './phoneLayout';

export function Toolbar({ onHelp, onEncyclopedia }: { onHelp: OpenHelp; onEncyclopedia: () => void }) {
  const clear = useStore((s) => s.clear);
  const gainUnit = useStore((s) => s.view.gainUnit);
  const theme = useStore((s) => s.view.theme);
  const updateView = useStore((s) => s.updateView);
  const hasFiles = useStore((s) => s.files.length > 0);
  const hasSessionState = useStore((s) => s.files.length > 0 || s.pendingFiles.length > 0);
  const setLoadMessage = useStore((s) => s.setLoadMessage);
  const [showSettings, setShowSettings] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const closeSettings = useCallback((restoreFocus: boolean) => {
    setShowSettings(false);
    if (restoreFocus) settingsButton.current?.focus();
  }, []);

  const onPick = async (input: HTMLInputElement) => {
    try {
      if (input.files) await openSelection(await inputsFromFileList(input.files));
    } catch {
      // One file: its name is the news. (A file that cannot be parsed is not this: it is listed with its reason.)
      const names = Array.from(input.files ?? [], (f) => f.name);
      setLoadMessage(names.length === 1 ? `Could not read ${names[0]}` : 'Could not read the selected files');
    } finally {
      input.value = '';
    }
  };

  const onClear = async () => {
    const state = useStore.getState();
    if (clearNeedsConfirm(state)) {
      const ok = await confirmDialog(clearQuestion(state, undoWording({ keys: !isTouchOnly(), narrow: false }).beforeClear), 'Clear');
      if (!ok) return;
    }
    clear();
  };

  const onSaveProject = async () => {
    const options = await saveProjectDialog();
    if (!options) return;
    try {
      const date = new Date().toISOString().slice(0, 10);
      const fileName = `lobe-story-${date}.lobestory.json`;
      downloadText(
        fileName,
        serializeProject(useStore.getState(), options.includeFiles),
        'application/json',
      );
      useStore.getState().markSaved();
      const { written, missing } = savedCounts(useStore.getState());
      setLoadMessage(savedMessage(fileName, written, options.includeFiles, missing), 'info');
    } catch {
      setLoadMessage('Could not save the project');
    }
  };

  const onOpenProject = async (input: HTMLInputElement) => {
    try {
      const file = input.files?.[0];
      if (!file) return;
      await openSelection({ inputs: [], projects: [{ path: file.name, text: await file.text() }], failed: 0 });
    } catch {
      setLoadMessage('Could not read the project file');
    } finally {
      input.value = '';
    }
  };

  return (
    <header className="toolbar">
      <h1>Lobe-Story</h1>
      <label className="button">
        Open files
        <input
          data-testid="file-input"
          className="visually-hidden"
          type="file"
          multiple
          accept=".msi,.pln,.txt,.json"
          onChange={(e) => void onPick(e.currentTarget)}
        />
      </label>
      <label className="button">
        Open folder
        <input
          data-testid="folder-input"
          className="visually-hidden"
          type="file"
          multiple
          {...{ webkitdirectory: '' }}
          onChange={(e) => void onPick(e.currentTarget)}
        />
      </label>
      <label className="button">
        Open project
        <input
          data-testid="project-input"
          className="visually-hidden"
          type="file"
          accept=".json,application/json"
          onChange={(e) => void onOpenProject(e.currentTarget)}
        />
      </label>
      {hasFiles && <button onClick={() => void onSaveProject()}>Save project</button>}
      <div className="seg" role="group" aria-label="Gain unit">
        {(['dBd', 'dBi'] as const).map((u) => (
          <button key={u} aria-pressed={gainUnit === u} onClick={() => updateView({ gainUnit: u })}>
            {u}
          </button>
        ))}
      </div>
      <button
        aria-label="Dark mode"
        aria-pressed={theme === 'dark'}
        onClick={() => updateView({ theme: theme === 'dark' ? 'light' : 'dark' })}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <button ref={settingsButton} aria-expanded={showSettings} aria-haspopup="dialog" onClick={() => setShowSettings((v) => !v)}>
        Settings
      </button>
      <button onClick={onHelp} aria-haspopup="dialog">
        Help
      </button>
      <button onClick={onEncyclopedia} aria-haspopup="dialog" title="Metric Encyclopedia: definitions, examples and comparisons for every metric">
        Encyclopedia
      </button>
      {hasSessionState && <button onClick={() => void onClear()}>Clear</button>}
      {showSettings && <SettingsPanel onClose={closeSettings} opener={settingsButton} />}
    </header>
  );
}
