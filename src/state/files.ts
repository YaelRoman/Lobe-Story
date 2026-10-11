export interface FileInput {
  path: string;
  bytes: ArrayBuffer;
}

/** Result of reading a selection or drop: the files that read OK, and how many did not. */
export interface ReadInputsResult {
  inputs: FileInput[];
  failed: number;
}

export function isPatternFile(path: string): boolean {
  return /\.(msi|pln|txt)$/i.test(path);
}

export async function inputsFromFileList(list: FileList): Promise<ReadInputsResult> {
  const inputs: FileInput[] = [];
  let failed = 0;
  for (const file of Array.from(list)) {
    const path = file.webkitRelativePath || file.name;
    if (!isPatternFile(path)) continue;
    try {
      inputs.push({ path, bytes: await file.arrayBuffer() });
    } catch {
      failed++;
    }
  }
  return { inputs, failed };
}

/** Reads dropped files and folders (recursively). Entries are captured synchronously, before any await. */
export async function inputsFromDataTransfer(dt: DataTransfer): Promise<ReadInputsResult> {
  const entries = Array.from(dt.items)
    .map((item) => item.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e !== null);
  const inputs: FileInput[] = [];
  let failed = 0;
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const path = prefix + entry.name;
      if (!isPatternFile(path)) return;
      try {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        );
        inputs.push({ path, bytes: await file.arrayBuffer() });
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
  return { inputs, failed };
}
