import { useStore } from '../state/store';
import type { ReadInputsResult } from '../state/files';
import { parseProject } from '../state/project';
import { confirmDialog } from './dialogs';

/**
 * Takes a read selection (Open files / Open folder / Open project / a drop) into the session.
 * A saved project in the selection opens as a project, replacing the session after a confirmation;
 * pattern files in the same selection are then loaded against it, so a layout-only project's
 * pending files are satisfied by the files dropped with it.
 */
export async function openSelection(read: ReadInputsResult): Promise<void> {
  const store = useStore.getState();
  let project = null;
  let firstError: string | null = null;
  for (const candidate of read.projects) {
    const parsed = parseProject(candidate.text);
    if (parsed.ok) project ??= parsed.project;
    else firstError ??= parsed.error;
  }
  if (project) {
    const { files, pendingFiles } = store;
    if ((files.length > 0 || pendingFiles.length > 0) && !(await confirmDialog('Replace the current session?', 'Replace'))) {
      return;
    }
    useStore.getState().loadProject(project);
  }
  if (read.inputs.length > 0 || (!project && !firstError) || read.failed > 0) {
    useStore.getState().addFiles(read.inputs, { unreadable: read.failed, keepUndo: project !== null });
  } else if (!project && firstError) {
    // A .json that is not a project, with nothing else in the selection.
    store.setLoadMessage(firstError);
  }
}
