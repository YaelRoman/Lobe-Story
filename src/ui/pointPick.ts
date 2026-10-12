/**
 * The file a click on a chart point names: the first clicked point's `customdata` when it is a non-empty string
 * (the frequency chart puts each point's file id there), else null (a click on a line, a gap or an original's trace).
 */
export function pickedFileId(event: { points?: { customdata?: unknown }[] } | undefined): string | null {
  const id = event?.points?.[0]?.customdata;
  return typeof id === 'string' && id !== '' ? id : null;
}
