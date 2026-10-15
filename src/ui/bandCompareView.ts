import { bandDiff, type BandDiff } from '../core/analysis/bandCompare';
import { BAND_PARAMS, bandParamLabel, type BandParamKey } from '../core/analysis/bandParams';
import type { AnalysisSettings } from '../core/analysis/metrics';
import { cellDisplay, filesText, type BandSheet } from './bandView';
import { AT_HORIZON_TAG, tabSafe, TILT_WORDS, tsvText, type PairWords } from './table';

/** A difference cell: B − A of the original run, and of the tilted one under a simulation. */
export interface DiffPair {
  original: BandDiff;
  tilted?: BandDiff;
}

/** What a difference cell shows: `original → tilted` only where the two texts differ, as the band cells do. */
export function diffDisplay(original: BandDiff, tilted?: BandDiff, words: PairWords = TILT_WORDS): { text: string; title: string; muted: boolean } {
  const shown = tilted ?? original;
  if (!tilted || tilted.text === original.text) return { text: original.text, title: original.title, muted: shown.muted };
  return { text: `${original.text} → ${tilted.text}`, title: `${words.from}: ${original.title}\n${words.to}: ${tilted.title}`, muted: shown.muted };
}

/** B − A per sub-band (the two sheets have the same sub-bands, see `compareSubBands`) and parameter. */
export function compareDiffs(a: BandSheet, b: BandSheet): Record<BandParamKey, DiffPair>[] {
  const names = { a: a.label, b: b.label };
  return a.columns.map((column, i) =>
    Object.fromEntries(
      BAND_PARAMS.map((p) => {
        const original = bandDiff(column.cells[p.key], b.columns[i].cells[p.key], names);
        const tilted = a.tilted && b.tilted ? bandDiff(a.tilted[i].cells[p.key], b.tilted[i].cells[p.key], names) : undefined;
        return [p.key, tilted ? { original, tilted } : { original }];
      }),
    ) as Record<BandParamKey, DiffPair>,
  );
}

/** Shown under the table while some difference is partly of 22 dB substitutes. */
export const SUBSTITUTED_LEGEND = '† partly of "not available" values counted as 22 dB (BASTA 12.5.3)';

export function anySubstituted(diffs: readonly Record<BandParamKey, DiffPair>[]): boolean {
  return diffs.some((c) => Object.values(c).some((d) => d.original.substituted || d.tilted?.substituted === true));
}

/** The sentence of the band note while two antennas are compared. */
export const compareNote = (aLabel: string, bLabel: string, automatic: boolean): string =>
  `Comparing A = ${aLabel} with B = ${bLabel}: B − A per sub-band, a signed difference (no better or worse).` +
  (automatic ? ' Automatic sub-bands are made over the files of both antennas.' : '');

/**
 * The comparison as shown, for a spreadsheet: a header line (Parameter, then for each sub-band "A: …", "B: …" and
 * "B − A") and a line per parameter with the cell texts. The first header cell says which cut the tilted values are of,
 * as `bandTsv` does. Tab-separated.
 */
export function compareTsv(a: BandSheet, b: BandSheet, settings: AnalysisSettings, horizonCut = false, tiltActive = true): string {
  const tilted = Boolean(a.tilted && b.tilted);
  const diffs = compareDiffs(a, b);
  const first = tilted && horizonCut ? (tiltActive ? 'Parameter [tilted: H cut at the horizon]' : `Parameter ${AT_HORIZON_TAG}`) : 'Parameter';
  // The sub-band and antenna names are user text (formula-guarded at the start of the cell); the A and B cells are
  // computed and copied as the band table copies them.
  const header = [
    first,
    ...a.columns.flatMap((c, i) => [
      tsvText(`${c.subBand.name} A: ${a.label} (${filesText(c.files)})`),
      tsvText(`${c.subBand.name} B: ${b.label} (${filesText(b.columns[i].files)})`),
      tsvText(`${c.subBand.name} B − A`),
    ]),
  ];
  const lines = BAND_PARAMS.map((p) => [
    tabSafe(bandParamLabel(p, settings)),
    ...a.columns.flatMap((c, i) => [
      tabSafe(cellDisplay(c.cells[p.key], a.tilted?.[i].cells[p.key]).text),
      tabSafe(cellDisplay(b.columns[i].cells[p.key], b.tilted?.[i].cells[p.key]).text),
      // A difference mostly starts with + or -: guarded, or a spreadsheet reads "+5.0° (tol 0.0°)" as a broken formula.
      tsvText(diffDisplay(diffs[i][p.key].original, diffs[i][p.key].tilted).text),
    ]),
  ]);
  return [header, ...lines].map((l) => l.join('\t')).join('\r\n') + '\r\n';
}
