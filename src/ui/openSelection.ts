import { useStore, type AddFilesOptions } from '../state/store';
import { planSelection, type ReadInputsResult } from '../state/files';
import { parseProject } from '../state/project';
import { choiceDialog, confirmDialog } from './dialogs';

const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/**
 * Takes a read selection (Open files / Open folder / Open project / a drop) into the session.
 *
 * - Pattern files only: they are loaded.
 * - One project candidate and nothing else: it opens as a project.
 * - Pattern files and one project candidate: the user is asked which was meant. "Open the project"
 *   then loads the pattern files against it, so a layout-only project's pending files are satisfied
 *   by the files that came with it.
 * - Several project candidates: none is opened; the pattern files load and the status line says so.
 *
 * Opening a project over an existing session asks "Replace the current session?" first.
 */
export async function openSelection(read: ReadInputsResult): Promise<void> {
  const loadPatterns = (options: AddFilesOptions = {}) =>
    useStore.getState().addFiles(read.inputs, { unreadable: read.failed, ...options });

  const plan = planSelection(read.inputs.length, read.projects.length);
  if (plan.kind === 'patterns') {
    const n = plan.ignoredProjects;
    loadPatterns(n > 0 ? { note: `${n} project files found — open one with Open project` } : {});
    return;
  }

  const candidate = read.projects[0];
  const name = fileNameOf(candidate.path);
  const parsed = parseProject(candidate.text);
  if (!parsed.ok) {
    // Not something that can be opened: there is nothing to ask about.
    if (plan.kind === 'ask') loadPatterns({ note: `${name}: ${parsed.error}` });
    else useStore.getState().setLoadMessage(parsed.error);
    return;
  }

  if (plan.kind === 'ask') {
    const choice = await choiceDialog(`This selection contains a project file: ${name}`, [
      { value: 'project', label: 'Open the project' },
      { value: 'patterns', label: 'Load the pattern files only' },
    ]);
    if (choice === null) return;
    if (choice === 'patterns') {
      loadPatterns();
      return;
    }
  }

  const { files, pendingFiles } = useStore.getState();
  if ((files.length > 0 || pendingFiles.length > 0) && !(await confirmDialog('Replace the current session?', 'Replace'))) {
    return;
  }
  useStore.getState().loadProject(parsed.project);
  if (read.inputs.length > 0 || read.failed > 0) loadPatterns({ keepUndo: true, openedProject: name });
}
