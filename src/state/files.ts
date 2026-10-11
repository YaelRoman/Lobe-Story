export interface FileInput {
  path: string;
  bytes: ArrayBuffer;
}

/** A file from a selection or drop that may be a saved project (see `isProjectCandidate`). */
export interface ProjectCandidate {
  path: string;
  text: string;
}

/** Result of reading a selection or drop: the files that read OK, and how many did not. */
export interface ReadInputsResult {
  inputs: FileInput[];
  projects: ProjectCandidate[];
  failed: number;
}

/**
 * Whether a file of a selection is read as a possible project. A folder or a multi-file drop can
 * hold any `.json` (exports, settings of other tools), so there only the app's own
 * `.lobestory.json` counts; a `.json` picked or dropped on its own always does.
 */
export function isProjectCandidate(path: string, soleFile: boolean): boolean {
  return /\.lobestory\.json$/i.test(path) || (soleFile && /\.json$/i.test(path));
}

/** What to do with a selection, from how many pattern files and project candidates it holds. */
export type SelectionPlan =
  /** Load the pattern files; `ignoredProjects` candidates (two or more) were left unopened. */
  | { kind: 'patterns'; ignoredProjects: number }
  /** The one candidate is all there is: open it. */
  | { kind: 'project' }
  /** Pattern files and exactly one candidate: ask which the user meant. */
  | { kind: 'ask' };

export function planSelection(patterns: number, projects: number): SelectionPlan {
  if (projects === 1) return patterns > 0 ? { kind: 'ask' } : { kind: 'project' };
  return { kind: 'patterns', ignoredProjects: projects };
}

export function isPatternFile(path: string): boolean {
  return /\.(msi|pln|txt)$/i.test(path);
}

export async function inputsFromFileList(list: FileList): Promise<ReadInputsResult> {
  const inputs: FileInput[] = [];
  const projects: ProjectCandidate[] = [];
  let failed = 0;
  const files = Array.from(list);
  // A folder pick gives every file a relative path; one file picked by itself has none.
  const sole = files.length === 1 && !files[0].webkitRelativePath;
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    try {
      if (isPatternFile(path)) inputs.push({ path, bytes: await file.arrayBuffer() });
      else if (isProjectCandidate(path, sole)) projects.push({ path, text: await file.text() });
    } catch {
      failed++;
    }
  }
  return { inputs, projects, failed };
}

/** Reads dropped files and folders (recursively). Entries are captured synchronously, before any await. */
export async function inputsFromDataTransfer(dt: DataTransfer): Promise<ReadInputsResult> {
  const entries = Array.from(dt.items)
    .map((item) => item.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e !== null);
  const sole = entries.length === 1 && entries[0].isFile;
  const inputs: FileInput[] = [];
  const projects: ProjectCandidate[] = [];
  let failed = 0;
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const path = prefix + entry.name;
      const pattern = isPatternFile(path);
      if (!pattern && !isProjectCandidate(path, sole)) return;
      try {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        );
        if (pattern) inputs.push({ path, bytes: await file.arrayBuffer() });
        else projects.push({ path, text: await file.text() });
      } catch {
        failed++;
      }
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        try {
          batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        } catch {
          failed++;
          break;
        }
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      } while (batch.length > 0);
    }
  };
  for (const entry of entries) await walk(entry, '');
  return { inputs, projects, failed };
}
