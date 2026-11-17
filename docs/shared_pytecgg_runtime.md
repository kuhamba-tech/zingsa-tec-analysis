# Shared Zimbabwe / SANSA live Gg

This supersedes the earlier SANSA-only deployment description. The user explicitly selected actual PyTECGg for both networks.

## Shared configuration

`zgiis/processing/pytecgg_live.py` contains the one package pipeline: PyTECGg 1.3.0, Polars 1.38.1, GPS code/phase/Melbourne–Wuebbena combinations, 350 km IPP shell, 20-degree mask, degree-3 polynomial, `batch_size_epochs=30`, 30-point arcs and 5/5/10 extraction thresholds. The old `sansa_pytecgg.py` module remains as compatibility imports only.

`zgiis/live/pytecgg_service.py` registers independent receiver buffers for Zimbabwe and SANSA, downloads one shared navigation file, and runs both networks with the same cycle cutoff and two-hour raw-observation lookback. Completed network cycles are published together. Receiver coordinates and estimated biases remain receiver-specific. A package result expires after ten minutes. Default finite stream visits are at least ten minutes for either network, so the previous Zimbabwe 60-second rotation no longer cuts visits short before sufficient arcs can accumulate. Explicit continuous sessions (`0`) are preserved. Account concurrency limits are unchanged.

Both backend-managed NTRIP ingestion and the standalone collector feed raw Zimbabwe observations into the shared service. SANSA uses the same registration and ingestion path. GOPI G still runs separately and its equations, biases and quality rules are unchanged.

Real MSM observations obtained by persistent-process station probes also enter the same Zimbabwe buffer; serverless probes do not start calibration workers. This cannot overcome caster account/connection rejections: a station still needs a usable stream and sufficient continuous arcs.

## Serving and display

The existing collector snapshot now includes `pytecgg_networks`, with separate Zimbabwe and SANSA dictionaries. Each receiver carries its package identity/version, input diagnostics, latest-epoch VTEC, separate zenith VEq, source receipt time, cycle cutoff and latest per-satellite package samples. Vercel reads the snapshot; no full calibration runs inside a serverless request. Snapshot expiration clears both networks together.

The map reads both Gg networks from this same snapshot and refreshes them together every 20 seconds while the relevant layer is visible. It uses one engine/version check and one ten-minute reading freshness rule for both. Cached snapshots older than three minutes cannot resurrect either network's Gg.

The live method-comparison endpoint now uses actual Zimbabwe package observations and the package's latest-epoch station result. Its previous custom fit, neighbour adjustment and GOPI difference clamp are no longer used to produce live Gg. A missing package result remains pending. Legacy approximation helpers remain for historical/other existing products; historical records are not recalibrated without their original raw inputs.

## Meaning of matching time

Both networks share processing settings, cycle cutoff, lookback, publication and display refresh. A receiver without observations at another receiver's exact epoch cannot be made simultaneous: its real timestamp remains visible and freshness-limited. The implementation does not copy bias values, force neighbouring TEC values to agree, or substitute GOPI values for missing Gg.

## Verification

The numeric adapter test compares independent direct notebook calls with the shared pipeline, then compares identical raw observations/geometry under Zimbabwe and SANSA receiver names. Additional tests cover shared navigation/cutoff, atomic cycle publication, expiration, session duration, frontend provenance/freshness and preserving a real package value even when it differs from GOPI by more than 15 TECU.

Validation: 71 affected backend tests passed, including temporary-file tests when run with the required filesystem permissions; 10 focused frontend tests and TypeScript checking passed. A controlled browser test showed Zimbabwe and SANSA package Gg labels from one snapshot and made zero requests to the old approximation endpoint. These checks establish implementation agreement on common inputs, not independent geophysical validation of live stations.
