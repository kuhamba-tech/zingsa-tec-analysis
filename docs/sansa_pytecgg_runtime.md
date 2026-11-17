# SANSA Gg: PyTECGg runtime

SANSA now uses the actual `pytecgg==1.3.0` calibration engine, with `polars==1.38.1`, matching the versions/settings supplied in the notebook. Collector dependencies are pinned in `requirements.txt` and `requirements-render.txt`; install the relevant requirements file when provisioning the collector. The serverless project reads collector snapshots and does not perform live calibration.

Reference confirmed: the subsequently supplied `C:/Users/tkuhamba/Downloads/TEC_GNSS_Notebook_v5 (1).ipynb` has 26 cells, and every code cell is text-identical to the existing `docs/TEC_GNSS_Notebook_v5.ipynb` used for the integration. Its saved output records PyTECGg 1.3.0 and Polars 1.38.1. The notebook's installation/download/exercise instructions are reference material, not additional actions requested by supplying the file.

## Processing

`zgiis/processing/sansa_pytecgg.py` calls the package functions for geometry-free phase/code and Melbourne–Wuebbena combinations, ephemeris preparation, satellite positions, IPPs, arc extraction, calibration and zenith-equivalent calculation. It uses GPS observations, a 350 km shell, a 20-degree mask, `min_arc_length=30`, thresholds 5/5/10, `max_polynomial_degree=3` and `batch_size_epochs=30`. The latter is the exact notebook argument: inspection of version 1.3.0 shows it is passed into the internal time-window argument in minutes despite its public name. It must not be treated as evidence that 30 epochs always equal 15 minutes.

The raw RTCM adapter preserves the GPS time-of-week and signal identities. GPS-calendar input epochs follow PyTECGg's RINEX parser schema (UTC-tagged GPS calendar values); source receipt UTC is kept separately for dashboard freshness. Existing GOPI timestamps and calculations are unchanged. Non-GPS observations and observations missing source time or signal identity are not fabricated or relabelled for PyTECGg.

Raw samples are bounded per receiver and processed by a dedicated worker. Package output is not passed through the legacy live approximation, sample/polynomial blending, neighbour adjustment, or GOPI pair-difference ceiling. `gg_vtec` is the median of package per-satellite VTEC at the latest valid epoch. `gg_veq` is the package's separate zenith-equivalent result. This distinction is retained in the API. Version, engine, status, sample count and observation receipt time accompany the result.

SANSA stream visits now last at least ten minutes, keeping the configured concurrency limit, because the former two-minute rotation can prevent 30-point arcs at slower caster cadences. Queued stations can consequently wait longer between visits. The API exposes buffered epoch counts and signal codes to distinguish missing raw inputs from an insufficient package fit.

No legacy approximate result is promoted to PyTECGg during startup, failure or missing data. If raw code/phase, navigation, sufficient arcs or a valid package solution are missing, Gg remains unavailable with a status. Results older than ten minutes are withheld. This can reduce displayed station counts relative to the old approximation.

The live receiver position currently comes from the station catalog, with zero assumed height, as in the existing live geometry setup. Exact receiver ECEF coordinates from an observation header should be supplied for research validation. Agreement with the package on common inputs does not establish physical accuracy of those inputs or guarantee that short stream rotations provide enough geometry for a reliable bias estimate.

## Verification

`tests/test_sansa_pytecgg.py` compares the adapter's actual calibrated bias/STEC/VTEC/VEq output with the notebook's direct package-call sequence on the same synthetic code/phase observations and controlled satellite geometry. This isolates adapter agreement; it does not independently validate real ephemerides or receiver hardware. Additional tests cover source epochs/signal identities, raw-buffer isolation, freshness, and the distinction between VTEC and VEq.

Local validation: PyTECGg 1.3.0 and Polars 1.38.1 installed; package dependency check passed; the numerical agreement test passed; 45 selected backend tests and six frontend reading tests passed; TypeScript checking passed. One pre-existing RINEX temporary-directory test was excluded because of the environment's folder permissions. The local backend was restarted and returned HTTP 200 after activation. Fresh live calibration output still depends on receiving sufficient usable phase arcs and navigation.

Full RINEX comparison is available via `calibrate_rinex(obs_path, nav_path, station)`. Use the same observation/navigation data and receiver coordinates as the reference notebook. Python package versions alone do not make independently chosen sample windows or constellations comparable.

Zimbabwe's Gg approximation and both networks' GOPI paths remain unchanged. Earlier comparison audits describe the pre-integration SANSA approximation and are historical evidence, not the current engine selection.

## Faster station loading and legacy input correction

The map preloads TrigNet after mounting, shares pending requests, and reuses a short-lived/session cache across views. Cached locations may remain visible while refreshing, but collector age advances locally: online flags expire after 90 seconds and TEC fields after 180 seconds, matching snapshot rules. This does not relax TEC quality screening or imply that a connected station has valid TEC.

The RTCM 1004 L2 code mapping was corrected to `0=2X, 1=2P, 2=2D, 3=2W`, following RTKLIB's `L2codes` in https://github.com/tomojitakasu/RTKLIB/blob/master/src/rtcm3.c. The initial adapter omitted indicator 3 and misidentified indicators 0 and 2. This affected PyTECGg raw input, not the GOPI equations. Tests now check that all four indicators reach the calibration buffer. Receivers previously appearing L1-only may have been affected by this adapter bug; that observation did not establish that their caster lacked L2.
