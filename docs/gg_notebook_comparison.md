# Gg verification: notebook, SANSA and Zimbabwe

Reviewed 17 November 2026. Audit only; no calibration or runtime settings changed.

## Reference and limits

Requested reference: https://colab.research.google.com/drive/1gW29JMXuS2z9OQejTjtwESC6IG6uq3m3

The Colab/Drive URLs could not be retrieved in this environment. The repository contains `docs/TEC_GNSS_Notebook_v5.ipynb`, explicitly cited by the implementation. Its markdown cells 12 and 15 and executable pipeline cell 20 were inspected. This local copy has not been verified as identical to the current linked notebook.

The user subsequently supplied the notebook text in `C:/Users/tkuhamba/.codex/attachments/91a6f9cf-6063-42c5-8197-1446f5635839/Pasted text.txt`. Its actual pipeline calls independently confirm the settings below: shell at line 899, elevation at line 928, arc thresholds at lines 937–940, calibration degree/batch at lines 957–958, and zenith-equivalent degree/batch at lines 970–971. The pasted install output records PyTECGg 1.3.0 in the author's environment; that is not evidence of the package/version installed in this project's runtime. Some pasted mathematical expressions are damaged by rendering/encoding, so they must not be transcribed as validated formulas.

No notebook cells were executed or packages installed. The notebook's classroom exercises and installation commands were treated as reference content, not as instructions to run a historical-data download or alter operational processing.

## Local notebook versus both live implementations

| Item | Local notebook | Shared live Gg engine |
|---|---|---|
| Actual engine | Calls PyTECGg `calculate_tec` | Custom NumPy least-squares implementation; checking whether PyTECGg is installed does not invoke it |
| Inputs | RINEX code, phase, navigation; geometry-free phase/code and Melbourne–Wuebbena combinations | Existing STEC/VTEC rows; SANSA live buffer explicitly selects code-live samples |
| Shell | 350 km | 350 km |
| Elevation | Executable cell uses 20 degrees | 30 degrees |
| Arc segmentation | `extract_arcs`, absolute/std thresholds 5, jump threshold 10, `min_arc_length=30` | PRN continuity with 600-second gap; minimum eight retained samples; no equivalent cycle-slip extraction |
| Polynomial degree | Executable cell allows degree 3 | Capped at degree 2 |
| Batching | Markdown describes 15-minute windows; executable calls use `batch_size_epochs=30` | At-least-15-minute windows starting at the first retained observation; epoch counts and fixed durations are not generally interchangeable |
| Coordinates | Computes IPP coordinates through the package | Current callers provide station coordinates, not IPP coordinates |
| MODIP | Notebook describes MODIP-based fitting through PyTECGg | Approximation `geographic latitude - 5 degrees`, without a magnetic-field calculation |
| Corrections | Package pipeline | Arc-bias clipping at 15 TECU, 85/15 sample/polynomial blend and plausibility filters |
| Station zenith output | Explicit `calculate_vertical_equivalent` producing `veq` | No equivalent polynomial-at-zenith product; labels aggregate per-satellite VTEC |

These differences prevent claiming numerical equivalence to the notebook. The notebook's illustrative figures also do not constitute calibration validation.

## SANSA versus Zimbabwe: differences after the shared engine

1. SANSA `_live_gg_vtec` in `zgiis/cors/trignet.py` selects the latest 15 minutes of its in-memory receiver buffer. `median_gg_vtec` takes the sample median of calibrated VTEC. A PRN emitting more samples can therefore contribute more weight.
2. Zimbabwe's map requests `getTecMethodComparison(2, undefined, 300, ...)`: a two-hour query with per-station sampling limits. `backend/routers/live.py` invokes the shared engine separately per receiver, then `_station_method_summary` uses PRN consensus for latest and representative levels.
3. Zimbabwe suppresses Gg/G pairs with a difference above 15 TECU, then `_reconcile_gg_with_neighbors` can replace or fill Gg using GOPI plus a neighbouring Gg-minus-GOPI offset. These are additional display transformations, not a result produced by the notebook's receiver calibration. SANSA does not use this same summary/reconciliation path.
4. SANSA Gg refreshes with its status response; Zimbabwe's map Gg has a separate polling interval and freshness check. Values displayed together need not represent identical samples or times.
5. The frontend currently validates SANSA Gg freshness using `vtec_time` rather than the separately provided `gg_time`, which can hide valid Gg when G is withheld.

Consequently, shared engine settings do not imply identical displayed Gg, and changing SANSA's median alone would not reproduce the notebook.

## Additional solver issue found by inspection

In `_solve_window`, the last arc has no bias column, equivalent to fixing its fitted offset to zero. After fitting, the function assigns that arc the negative sum of all other fitted offsets. The design matrix does not encode that sum-zero constraint. The returned last-arc correction therefore is not generally the offset represented during fitting. This affects both networks' shared engine and requires a separate regression-backed correction. A consistent reference-arc or sum-zero formulation must be chosen; clipping also needs to be considered when validating the constraint.

## Verification and next work

Existing SANSA calibration, station-consensus and neighbour-reconciliation tests: 22 passed; one RINEX test excluded because of the previously observed temporary-folder permission problem. These tests verify current software behaviour, not numerical agreement with PyTECGg or physical accuracy.

To verify scientific equivalence, preserve the supplied reference and pin the actual PyTECGg implementation/version, then process a common observation/navigation dataset. Compare per-satellite calibrated STEC/VTEC, arc identities and biases, and distinguish `veq` from aggregated VTEC. Preserve raw output and mark any neighbour-derived values explicitly. Fix the shared solver inconsistency and choose a common timestamp/PRN aggregation policy before interpreting BEIT–TDOU differences as spatial ionospheric structure.
