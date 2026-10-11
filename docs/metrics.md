# Metric definitions

Every column of the metrics table, as the code computes it, with the NGMN BASTA V13 section it
corresponds to (section number only) or "tool-defined" when BASTA has no such parameter. Names are
the table labels. Column groups can be hidden above the table; the CSV always has every column.

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
| Tilt error | ° | Tilt minus the nominal tilt of the file, signed. BASTA's downtilt deviation is its absolute value. Not available when the nominal tilt is unknown. | 7.2.8.2 |

If the cut never drops by the level on one side, the beamwidth, squint and tilt are not available.
Changing the beamwidth level changes the H/V-HPBW, Squint and Tilt columns (they keep their
"HPBW" names); BASTA values need 3 dB. Peak az and Peak tilt can differ from Squint and Tilt on
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
| SPR | % | Power outside ±S° divided by power inside, times 100, from the linear power of the azimuth cut. Inside edge samples are half-weighted. Co-polar only. | 7.8.1.6 |
| AIR | dB | 10·log10(power inside / power outside). Co-polar only. "—" if nothing lies outside. | 7.8.1.6 |
| Roll-off | dB | Level below the peak at the sector edges; the worse of the two edges. | 7.8.1.4 |
| D/U 16QAM, 64QAM, 256QAM | ° | Width of the contiguous azimuth region around 0° where this pattern exceeds the strongest copy of itself rotated by 360°/N (N = "Sectors per site", default 3) by at least 15, 20, 25 dB. "—" when 0° itself is below the threshold; 360° if it never drops below it. | tool-defined |

## Declared Δ

Computed value minus the value declared in the file header: ΔH-HPBW (H-HPBW), ΔV-HPBW (V-HPBW)
and ΔF/B (F/B 180°). Not available when the header lacks the value, and not computed for tilted
files in a tilt simulation (the declared values describe the measured pattern). Hidden by default.
Not a BASTA parameter (tool-defined).

## Settings

| Setting | Default | Changes |
|---|---|---|
| Beamwidth level (dB) | 3 | Level of H/V-HPBW, Squint, Tilt, Tilt error and the Δ columns. Not the 10 dB or sidelobe columns. |
| F/B window ± (°) | 30 | Width of the F/B ±W° search. |
| USLS window (°) | 20 | R in the two windowed USLS columns. |
| First-lobe limit (× V-HPBW) | 1.78 | Distance within which a first sidelobe counts as distinct (1 to 10). |
| Sector edge (±°) | 60 | Sector size for P2P tracking, SPR, AIR, Roll-off, H-SLS. |
| Sectors per site | 3 | Neighbour spacing for D/U aperture. |

## Known limits and differences from BASTA

- **Co-polar cuts only.** F/B and AIR/SPR are not total-power values. Cross-polar discrimination,
  H/V tracking and 3D front-to-back and angular-region parameters are not available.
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
- **No band statistics.** BASTA's distribution-based specifications over a frequency band are not
  computed; every value belongs to one file.
- **Tilt simulation.** Metrics of a simulated tilt are estimates from a two-cut reconstruction
  (elevation shifted, azimuth cut adjusted from the 3D reconstruction). If the tilted azimuth cut
  misses the main beam, H-cut metrics are "—".
