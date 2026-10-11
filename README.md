# Lobe-Story

A browser-based viewer and analyser for antenna radiation patterns in Planet format
(`.msi`, `.pln`, `.txt`). Files are read in your browser and never uploaded.

## Features

- Polar and rectangular plots of the horizontal and vertical cuts, with overlays.
- Metrics per file, in column groups: beam (H/V HPBW, 10 dB beamwidths, squint, tilt, peak
  directions, tilt error), front/back (180° and ±30°), sidelobes (first upper/lower sidelobe, USLS
  peak-to-20° / horizon-to-20° / maximum, null fill, horizontal sidelobes in the sector), sector
  (below) and differences from declared header values.
- Sector metrics: SPR/AIR over the sector edges, roll-off, port-to-port tracking over the sector
  (gain-aware), and the D/U aperture for 16/64/256QAM, with a Sector marker on the horizontal cut.
- −3 dB markers on the plots and a frequency chart per group: HPBW by default, and a Metric menu
  plots any table column against frequency (the choice is remembered in the browser).
- 3D patterns reconstructed from the two cuts (summation or Gil et al. weighted): the side-by-side
  grid with linked cameras draws at most 6 files and the overlay in one scene at most 12. When more
  are ticked, a note under the plot says which are drawn (the highlighted file first, then the
  others in panel order); untick files or use "Only matches" to choose.
- File panel for hundreds of files: a filter box (name, group or MHz; every word must match) with
  Show all / Show none / Only matches / Add matches (each can be undone), collapsible groups that
  show "ticked / total", and a count of the files shown. Click a file to highlight it, click again
  or press Esc to clear. Hovering a file, or moving the keyboard focus to it, previews its trace in
  the cut plots (thick line, the others dimmed) without changing anything.
- Colours follow the file panel: one colour per file up to 10 visible files; above that one colour
  per group with a shade per file (a shade keeps its place when other files are unticked), and above
  10 groups a line pattern tells repeated hues apart.
- Automatic grouping by polarization, tilt, port and array (editable; drag files between groups).
- Column groups can be shown or hidden above the metrics table (saved with the project); the CSV
  always contains every column.
- Band statistics per NGMN BASTA V13 Annex C: mean ± tolerance, 84th / 16th percentile limits and
  gain statistics over every loaded file of an antenna in a frequency sub-band (automatic or
  user-defined sub-bands, saved with the project), with CSV export and a histogram of any cell.
- CSV export of the metrics table and PNG export of any plot (the cut plots export with a legend
  of every file and the highlighted file's values).
- **Load example** on the empty page loads a small synthetic dual-polarised panel generated in code (24 files,
  not a real antenna) so every feature can be tried; **Help** explains the main terms.

Metrics follow the NGMN BASTA V13 definitions where the two co-polar cuts allow; see
[Metric definitions](docs/metrics.md) for each definition and the known differences.

## Projects

**Save project** writes the whole session (files, names, copies, groups, simulation, view and
settings) to one JSON file; you can leave the pattern data out to get a small layout-only file.
**Open project** replaces the current session. For a layout-only project the app asks for the
pattern files and matches them by content, then by saved path or, failing that, by unique file
name. Opening a file whose name is already loaded skips it when the content is the same;
re-opening a changed file adds it as a numbered second entry (`name (2).msi`) instead of replacing
the first. In a folder or a multi-file selection only `*.lobestory.json` is taken for a project,
and the app asks before opening it. Project files stay on your computer; nothing is uploaded.

## Planned

- **QA batch mode** (not started): pass/fail limits per file or antenna, defect
  classification, and a
  desired/undesired (D/U) ratio metric.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run e2e        # Playwright end-to-end tests (Chromium, as in CI)
npm run build
```

To run the end-to-end tests in Firefox as well (not part of CI), install it once and select its project:

```bash
npx playwright install firefox
npx playwright test --project=firefox
```

## Deployment

Pushing to `main` runs `.github/workflows/ci.yml`, which tests and deploys to GitHub Pages.
One-time setup on GitHub: **Settings → Pages → Source: GitHub Actions**.
