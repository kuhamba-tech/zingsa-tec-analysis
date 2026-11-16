# SANSA and Zimbabwe live TEC verification

Verified at: 2026-11-16T12:51:46.125867+00:00

The live GOPI path in both networks uses `LiveVtecPipeline` and `LiveVtecAccumulator`, GPS L1/L2 frequencies, `K * (P2 - P1) / 1e16`, a 350 km thin shell and a 30 degree elevation mask. Satellite ephemeris and receiver coordinates supply elevation. RTCM 1004 and MSM4/7 need different decoding, but equivalent observations must produce identical TEC.

## Difference found and corrected

SANSA previously used `latest_by_station(regional=True)` for mapped G, whereas Zimbabwe used the default station-consensus path. SANSA now uses the default path too. The raw regional summary is retained separately as `raw_code_vtec` and is never substituted for mapped G when the shared screening rejects it.

**The existing Zimbabwe display rules include a 55 TECU ceiling. Matching this ceiling is a consistency change, not a physical validation or bias correction. TEC above 55 is not inherently impossible.** Some SANSA G readings can therefore be withheld while raw estimates remain available for investigation.

## Live-observation arithmetic check

The following are individual observations received by the existing collector, not station-average values. The independent reference uses `tec_core._K` directly and divides the resulting STEC by the stored mapping factor. Rounding tolerance: 0.0002 TECU.

| Site | P2 - P1 (m) | Reference STEC (TECU) | Mapping factor | Reference VTEC (TECU) | Pipeline difference (TECU) |
|---|---:|---:|---:|---:|---:|
| TDOU | 10.400 | 99.002 | 1.440178 | 68.743 | 0.000032 |
| PTBG | 11.480 | 109.286 | 1.636287 | 66.789 | 0.000034 |
| PBWA | 11.240 | 107.001 | 1.680765 | 63.662 | 0.000038 |
| NYLS | 12.460 | 118.615 | 1.591838 | 74.514 | 0.000030 |
| NSPT | 14.920 | 142.033 | 1.642137 | 86.493 | 0.000043 |
| MFKG | 12.081 | 115.008 | 1.437928 | 79.982 | 0.000002 |
| HEID | 11.380 | 108.334 | 1.554236 | 69.702 | 0.000002 |
| KMAN | 11.840 | 112.713 | 1.430262 | 78.806 | 0.000036 |
| KSTD | 12.340 | 117.472 | 1.507108 | 77.946 | 0.000044 |
| UPTN | 11.220 | 106.810 | 1.374775 | 77.693 | 0.000028 |
| BFTA | 12.571 | 119.670 | 1.360823 | 87.939 | 0.000008 |
| PSKA | 10.000 | 95.196 | 1.384619 | 68.753 | 0.000013 |
| SBOK | 13.335 | 126.942 | 1.463019 | 86.767 | 0.000045 |
| SCOT | 10.200 | 97.100 | 1.542680 | 62.943 | 0.000035 |
| KOKS | 12.060 | 114.807 | 1.507488 | 76.158 | 0.000028 |
| DEAR | 12.809 | 121.935 | 1.357663 | 89.812 | 0.000035 |
| CALV | 10.180 | 96.910 | 1.311881 | 73.871 | 0.000032 |
| QTWN | 11.722 | 111.590 | 1.301909 | 85.713 | 0.000031 |
| GRNT | 11.180 | 106.430 | 1.384185 | 76.890 | 0.000045 |

Checked 19 stations; maximum numerical difference 0.000045 TECU.

## Interpretation and limits

Large raw SANSA estimates are already present in the received code-range differences; this check did not find a metre/TECU conversion mismatch. It does not prove that the estimates represent the true ionosphere. Receiver/satellite differential code biases, code type and multipath remain possible contributors. Both live GOPI paths currently report `none_live_no_dcb`; SANSA has not gained validated receiver/satellite bias calibration from this screening change.

The high raw values must not be taken as a confirmed geomagnetic storm or confirmed ionospheric enhancement. A same-time independent reference and signal-specific satellite plus receiver bias correction are needed to establish the absolute TEC scale. Cesaroni Gg calibration is a separate method and cannot be replaced with an arbitrary subtraction from G.

ESA describes the frequency- and code-dependent instrumental delays in [GNSS Basic Observables](https://gssc.esa.int/navipedia/index.php/GNSS_Basic_Observables) and [Instrumental Delay](https://gssc.esa.int/navipedia/index.php?title=Instrumental_Delay).

## Automated verification

- Equivalent synthetic RTCM 1004 and GPS MSM observations produce identical VTEC for SANSA and Zimbabwe station identifiers and match the GOPI core reference.
- Shared mapping and GPS semicircle-to-radian conversions have regression tests.
- A rejected high raw estimate remains in diagnostics and is not relabelled as quality-screened G.
- 36 targeted pipeline, station-status, aggregation and transport tests pass; frontend TypeScript checks pass.

## Re-verification of shared processing

Checked at: 2026-11-16T13:17:30.777206+00:00

Both live station identities were fed identical three-satellite observations through the complete pipeline and default station-summary rules. A 27/28/29 TECU input set produces the same 28 TECU station summary for Zimbabwe and SANSA. An 83/84/85 TECU input set is withheld for both networks by the existing display screening, while the underlying raw calculations remain unchanged.

The SANSA RINEX fallback now calls the same `tecg_from_pseudorange` and `vtec_from_stec` functions and shared elevation-mask constant as live processing, rather than keeping a separate copy of the equations. The RINEX regression checks both acceptance at the shared elevation mask and rejection below it.

All 38 targeted tests pass. These tests establish calculation and screening parity, not absolute ionospheric accuracy or completed receiver/satellite bias calibration.
