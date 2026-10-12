# Metric definitions

Every column of the metrics table, as the code computes it, with the NGMN BASTA V13 section it
corresponds to (section number only) or "tool-defined" when BASTA has no such parameter. Names are
the table labels. Column groups can be hidden above the table; the CSV always has every column, except the "Angular regions (est.)" group, which is exported only while it is shown. In both CSV files the text columns taken from user data (metrics CSV: File, Source file, Group; band CSV: Antenna, Sub-band) get a leading `'` when they start with `=`, `+`, `-`, `@`, a tab or a carriage return, so spreadsheets do not run them as a formula. The one exception is the app's own automatic group label such as `+45 · 2°T`, built only from a known polarization, a numeric tilt and a port or array code: it is written as it is. A renamed group, or a label with free text in a tag, is guarded; numbers, headers and the other columns are written as they are.

## Data and conventions

- One port and polarization, one frequency, one electrical tilt per file. Each file gives two
  co-polar cuts (azimuth, elevation), resampled to a 1° grid.
- Every cut is normalised to its own peak. Values are dB below that peak unless stated.
- Azimuth 0° is the mechanical boresight. Elevation 0° is the horizon and positive angles are
  below the horizon. The file is assumed to have no mechanical tilt.
- Level crossings are linearly interpolated between 1° samples.
- A cell shows "—" when the metric is not defined for that file; hover for the reason.

## Beam

| Label | Unit | Definition | BASTA |
|---|---|---|---|
| H-HPBW, V-HPBW | ° | Distance between the two points where the cut is "Beamwidth level" (default 3 dB) below the peak, nearest to the peak on each side. | 6.1.6, 7.2.5.1, 7.2.8.1 |
| H-BW 10 dB, V-BW 10 dB | ° | Same, at a fixed 10 dB. Independent of the beamwidth level setting. | 6.1.6 |
| Squint | ° | Azimuth of the midpoint of the H-HPBW points (at the beamwidth level), relative to 0°. | 7.8.1.5 |
| Peak az | ° | Azimuth of the strongest sample, refined with a three-point parabola through it and its neighbours. | 6.1.4 |
| Tilt | ° | Elevation of the midpoint of the V-HPBW points (the half-power beam axis), positive below the horizon. | 6.1.8 |
| Peak tilt | ° | Elevation of the strongest sample, refined as Peak az. | 6.1.4 |
| Tilt error | ° | Tilt minus the nominal tilt of the file, signed, on the half-power axis (the band statistics use the beam peak instead, see below). Not available when the nominal tilt is unknown. | 7.2.8.2 |

If the cut never drops by the level on one side, the beamwidth, squint and tilt are not available.
Changing the beamwidth level changes the H/V beamwidth, Squint and Tilt columns; the beamwidth
headers, CSV columns, tooltips and plot labels then read "BW@x dB" (x = the level) instead of
"HPBW". BASTA values need 3 dB. Peak az and Peak tilt can differ from Squint and Tilt on
asymmetric beams.

## Front/back

| Label | Unit | Definition | BASTA |
|---|---|---|---|
| F/B ±W° | dB | Highest azimuth level in 180° ± W° (W = "F/B window", default 30), as dB below the cut's peak. Co-polar only. | 7.2.9.1 |
| F/B 180° | dB | Level of the azimuth cut at exactly 180°. | tool-defined |

## Sidelobes

All elevation sidelobe columns use the elevation cut only. The rules follow BASTA 12.5, with two
stated deviations (minimum prominence, adjustable limit; see below).

**First lobe.** From the beam peak, walk away on one side (above the beam for upper, below for lower).
Start at the first sample at least 3 dB down. The first relative minimum from there is the null;
the next relative maximum is the first sidelobe. A null counts only if the lobe after it is at
least 0.5 dB higher; shallower wiggles are skipped as ripple. Distances are measured from the beam
peak direction (the middle of a flat top, otherwise the refined peak). The lobe must lie within
"First-lobe limit" × V-HPBW of the peak (default 1.78; V-HPBW here is always the 3 dB value).

**Merged lobe.** If no lobe is found within that limit, the first sidelobe is treated as merged with
the main beam and its level is taken at 1.55 × V-HPBW from the peak (interpolated). The cell
tooltip says "Merged with the main beam". If the limit exceeds 90°, the search stops at 90° when
the limit was raised above 1.78 and 1.55 × V-HPBW fits; otherwise the metric is not available
("V-HPBW is too wide").

**Sidelobe region and windows (12.5.3).** The sidelobe region starts at the first null (distinct
lobe) or at the merged-lobe position and runs away from the peak. A windowed value is the highest
level inside the window and the region. If the window holds only part of a lobe, that part counts;
if it holds only main beam, the value is "—" (not available).

| Label | Unit | Definition | BASTA |
|---|---|---|---|
| First USLS | dB | Level of the first upper sidelobe (upper side of the first-lobe rule). | 7.8.4.2 |
| USLS peak to 20° | dB | Highest upper sidelobe from the peak sample up to R° above it (R = "USLS window", default 20; the label follows R). | 7.8.4.3 |
| USLS horizon to 20° | dB | Highest upper sidelobe from the horizon up to R° above it. | 7.8.4.5 |
| USLS max | dB | Highest upper sidelobe from the peak sample up to the zenith. | 7.8.4.4 |
| Null fill | dB | Level of the first null below the main beam (lower side); for a merged lobe, the level at 1.55 × V-HPBW below the peak. | 7.8.3 |
| First LSLS | dB | Level of the first lower sidelobe, as First USLS on the lower side. | 7.2.11 (elevation-cut form) |
| H-SLS | dB | Highest azimuth level inside ±S° (S = "Sector edge") beyond the first null on either side of the azimuth main beam. "—" if there is none, the usual case for a sector panel. | 7.8.4.1 |

Null fill and First LSLS depend only on the lower side; the USLS columns only on the upper side.
Values are dB below the peak (larger is better).

## Sector

Sector edges are ±S° (default 60) around the mechanical boresight; the sector is not centred on
the beam peak.

| Label | Unit | Definition | BASTA |
|---|---|---|---|
| P2P tracking | dB | Largest difference over the whole sector, one value per degree, between this file and its opposite-polarization partner (±45, same tilt, array and frequency, adjacent odd/even ports, same group). Gain-aware when both gains are declared: \|(G1 − G2) − (att1 − att2)\|; otherwise shapes only. | 7.8.5 |
| SPR | % | Power outside ±S° divided by power inside, times 100, from the linear power of the azimuth cut. Inside edge samples are half-weighted. Co-polar only. By definition this is outside ÷ inside, not a share of the total, so it can exceed 100 % for wide or omnidirectional patterns (an omnidirectional pattern with a ±60° sector gives 200 %). | 7.8.1.6 |
| AIR | dB | 10·log10(power inside / power outside). Co-polar only. "—" if nothing lies outside. | 7.8.1.6 |
| Roll-off | dB | Level below the peak at the sector edges; the worse of the two edges. | 7.8.1.4 |
| D/U 16QAM, 64QAM, 256QAM | ° | Width of the contiguous azimuth region around 0° where this pattern exceeds the strongest copy of itself rotated by 360°/N (N = "Sectors per site", default 3) by at least 15, 20, 25 dB. "—" when 0° itself is below the threshold; 360° if it never drops below it. | tool-defined |

## Declared Δ

Computed value minus the value declared in the file header, headed "H-HPBW − decl.", "V-HPBW − decl."
and "F/B − decl." (computed F/B 180° minus declared); with Δ vs reference they read "Δ H-HPBW − decl.". Not available when the header lacks the value, and not computed for tilted
files in a tilt simulation (the declared values describe the measured pattern). Hidden by default.
Not a BASTA parameter (tool-defined).

## Angular regions (est.)

An optional column group, hidden by default. It follows the angular region efficiency of BASTA 7.2.4
for beam Type A (macro base-station beam) only; the other beam types are not offered.

**These values are estimates and are not BASTA-compliant.** The standard integrates the measured
radiation intensity (total power, both polarizations) over the full sphere. A Planet file has two
co-polar cuts, so the intensity between the cuts is reconstructed, and cross-polar power is missing.
Use the numbers to compare files with each other, not against a specification value.

**Regions (Table 7-1, Type A).** The standard gives them as a polar angle θ from the zenith; here they
are converted to this tool's elevation (0° = horizon, positive below, so elevation = θ − 90°) and azimuth
from boresight. P is the elevation of the beam peak (the Peak tilt column) and B the vertical 3 dB
beamwidth, both from the file's own elevation cut; S is the "Sector edge" setting (nominal sector
= 2·S, nominal direction = azimuth 0°).

| Region | Elevation | Azimuth | Table 7-1 |
|---|---|---|---|
| Upper | −90° (zenith) to min(0°, P − B) | all | θ < θ1 = min(90°, θpeak − HPBW) |
| Service | P − B/2 to 75° | within ±S | θ2 = θpeak − HPBW/2 to θ3 = 165°, φ1 to φ2 |
| Interference | min(0°, P − B) to 75°, without the service region | all | θ1 to θ3 outside the service region |
| Lower | 75° to 90° (straight down) | all | θ3 = 165° to θ4 = 180° |

The four regions cover the sphere once.

| Label | Unit | Definition | BASTA |
|---|---|---|---|
| Sector eff. est. | % | Power in the service region ÷ power over the whole sphere × 100. | 7.2.4 (estimate) |
| Spatial eff. est. | % | Power in the service region ÷ power in the service and interference regions × 100. | 7.2.4 (estimate) |
| Lower region est. | % | Power in the lower region ÷ power over the whole sphere × 100. Shown with three decimals (four in the CSV): it is typically a few thousandths of a percent to a few tenths. | 7.2.4 (estimate) |

**How the power is integrated.** The intensity in a direction is the tool's two-cut 3D reconstruction,
the same one the 3D view and the tilt simulation use, with the selected 3D method: the azimuth cut
at that azimuth combined with the front half of the elevation cut at that elevation (the back half of
the elevation cut is not used; the azimuth cut supplies the back). With "Summation" this is the
product of the two cuts in linear power; with "Weighted" it is the cross-weighted combination, which
puts more power away from the two cut planes and gives a lower sector efficiency (about 7 points
lower on the built-in example). The 3D method therefore changes these columns; it is chosen in the
Simulation bar, where the control is enabled while these columns are shown or plotted. The power is integrated in linear terms on the 1° grid,
taken as linear between samples, with the solid-angle weight cos(elevation). A region boundary at a
non-integer angle cuts the 1° cell where it falls; nothing is rounded to a whole degree.

**The lower region is the weakest of the three.** Straight down (and straight up) every azimuth is
the same direction, and the true level there is the elevation cut's alone. "Summation" still
multiplies it by the azimuth cut, so close to the poles it understates the power by up to the azimuth
average of the azimuth cut; "Weighted" tends to the elevation cut there and gives three to four times
more. "Lower region est." (and the part of the upper region near the zenith) is therefore biased low
with "Summation". Sector and spatial efficiency are hardly affected: the power near the poles is a
small part of the whole.

**No value.** "—" with the reason in the tooltip when the beam is outside the Type A ranges (vertical
HPBW 0.5° to 25°, horizontal HPBW 50° to 130°, both at 3 dB whatever the beamwidth level setting), when
a beamwidth is not defined, or when the elevation peak lies behind the antenna. Under a tilt
simulation the ranges are checked on the simulated cuts. The lower end of the vertical range is out of
reach in practice: on the 1° grid a beam narrower than about 1° is not resolved.

**Where it appears.** In the table and in Copy table while the group is shown; in the CSV only while
the group is shown; in the frequency chart's Metric menu always; in Δ vs reference and under a tilt
simulation (original → tilted) like every other column. It is not part of the band statistics. The
values are computed only while the group is shown or the frequency chart plots one of them.

**The 3D method is named with the number.** Because the method changes the values by several points,
it is written wherever they leave the table: the CSV and Copy table headers of the three columns read
"Sector eff. est. [Summation] (%)" or "… [Weighted] (%)" (square brackets, not a comma, so the plain
CSV header needs no quoting), and so do the frequency chart's axis title and the caption of its exported image. The
collapsed Simulation bar names the method while these columns are shown or plotted.

**Under a tilt simulation.** The regions always follow the tilted beam: P and B are the peak and the
3 dB beamwidth of the simulated elevation cut, as the table shows them. What is integrated depends on
the kind of tilt:

- *Electrical tilt only.* The pattern is still the reconstruction of its two cuts, so the two
  simulated cuts are integrated as for an untilted file. The values hardly move, because the regions
  move with the beam.
- *Mechanical tilt (alone or with an electrical tilt).* The whole pattern is rotated, and a rotated
  pattern is not the reconstruction of its own two cuts: towards the sector edges the beam is tilted
  less than on boresight, and behind the antenna it points up. The tool therefore integrates the
  rotated 3D reconstruction itself, the same model as the tilted 3D view and the simulated cuts (the
  file's azimuth cut and its electrically tilted elevation cut, read in the antenna's frame), sampled
  in every direction of the 1° grid. A mechanical down-tilt lowers the sector and spatial efficiency,
  because part of the beam near the sector edges ends up above the service region; an up-tilt raises
  them. On the built-in example (first file, Summation): 85.6 % untilted, 83.3 % at +4°, 78.7 % at
  +10°, 88.1 % at −6°. Between the 1° samples the rotated pattern is read linearly in dB, as the tilt
  simulation does everywhere; that convention alone can move a value by about 0.2 points against a
  finer integration.

## Difference from a reference

With a reference file chosen (⋯ menu of a file, **Use as reference**) and **Δ vs reference** on, every
other row shows each column and the gain as this file's value minus the reference's, signed, in the
column's unit; the reference row stays first with its own values. Under a tilt simulation the
tilted value is used where a cell has one (the original → tilted pair becomes one difference). A
difference is "—" when either file has no value for that column. The CSV and **Copy table** carry
the same cells, headers "… Δ vs <reference>" and a Row column (`reference` / `difference`); **Copy
row** copies the row without that column. The frequency chart's Metric menu plots any of the
columns above against frequency, the reference file's point marked with a diamond.

## Band statistics

The "Band statistics" section below the metrics table computes the distribution-based
specification values of NGMN BASTA V13 Annex C ("65.1° ± 4.0°", "< 2.7 dB", "> 15.8 dB",
"17.5 dBi ± 0.3 dB"): one row per parameter, one column per sub-band. The statistics reproduce the
standard's four worked examples (65.1 ± 4.0, 2.7, 15.8 and 17.5 ± 0.35).

Every cell is a button (Tab to it, then Enter or Space, or click). It shows the cell's detail text
under the table, also for "—", "n/a" and the tilt range, and, where the cell has samples, a
histogram of them with the statistic drawn as vertical lines. With fewer than 10 files in the
largest antenna the section shows only a hint with the largest set loaded instead of the table.
**Export band CSV** writes every antenna, sub-band and parameter in long form, one line per
antenna × sub-band × parameter (doubled with a State column, original and tilted, under a tilt
simulation). Its columns are Antenna, Sub-band, Min (MHz), Max (MHz), Parameter, Unit, Type
(double-sided, single-sided max, single-sided min, mean, absolute), N, Statistic (the cell text),
Value, Tolerance, Lower, Upper, Percentile, Min, Max, Mean, Counted as 22 dB and Adjusted. Value
is the mean for double-sided and mean rows and the limit for single-sided rows, which is the
adjusted limit where the 3 dB excursion rule changed it; Percentile is then the unadjusted
84th or 16th percentile, and Adjusted says "yes". The gain-at-tilt rows carry their tilt in the
Parameter, with one decimal as in the table.

**Dataset.** One statistic covers every loaded file, not copies, of one antenna whose frequency lies
in the sub-band: all nominal tilts, all ports and both polarizations are pooled. An antenna is the
set of files that share a custom group (if any) and an array tag. Files of different antennas, or of
different beamwidth-fan or pan settings, must be kept apart with custom groups or array tags.
Plot visibility does not matter. N, the number of samples, is shown in every cell that has samples (not when N is 0). Without a highlighted file or a chosen antenna the antenna with the most files is shown (ties: the first).

**Sub-bands.** With none defined, each cluster of frequencies whose neighbours are at most 100 MHz
apart is one sub-band. A user-defined list (name, min, max; inclusive with ±0.5 MHz, overlap allowed,
at most 12) replaces the automatic one and is saved with the project; the editor offers common
ranges as presets and "Start from automatic" copies the automatic sub-bands of the selected antenna only. A frequency above 100000 MHz is not accepted. BASTA's own sub-band tables are examples and are not enforced, and the tool does
not check that all frequency samples required by Annex B are present.

**Recipe.**
- Percentile p: index x = 1 + (N − 1)·p/100 into the ascending values, linearly interpolated, x not rounded.
- Double-sided: mean, 6.7th and 93.3rd percentile; tolerance = mean of the two distances to the mean. Means of dB quantities (gain, roll-off, AIR) are taken over linear power and converted back; degrees use the arithmetic mean.
- Single-sided maximum ("<") = 84th percentile; minimum (">") = 16th percentile.
- 3 dB excursion rule (12.2), dB rows with the "Exc" mark below: a minimum is lowered to the lowest value + 3 dB if that value is more than 3 dB under the percentile; a maximum is raised to the highest value − 3 dB the same way. The cell then ends in `*`, and the tooltip and the CSV "Adjusted" column say so.
- Fewer than 10 samples: no statistic, the range of the values is shown instead (muted). Gain at one tilt needs only one file.

| Label | Type | Samples | BASTA |
|---|---|---|---|
| Gain, all tilts | double-sided, power mean | 1 per file | 7.2.10, 12.6.2 |
| Gain, lowest / middle / highest tilt | mean, power mean | files at that nominal tilt | 12.6.1 |
| Electrical tilt range | absolute (nominal range) | distinct nominal tilts | 7.2.7 |
| Azimuth beamwidth, Elevation beamwidth, Azimuth beam squint | double-sided | 1 per file | 7.2.5.1, 7.2.8.1, 7.8.1.5 |
| Downtilt deviation | single-sided max | 1 per file | 7.2.8.2, 12.7 |
| F/B ±W°, First USLS, First LSLS, H-SLS | single-sided min, Exc | 1 per file | 7.2.9.1, 7.8.4.2, 7.2.11, 7.8.4.1 |
| USLS peak / horizon to R°, USLS max | single-sided min, Exc, 22 dB rule | 1 per file | 7.8.4.3, 7.8.4.5, 7.8.4.4 |
| Null fill | single-sided max, no Exc | 1 per file | 7.8.3 |
| P2P tracking (sector edges) | single-sided max, Exc | 2 per ± pair | 7.8.5, 12.4.5 |
| Roll-off (both edges) | double-sided, power mean | 2 per file | 7.8.1.4 |
| AIR | double-sided, power mean | 1 per file | 7.8.1.6 |

**Special rules.**
- "Not available" sidelobe windows (no sidelobe in the window, per file "—") count as 22 dB when at most half of the samples are not available (12.5.3); otherwise the cell is "n/a". Other missing values (undefined beamwidth, no gain) are left out and counted as "without a value" in the tooltip.
- USLS max uses the 22 dB rule too, by extension of 12.5.3.
- Gain is the declared header gain in the selected unit; the 0.8 dB repeatability margin appears in the tooltip only. The middle tilt is the nominal tilt nearest the midpoint of the lowest and highest.
- Downtilt deviation is |beam peak elevation − nominal tilt| (7.2.8.2, 12.7), not the half-power axis of the per-file Tilt error column; it differs by a few tenths of a degree on asymmetric beams. Under a tilt simulation "Electrical tilt range" and the "@ t°" of the gain rows use the files' tilt tags, while "Downtilt deviation" uses the tag plus the simulated offset.
- Null fill is a pure 84th percentile without the excursion rule: on 1° data the deepest single null decides the value in most cells, which says nothing about the antenna.
- Roll-off uses both sector edges of every file as separate samples. P2P tracking uses the two sector-edge differences of each ± pair (a pair counts once, only when both files are in the dataset and name each other); the per-file column shows the maximum over the sector instead, so the statistic can be lower than the worst cell there.

**Limits.**
- Co-polar cuts only: F/B and AIR are not total-power values; no cross-polar or 3D parameters.
- 1° data; BASTA asks for 0.5° when the beamwidth is below 20°.
- Nominal tilts and array membership come from file names and headers and can be corrected with the tag editor.
- With a tilt simulation a cell shows original → tilted where they differ; simulated values are estimates, not measurements.
- A beamwidth level other than 3 dB changes the beamwidth, squint and tilt rows (a warning is shown).
- A first-lobe limit other than the standard 1.78 × V-HPBW makes the sidelobe and null-fill rows non-standard (a warning is shown).
- A file whose declared gain lies outside −10 to 40 dBi (after the unit conversion), or whose FREQUENCY is missing or not above 0 MHz, still loads and gets a warning mark in the file panel. A file without a usable frequency is left out of the frequency chart and the band statistics (a note says how many).
- No pass/fail grading against limits.

## Settings

The panel shows each range; the same limits apply to projects and saved preferences.

| Setting | Default | Range | Changes |
|---|---|---|---|
| Beamwidth level (dB) | 3 | 0.5 to 20 | Level of H/V-HPBW, Squint, Tilt, Tilt error and the Δ columns. Not the 10 dB or sidelobe columns. |
| F/B window ± (°) | 30 | 1 to 180 | Width of the F/B ±W° search. |
| USLS window (°) | 20 | 1 to 90 | R in the two windowed USLS columns. |
| First-lobe limit (× V-HPBW) | 1.78 | 1 to 10 | Distance within which a first sidelobe counts as distinct. |
| Sector edge (±°) | 60 | 1 to 179 | Sector size for P2P tracking, SPR, AIR, Roll-off, H-SLS and the service region of the angular-region estimate. |
| Sectors per site | 3 | 2 to 12, whole | Neighbour spacing for D/U aperture. |

## Known limits and differences from BASTA

- **Co-polar cuts only.** F/B and AIR/SPR are not total-power values. Cross-polar discrimination,
  H/V tracking and 3D front-to-back are not available. The angular-region columns are an estimate
  from the two cuts (see "Angular regions (est.)"), not the measured full-sphere parameter.
- **1° sampling.** BASTA asks for 0.5° when the beamwidth is below 20°. Sidelobe and null values
  on narrow elevation beams are approximate, and the 1.78 / 1.55 factors were tuned at 0.5°.
- **First-lobe rule.** With the standard 1.78 × V-HPBW limit, beams with a suppressed upper
  sidelobe often have their first lobe beyond the limit. The reported value is then the level at
  1.55 × V-HPBW, which can be several dB more favourable than the real first lobe. Raise "First-lobe
  limit" in Settings to see the real lobe.
- **0.5 dB prominence.** A lobe shallower than 0.5 dB is skipped as ripple, and a dip shallower than
  3 dB inside the half-power beam is never a null. BASTA gives no smoothing rule.
- **Cuts used.** Azimuth parameters use the azimuth cut, sidelobe parameters the elevation cut only,
  with no search over other azimuths.
- **Electrical tilt** is the half-power axis (6.1.8). BASTA's worked example uses the beam peak;
  Peak tilt shows that. Tilt error is signed.
- **Per-file statistics.** Roll-off reports the worse edge and P2P tracking the maximum over the
  sector, where BASTA statistics use the edge values. AIR/SPR half-weight the two edge samples.
- **"Not available" cells.** A window with no sidelobe in it shows "—" for that file. BASTA
  substitutes 22 dB only in statistics over a set of measurements, so no substitute is applied per
  file.
- **Tilt simulation.** Metrics of a simulated tilt are estimates from a two-cut reconstruction.
  The elevation cut is shifted. The simulated horizontal cut is the cut through the tilted beam
  peak (the cone at the peak's elevation), reconstructed from the two cuts with the selected 3D
  method, and is never above the file's peak level. Electrical tilt leaves it unchanged;
  mechanical tilt distorts it, and by how much depends on the 3D method. On that cone the sides
  are about m (the mechanical tilt) away from the antenna's own peak cone and the back about 2·m,
  so under mechanical tilt the "Summation" method narrows the cut slightly and raises F/B, while
  "Weighted" widens it slightly and leaves F/B almost unchanged. The widening usually associated
  with mechanical tilt is seen on the horizon cut, which this plot does not show (the 3D view
  does). The back hemisphere is rebuilt from the front half of the vertical cut (the back half of
  the vertical cut is not used), so the simulated F/B is a rough estimate. Coverage at the
  horizon is visible in the 3D view.
