import { bandDiff, type BandDiff } from '../core/analysis/bandCompare';
import { BAND_PARAMS, bandParamLabel, cellOf, simulatedOnly, type AnnexParamKey, type BandParam, type BandParamKey, type ExtraParamKey } from '../core/analysis/bandParams';
import type { AnalysisSettings } from '../core/analysis/metrics';
import { cellDisplay, filesText, sameSubBands, type BandRowsOf, type BandSheet } from './bandView';
import type { SubBand } from '../core/analysis/subBands';
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

/** B − A of each row of a sub-band: every row the sheets were made with. */
export type DiffRow = Record<AnnexParamKey, DiffPair> & Partial<Record<ExtraParamKey, DiffPair>>;

/** The difference pair of a row; the row must be one the sheets were made with. */
export function diffOf(row: DiffRow, key: BandParamKey): DiffPair {
  const pair = row[key];
  if (!pair) throw new Error(`Band comparison made without the row ${key}`);
  return pair;
}

/**
 * B − A per sub-band (the two sheets have the same sub-bands, see `compareSubBands`) and parameter. A row of the
 * simulated cut alone (the Horizon level) has only the simulated difference, which it shows as its one value.
 */
export function compareDiffs(a: BandSheet, b: BandSheet, rows: readonly BandParam[] = BAND_PARAMS): DiffRow[] {
  const names = { a: a.label, b: b.label };
  return a.columns.map((column, i) =>
    Object.fromEntries(
      rows.map((p) => {
        const original = bandDiff(cellOf(column, p.key), cellOf(b.columns[i], p.key), names);
        const tilted = a.tilted && b.tilted ? bandDiff(cellOf(a.tilted[i], p.key), cellOf(b.tilted[i], p.key), names) : undefined;
        if (tilted && simulatedOnly(p.key)) return [p.key, { original: tilted }];
        return [p.key, tilted ? { original, tilted } : { original }];
      }),
    ) as DiffRow,
  );
}

/** Shown under the table while some difference is partly of 22 dB substitutes. */
export const SUBSTITUTED_LEGEND = '† partly of "not available" values counted as 22 dB (BASTA 12.5.3)';

export function anySubstituted(diffs: readonly DiffRow[]): boolean {
  return diffs.some((c) => Object.values(c).some((d) => d !== undefined && (d.original.substituted || d.tilted?.substituted === true)));
}

/**
 * The sentence of the band note while two antennas are compared. With automatic sub-bands it says they are made over
 * both antennas, and, when that split (`used`) is not A's own (`ownA`), names A's own.
 */
export function compareNote(aLabel: string, bLabel: string, automatic: boolean, ownA?: readonly SubBand[], used?: readonly SubBand[]): string {
  const head = `Comparing A = ${aLabel} with B = ${bLabel}: B − A per sub-band, a signed difference (no better or worse).`;
  if (!automatic) return head;
  const notOwn = ownA && used && !sameSubBands(ownA, used) ? `; they are not A's own (${ownA.map((b) => b.name).join(', ')})` : '';
  return `${head} Automatic sub-bands are made over the files of both antennas${notOwn}.`;
}

/**
 * The comparison as shown, for a spreadsheet: a header line (Parameter, then for each sub-band "A: …", "B: …" and
 * "B − A") and a line per parameter with the cell texts. The first header cell says which cut the tilted values are of,
 * as `bandTsv` does. Tab-separated.
 */
export function compareTsv(a: BandSheet, b: BandSheet, settings: AnalysisSettings, horizonCut = false, tiltActive = true, { rows = BAND_PARAMS, method }: BandRowsOf = {}): string {
  const tilted = Boolean(a.tilted && b.tilted);
  const diffs = compareDiffs(a, b, rows);
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
  const lines = rows.map((p) => [
    tabSafe(bandParamLabel(p, settings, method)),
    ...a.columns.flatMap((c, i) => [
      tabSafe(cellDisplay(cellOf(c, p.key), a.tilted ? cellOf(a.tilted[i], p.key) : undefined).text),
      tabSafe(cellDisplay(cellOf(b.columns[i], p.key), b.tilted ? cellOf(b.tilted[i], p.key) : undefined).text),
      // A difference mostly starts with + or -: guarded, or a spreadsheet reads "+5.0° (tol 0.0°)" as a broken formula.
      tsvText(diffDisplay(diffOf(diffs[i], p.key).original, diffOf(diffs[i], p.key).tilted).text),
    ]),
  ]);
  return [header, ...lines].map((l) => l.join('\t')).join('\r\n') + '\r\n';
}
