import { useState } from 'react';
import { useStore } from '../state/store';
import { inputsFromFileList } from '../state/files';
import { serializeProject } from '../state/project';
import { openSelection } from './openSelection';
import { SettingsPanel } from './SettingsPanel';
import { saveProjectDialog } from './dialogs';
import { downloadText } from './download';

export function Toolbar() {
  const clear = useStore((s) => s.clear);
  const gainUnit = useStore((s) => s.view.gainUnit);
  const theme = useStore((s) => s.view.theme);
  const updateView = useStore((s) => s.updateView);
  const hasFiles = useStore((s) => s.files.length > 0);
  const hasSessionState = useStore((s) => s.files.length > 0 || s.pendingFiles.length > 0);
  const setLoadMessage = useStore((s) => s.setLoadMessage);
  const [showSettings, setShowSettings] = useState(false);

  const onPick = async (input: HTMLInputElement) => {
    try {
      if (input.files) await openSelection(await inputsFromFileList(input.files));
    } catch {
      setLoadMessage('Could not read the selected files');
    } finally {
      input.value = '';
    }
  };

  const onSaveProject = async () => {
    const options = await saveProjectDialog();
    if (!options) return;
    try {
      const date = new Date().toISOString().slice(0, 10);
      downloadText(
        `lobe-story-${date}.lobestory.json`,
        serializeProject(useStore.getState(), options.includeFiles),
        'application/json',
      );
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
        aria-label="Toggle dark mode"
        onClick={() => updateView({ theme: theme === 'dark' ? 'light' : 'dark' })}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <button aria-expanded={showSettings} onClick={() => setShowSettings((v) => !v)}>
        Settings
      </button>
      {hasSessionState && <button onClick={clear}>Clear</button>}
      {showSettings && <SettingsPanel />}
    </header>
  );
}
