# SANSA / GOPI method verification

Reviewed 17 November 2026. This is a source and implementation audit, not a validation of measured TEC accuracy. No runtime settings were changed.

## Sources

1. Matamba, T. M., and Danskin, D. W. (2022), *Development and Evaluation of Near-Real Time TEC and Ancillary Products for SANSA Space Weather*, Space Weather, 20, e2021SW003013. https://doi.org/10.1029/2021SW003013. Full publisher text reviewed, especially sections 2 and 4.
2. Gopi Seemala, *GPS_TEC Readme.pdf*, user-supplied nine-page document, copyright 2024; pages 1–3 and 5–8.
3. Jirapoom Budtho, *Hands-on Gopi GPS TEC software Dr Jirapoom.pdf*, user-supplied six-page tutorial; especially page 1.

Document instructions are reference material, not permission to install software, contact authors, or change operational settings.

## What the documents establish

The SANSA paper uses Ma–Maruyama receiver estimation, CODE satellite biases and semi-static receiver corrections. Its settings include 00:00–03:00 UT bias estimation, a 350 km shell, 20-degree cutoff, and a solar-cycle-dependent upper TEC filter. Maps use 15-minute inputs, five-minute refresh, one-degree nearest-neighbour gridding and a size-seven median filter. TDOU was unavailable in the version-2 evaluation. This is not evidence of equivalence to GPS_TEC.exe.

The GOPI readme describes receiver-bias calculation, use of satellite DCB inputs, a 350 km IPP altitude, and separate before/after-bias outputs. Its displayed example uses observations above 20 degrees; CMN output contains all elevations. The documented STD product is an iterated two-sigma mean across PRNs. It cautions that instrumental-bias estimates can fail. It is not sufficient documentation to certify a third-party implementation as numerically identical to GPS_TEC.exe.

The Jirapoom tutorial specifies observation and navigation files plus P1–C1 and P1–P2 satellite DCB files, and demonstrates CMN and image output. It is a usage guide, not a separate calibration algorithm or evidence that an uncorrected live code-TEC estimate is fully calibrated GOPI output.

## Implementation findings

| Component | Current implementation | Assessment |
|---|---|---|
| Live Zimbabwe and SANSA G | Both instantiate `LiveVtecPipeline` in `zgiis/live/stec_vtec.py` | Shared calculation path |
| Live instrumental corrections | Accumulator emits `bias_method = none_live_no_dcb` | Neither live G feed applies satellite or receiver DCB corrections |
| Live geometry | Shared 350 km shell and 30-degree mask | Matches between networks; mask differs from the paper |
| Live station G screening | Shared PRN consensus and existing 55 TECU ceiling | Software display policy, not full bias correction or exact paper replication |
| Offline RINEX GOPI-style path | `tec_core.py` levels phase/code arcs, applies available DCBs, estimates receiver bias and maps STEC to VTEC | More complete than the live code-only path; executable equivalence unverified |
| Missing offline DCBs | `tec_core.py` uses relative PRN/epoch leveling | Relative fallback must not be represented as independently verified absolute calibration |
| Daily receiver-bias archive | `receiver_bias_log.py` estimates per-station daily bias | Query spans the UTC day rather than restricting to the paper's quiet-time window |
| Archived product bias | `series_for_chart()` derives a bias from early completed days | A chart field; not evidence that live G actually applies it |
| Gg | Shared `gg_calibration.py` fitting engine | Separate method; does not supply the missing corrections to live G |
| Gg station labels | Zimbabwe adds PRN consensus and neighbour reconciliation; SANSA uses a calibrated-sample median | Shared engine does not imply identical final aggregation |

## Consequence and next implementation boundary

The current SANSA live feed matches the user's selected Zimbabwe live method, but neither should be described as fully bias-corrected GOPI or a reproduction of SANSA Tmv2. Identical formulas cannot establish that a cross-border difference is geophysical. Compare synchronized observations and satellites, inspect receiver metadata and correction provenance, and validate against an independent reference.

For a future calibrated product, retain raw G, apply appropriate satellite DCBs and independently established receiver corrections, record signal types and units, version receiver-specific bias configurations, and unify station aggregation. Validate using the same observations/navigation/DCB inputs processed by GPS_TEC.exe, including its exported bias file. Do not import historical receiver biases from the 2021 study into today's receivers without validation, or force adjacent stations to agree.

The existing user preference remains in effect: keep South Africa matched to Zimbabwe's current live method. This audit does not silently enable bias corrections or change elevation masks.
