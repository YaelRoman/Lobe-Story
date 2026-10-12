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
- Angular regions (est.), an optional column group that is off by default: sector efficiency, spatial
  efficiency and lower region ratio after NGMN BASTA 7.2.4 for a macro beam (Type A). They are
  estimates from the two co-polar cuts, integrated over the 3D reconstruction, and are not
  BASTA-compliant: the standard needs the measured full sphere and total power. The numbers follow
  the selected 3D method, which is named in the exported headers. See
  [docs/metrics.md](docs/metrics.md).
- −3 dB markers on the plots and a frequency chart per group: HPBW by default, and a Metric menu
  plots any table column against frequency (the choice is remembered in the browser).
- 3D patterns reconstructed from the two cuts (summation or Gil et al. weighted): the side-by-side
  grid with linked cameras draws at most 6 files and the overlay in one scene at most 12. When more
  are ticked, a note under the plot says which are drawn (the highlighted file first, then the
  others in panel order); untick files or use "Only matches" to choose.
- Tilt simulation: electrical tilt, mechanical tilt and azimuth for all files, with offsets per file
  or group; the table shows original → tilted. Under a tilt the Simulation bar offers **Horizontal
  cut: Through the beam peak | At the horizon**: the cut through the tilted beam peak (the default,
  the cut a data sheet gives) or the cut at 0° elevation, where the widening under mechanical tilt
  and what is left at the horizon are seen. On the horizon cut beamwidths are measured on that cut
  and levels (F/B, H-SLS, roll-off, tracking) below the 3D peak; the plot title, the folded bar,
  image captions and export headers name the choice, and it is saved with the project. Simulated
  values are estimates from the two cuts; see [docs/metrics.md](docs/metrics.md).
- File panel for hundreds of files: a filter box (name, group or MHz; every word must match) with
  Show all / Show none / Only matches / Add matches (each can be undone), collapsible groups that
  show "ticked / total", and a count of the files shown. Click a file to highlight it, click again
  or press Esc to clear. Hovering a file with a mouse or pen, or moving the keyboard focus to it, previews its trace in
  the cut plots (thick line, the others dimmed) without changing anything.
- Colours follow the file panel: one colour per file up to 10 visible files; above that one colour
  per group with a shade per file (a shade keeps its place when other files are unticked, and a
  group keeps its hue when another group is unticked), and above 10 groups a line pattern tells
  repeated hues apart.
- Compare against a reference: the ⋯ menu of a file has **Use as reference**. The reference is
  marked with a pin, drawn in the 2D cut plots as a thick dashed line that is never dimmed (also
  when unticked, and alone when no other file is ticked) and marked in the frequency chart.
  **Δ vs reference** above the metrics table shows every metric and the gain as a signed difference from it; the reference row stays first with
  its own values. **Copy table** and the CSV follow what is shown, with a Row column (`reference` /
  `difference`) and "Δ vs <reference>" headers. The reference is saved with the project.
- A file with a declared gain outside −10 to 40 dBi, or a missing or non-positive frequency, still loads and gets a warning mark; one without a usable frequency is left out of the frequency chart and the band statistics, with a note.
- Automatic grouping by polarization, tilt, port and array (editable; drag files between groups).
- **Ticked files only** beside Δ vs reference limits the metrics table, Copy table and the CSV to the ticked
  files (the pinned reference row is always kept) and shows "n of m files"; like the theme it is remembered in
  the browser, not saved in a project.
- Column groups can be shown or hidden above the metrics table (saved with the project); the CSV
  contains every column whether shown or not, with one exception: the "Angular regions (est.)" group
  is exported only while it is shown (its values are not computed otherwise), and its CSV headers
  name the 3D method the estimate was computed with.
- Band statistics per NGMN BASTA V13 Annex C: mean ± tolerance, 84th / 16th percentile limits and
  gain statistics over every loaded file of an antenna in a frequency sub-band (automatic or
  user-defined sub-bands, saved with the project), with CSV export and a histogram of any cell.
- Copy to the clipboard for a spreadsheet: **Copy table** on the metrics table and on the band
  statistics (tab-separated, as shown), **Copy row** (the button by the file name, or Ctrl/Cmd+C on
  the name), and a single value (click a cell, then the Copy value button that appears in it; or
  Right arrow into the cells and Enter / Ctrl+C). A small toast in the corner of the status area says what was copied (it takes no room and is replaced by the next status line); a row copied
  in the Δ view is marked "(differences vs <reference>)" or "(reference)" there, not in the data.
- CSV export of the metrics table and PNG export of any plot. Images are always drawn in the light colours on
  white, whatever the screen theme, with a legend of every file, the highlighted file's values, a line saying
  what the markers that are on mean and, while a simulation is active, a line "Simulated: electrical Δ …,
  mechanical …, azimuth …" (with the 3D method and the horizontal cut while a tilt is active). File names say what they are: `horizontal-cut.png`, `vertical-cut.png`,
  `pattern-metrics.csv` and so on, with `-simulated` added while a simulation is active.
- Undo: Remove, Delete group, Clear, Show all / none and opening a project over a session can be taken back
  with the Undo button for a few seconds and then with Ctrl/Cmd+Z until the next change you make (one step; a
  later edit withdraws it). Ctrl/Cmd+Z with nothing to undo says so.
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

## Settings

The analysis settings (the Settings button) show their accepted range beside each field; an entry outside
it is not applied and says why. The plot floor is kept at least 1 dB beyond the beamwidth level: if
the level is raised past it, or a project is opened that has it that way, the floor is raised and
the status line says so.

## Planned

- **QA batch mode** (not started): pass/fail limits per file or antenna, defect
  classification, and a
  desired/undesired (D/U) ratio metric.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run e2e        # Playwright end-to-end tests (Chromium, as in CI; builds and serves the app on port 4173)
npm run build
```

The end-to-end config retries a failed test once (headless Chromium now and then drops a file chooser
or a software-WebGL session when the machine is busy), so a test that fails and then passes shows as
"flaky": look at it, but it does not fail the run. It runs four workers; more flake on software WebGL.

To run the end-to-end tests in Firefox as well (not part of CI), install it once and select its project:

```bash
npx playwright install firefox
npx playwright test --project=firefox
```

## Deployment

Pushing to `main` runs `.github/workflows/ci.yml`, which tests and deploys to GitHub Pages.
One-time setup on GitHub: **Settings → Pages → Source: GitHub Actions**.
