# Lobe-Story

A browser-based viewer and analyser for antenna radiation patterns in Planet format
(`.msi`, `.pln`, `.txt`). Files are read in your browser and never uploaded.

## Features

- Polar and rectangular plots of the horizontal and vertical cuts, with overlays.
- Metrics per file: H/V HPBW, squint, tilt and tilt error, F/B (180° and ±30°), USLS,
  first null fill, port-to-port beam tracking, and differences from declared header values.
- Sector metrics: SPR/AIR over the sector edges, roll-off, port-to-port tracking over the sector
  (gain-aware), and the D/U aperture for 16/64/256QAM, with a Sector marker on the horizontal cut.
- −3 dB markers on the plots and an HPBW vs. frequency chart per group.
- 3D patterns reconstructed from the two cuts (summation or Gil et al. weighted), for up to six
  files side by side with linked cameras, or overlaid in one scene.
- Automatic grouping by polarization, tilt, port and array (editable; drag files between groups).
- CSV export of the metrics table and PNG export of any plot.

Metrics follow the usual base-station antenna (BASTA/NGMN) definitions; each cut is normalised to
its own peak before analysis.

## Projects

**Save project** writes the whole session (files, names, copies, groups, simulation, view and
settings) to one JSON file; you can leave the pattern data out to get a small layout-only file.
**Open project** replaces the current session. For a layout-only project the app asks for the
pattern files and matches them by saved path or, failing that, by unique file name. Project files
stay on your computer; nothing is uploaded.

## Planned

- **QA batch mode** (not started): pass/fail limits per file or antenna, defect
  classification, and a
  desired/undesired (D/U) ratio metric.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run e2e        # Playwright smoke test
npm run build
```

## Deployment

Pushing to `main` runs `.github/workflows/ci.yml`, which tests and deploys to GitHub Pages.
One-time setup on GitHub: **Settings → Pages → Source: GitHub Actions**.
