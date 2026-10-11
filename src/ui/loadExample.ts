import { useStore } from '../state/store';
import { exampleFiles, exampleLoadedMessage, EXAMPLE_NOTE } from '../core/exampleSet';

/** Loads the built-in synthetic example through the normal path, so every feature works on it. */
export function loadExample(): void {
  const encoder = new TextEncoder();
  const inputs = exampleFiles().map((f) => {
    const bytes = encoder.encode(f.text);
    return { path: f.name, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
  });
  const store = useStore.getState();
  if (store.files.length > 0) {
    // Already loaded (the example is only offered on an empty page): the usual "nothing new" line, with the note.
    store.addFiles(inputs, { note: EXAMPLE_NOTE, noteIsInfo: true });
    return;
  }
  store.addFiles(inputs);
  // One line instead of "Loaded 24 files · Loaded the built-in example".
  const after = useStore.getState();
  if (after.files.length === inputs.length && after.files.every((f) => f.result.ok)) after.setLoadMessage(exampleLoadedMessage(inputs.length), 'info');
}

/** Whether "Load example" is offered: not while a layout-only project waits for its pattern files (the example would mix with them). */
export function canOfferExample(s: { pendingFiles: readonly unknown[] }): boolean {
  return s.pendingFiles.length === 0;
}
