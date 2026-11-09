# GIC Monitor: data audit, repairs and operational limits

Audit date: 9 November 2026 (Africa/Harare). Changes extend the existing `/gic-monitor/` page and FastAPI architecture. No new application was created and no field observations were fabricated.

## Confirmed evidence

| Check | Result |
| --- | --- |
| Configured PostgreSQL `gic_log` | Direct read-only query returned **0 records**, no station groups |
| Public API | `GET https://zingsa-gnss-tec.vercel.app/api/core-router?__zr=%2Fgic%2Fstatus` returned HTTP 200 and **0 records** at Dema and Alaska |
| Legacy `static/data/gic_log.sqlite` | Read-only inspection returned **0 records** |
| Existing page information | Dema/Alaska station registry, GMW CPCO clamp sensors, CR1000 loggers, Raspberry Pi 4 gateways and 4G/LTE communications are documented descriptions |
| Local ingestion logs available for review | No successful `POST /gic/ingest` or `/gic/upload` found before these changes |
| Field commissioning | No dated commissioning, calibration, polarity, cadence or engineering approval records found in the inspected page/source/database |
| Network map | Existing schematic retained; no authoritative dated coordinate/topology register attached to it |

The public API and configured database independently agree on zero records. A registered station or a sensor description is not proof that a logger is commissioned or communicating. The source inspection cannot determine the physical installation's actual state.

## Real acquisition path and repairs

Transformer-neutral sensor → commissioned sensor scaling/polarity → CR1000 table → LoggerNet/PakBus/serial export to an actual TOA5/CSV file → Pi uploader → LTE/HTTPS → authenticated existing GIC API → PostgreSQL `gic_log`.

The repository implements the **export-file-to-database** part of this path. It does not contain a verified CRBasic program, live PakBus connection or accessible field logger export. Software cannot commission the electrical installation.

The previous uploader selected `rows[-batch_size:]` and advanced a timestamp cursor. This could permanently skip the earlier backlog. The repair:

- Sends every batch oldest first.
- Checkpoints only after all batches receive a complete station acknowledgement.
- Retries changed or rotated exports in full; database uniqueness handles overlaps and late arrivals.
- Uses an atomic completed-file fingerprint scoped to station, file, destination and parsing metadata.
- Keeps the previous checkpoint on network failure.
- Supports continuous `--watch` polling with bounded retry backoff, or existing cron/one-shot use.
- Uses the actual Vercel group-router ingestion URL for `.vercel.app` destinations. `GIC_INGEST_URL` supports explicit custom routing.

The offline uploader remains available. Both paths retain original timestamps, signed current with original precision, source/TOA5 headers, raw file fields, supplied calibration reference, optional ground components and quality flags. UTC normalization requires an explicit logger timezone when the source timestamp lacks an offset. Unsupported units, non-finite currents and malformed rows reject the batch rather than silently dropping measurements. Sensor voltages are not relabelled as current.

The unique `(time, station_id)` key prevents duplicate measurements. A repeated timestamp with a different current is rejected; it does not overwrite the original observation. File-level parsing errors must be corrected against the original logger record; no interpolation fills missing rows.

### Field gateway setup

Use the existing project environment on each Pi. Configure actual values for `GIC_DATA_FILE`, `GIC_STATION_ID`, `GIC_GATEWAY_URL` (or `GIC_INGEST_URL`), `API_KEY`, `GIC_STATE_FILE`, and the documented `GIC_LOGGER_TIMEZONE` and `GIC_CALIBRATION_ID`. Do not assume that CR1000 local timestamps are UTC. `GIC_BATCH_SIZE` defaults to 120; `GIC_POLL_SECONDS` defaults to 30.

Run `python scripts/gic_gateway_upload.py --watch`, or install the supplied `scripts/gic-gateway@.service` after adjusting the project path and supplying the station's protected `/etc/zingsa/gic-<instance>.env` configuration. The service template was **not installed on a field gateway**, because no gateway or export location was available in this session.

## Dashboard and scientific separation

- Measured signed GIC remains empty when no field observations exist.
- The legacy GOES `K × dB/dt` interface is retained as an explicitly disabled research model. GOES measures the field in geostationary orbit, not the local ground field. The former fixed coefficient is not a validated Zimbabwe transformer-current model.
- Dema–Alaska comparison uses an exact UTC union without interpolation. It reports signed peak, peak magnitude, polarity counts, threshold intervals and valid observation completeness.
- Ground Bx/By/Bz panels accept supplied station observations with their source timestamps. Axis orientation still requires documented station metadata.
- Horizontal vector rate is `sqrt((dBx/dt)^2 + (dBy/dt)^2)` in nT/min. Scalar `dH/dt`, with `H=sqrt(Bx²+By²)`, is shown separately. Neither is the same as current rate `dGIC/dt` in A/min.
- IMF Bz and speed use active NOAA SWPC RTSW observations, timestamped at L1 with no propagation correction. Backup/inactive instruments are not mixed into the series.
- Kp comes from the existing `space_weather_log`; its archive timestamp need not equal the original upstream index issue time. This limits source-age interpretation.
- SYM-H uses genuine overlapping `kyoto_asysym` archive records. Dst is retained as a separate contextual product, never substituted for missing SYM-H.
- Source timestamps, age and fetch failures are explicit. No records are generated for unavailable sources.

On the initial local API verification, NOAA Bz, speed and archived Kp were available; ground magnetometry, measured GIC and overlapping SYM-H were unavailable.

## Thresholds, alerts and EKF

Default 5/10/25/35 A boundaries are provisional monitoring categories. No universal transformer-damage threshold or MVAr-per-ampere conversion is asserted. Magnitude, polarity, observed duration, quality and transformer identity are distinct fields.

Site configuration is persisted and audited. The configuration writer requires a separate server-only `GIC_ADMIN_KEY`, passed by the administrator in `X-GIC-Admin-Key`. There is no public dashboard-key fallback. If this credential is not configured, changes fail closed. Custom thresholds require a transformer identity, approving engineer, approval reference and non-future timezone-aware approval timestamp. Approval authenticity must be checked against ZETDC records; entered text alone is not independent engineering verification.

Observed-current flags are derived from actual stored valid observations and identify freshness, provisional status and duration limits. Historical EKF residual records remain available separately. New GIC prediction-residual alerts are suppressed both in the GIC API and unified EKF alert pipeline; old residuals do not enter the current alarm summary.

The retained shared filter has state `[signed current, trend]`, a sample-step damped-trend transition and a numerically clipped observation model `z=clip(current,-500,500)+noise`. The clip is not a sensor range. Current settings are `Q_current=0.3`, `Q_trend=0.05`, `R=1.5`, damping `0.85`; initial covariance follows the shared implementation. These are heuristic parameters, not coefficients trained on Dema or Alaska observations. Its confidence display is not a calibrated probability.

Research evaluation needs at least 30 valid regularly spaced samples and a configured cadence. It uses a chronological 70% warm-up/30% held-out split (at least 20 warm-up samples), predicts before assimilating each test observation, and compares MAE, RMSE and signed bias against persistence and the warm-up mean. Bias is predicted minus observed. Irregular cadence/gaps withhold metrics because the existing filter advances per sample rather than actual elapsed time. Independent storm-event periods, covariance calibration and engineering review remain necessary. **No field accuracy metrics or operational validation can be established from the currently empty archive.**

## Coverage, reports and archive research

Coverage is valid occupied expected-cadence slots divided by expected slots in the requested window. It is not inferred from the first-to-last timestamp span. Missing cadence produces unknown completeness/duration, not a fabricated percentage. Quality-flagged and future observations are excluded from scientific calculations.

Duration counts only valid adjoining samples no more than 1.5 configured sample intervals apart. Gaps and the final sample contribute no duration. No quiet-time or storm attribution follows from being below a current threshold.

Hourly through yearly reports use raw stored observations rather than averaged bins, preserving signed peaks. JSON, CSV and PDF include scientific limitations and coverage. CSV also preserves original timestamps, quality and metadata. PDF paragraph pagination is tested.

Daily, monthly, annual and local-hour research summaries operate on the field archive. A separate planetary-storm context uses backward Kp matching within three hours; coincidence does not prove current causation. Seasonal grouping accepts explicit month classifications covering all twelve months. The existing TEC implementation uses equinox/solstice groups; no approved meteorological definitions were found, so they were not invented. Seasonal labels do not imply weather causes GIC. These summaries are preparation for climatology, not an already established climatological reference.

## Database changes

- `gic_log`: additive `original_time`, `units`, `quality_flags`, `metadata`, `received_at` columns; existing measurements preserved.
- `gic_station_config`: site thresholds, cadence, commissioning/calibration/polarity and transformer metadata.
- `gic_config_audit`: append-only configuration snapshots.
- `gic_ingest_audit`: station receipt/source, received and inserted counts, observation bounds.
- Existing `space_weather_log`, `kyoto_asysym` and `ekf_alerts` are contextual/historical sources, not substitutes for `gic_log`.

`scripts/migrate_gic_operations.py` applies only additive GIC DDL with short lock/statement limits and verifies that measurement count is unchanged. It was applied to the configured PostgreSQL database, with count preserved at zero. Schema initialization includes this migration for future installs.

## Implementation files

- API/auth/transport: `backend/routers/gic.py`, `backend/main.py`, `frontend/app/api/zgiis/[...path]/route.ts`.
- Storage/migration: `zgiis/db/gic_db.py`, `zgiis/db/gic_operations.sql`, `scripts/migrate_gic_operations.py`, `scripts/init_supabase_schema.py`.
- Acquisition: `zgiis/gic/ingest.py`, `zgiis/gic/quality.py`, `scripts/gic_gateway_upload.py`, `scripts/gic-gateway@.service`.
- Science/reporting: `zgiis/gic/operations.py`, `context.py`, `analysis.py`, `climatology.py`, `live_model.py`, `network.py`; `zgiis/space_weather/ekf_alerts.py`, `ekf_service.py`.
- Existing frontend: `frontend/app/gic-monitor/page.tsx`, `components/gic/GicMonitorPanel.tsx`, `GicLiveDashboard.tsx`, `GicGuidePanel.tsx`, `GicNetworkMap.tsx`; new `GicSciencePanel.tsx` and its CSS module; `frontend/lib/gicOperations.ts`, `gicChartAnalysis.ts`, `gicNetworkStatic.ts`, `api.ts`, `types.ts`, `reportPdf.ts`.
- Verification: `tests/test_gic_operations.py`, `tests/test_gic_postgres.py`, existing GIC parser/pipeline tests; `scripts/verify_gic_exports.mjs`, `scripts/verify_gic_browser.mjs`.

## Verification and remaining requirements

The automated GIC regression suite passes. PostgreSQL integration tests use connection-local TEMP tables only and verify actual SQL transactions, deduplication, conflicting timestamps, original provenance, threshold persistence and the API ingest/upload → series → report/export path. No fixture is written to the permanent field archive. In-memory PDF tests cover both an empty report and a multi-page limitation narrative. TypeScript checks pass, and the existing local page and updated read APIs return HTTP 200. Headless Edge verification passes at 1440, 390 and 320 pixel widths, confirming empty field observations, commissioning limits and no runtime exceptions. An existing cached-weather hydration mismatch in the station dashboard was corrected by using a stable initial state.

Before field operation, verify the neutral sensor installation, sensor scale/offset and positive direction, CRBasic table/program, export mechanism, logger clock/NTP offset, Pi file/service configuration, LTE reachability, credentials, approved transformer metadata and site thresholds. Confirm a genuine observation against the logger and database, then verify sustained coverage. Authoritative ZETDC coordinate and electrical-network topology validation remains outstanding. No field service was enabled, no operational readiness was declared, and no production website deployment was performed by these changes.

Reference framework: [Campbell TOA5 format](https://help.campbellsci.com/loggernet-manual/ln_manual/campbell_scientific_file_formats/toa5.htm), [CR1000 manual](https://s.campbellsci.com/documents/us/manuals/cr1000.pdf), [NOAA GOES magnetometer](https://www.spaceweather.gov/products/goes-magnetometer). These explain formats and measurement context; they do not verify the Zimbabwe field installations.
