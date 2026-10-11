export interface FileInput {
  path: string;
  bytes: ArrayBuffer;
}

/** A `.json` file from a selection or drop: possibly a saved project (see ui/openSelection.ts). */
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

export function isProjectFile(path: string): boolean {
  return /\.json$/i.test(path);
}

export function isPatternFile(path: string): boolean {
  return /\.(msi|pln|txt)$/i.test(path);
}

export async function inputsFromFileList(list: FileList): Promise<ReadInputsResult> {
  const inputs: FileInput[] = [];
  const projects: ProjectCandidate[] = [];
  let failed = 0;
  for (const file of Array.from(list)) {
    const path = file.webkitRelativePath || file.name;
    try {
      if (isPatternFile(path)) inputs.push({ path, bytes: await file.arrayBuffer() });
      else if (isProjectFile(path)) projects.push({ path, text: await file.text() });
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
  const inputs: FileInput[] = [];
  const projects: ProjectCandidate[] = [];
  let failed = 0;
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const path = prefix + entry.name;
      const pattern = isPatternFile(path);
      if (!pattern && !isProjectFile(path)) return;
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
