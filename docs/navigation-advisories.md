# ZINGSA Space Weather News & GNSS Advisories

This implementation adds current, traceable assessments and a working-window interface. It does not claim a validated Zimbabwe GNSS forecast. Production calibration and forecast gates are disabled. Missing evidence yields **Insufficient data / Not verified**, even when TEC is low.

## Existing infrastructure assessment

The API already provides station histories, station metadata, global space-weather feeds, cached news, recipient registration, broadcast scheduling and social drafts. The frontend already has national status, experimental GNSS model panels, audience cards and sharing controls. These features are retained.

Input reads are coalesced, with at most one outstanding read per source and a two-second response budget. Slow sources yield loading/insufficient data rather than stalling the public endpoint. Late results retain their original timestamps and still need freshness checks.

The local history provider reuses the database-backed live station VTEC endpoint: one hour, five-minute bins, a two-minute shared cache. Its sample timestamp is the latest measurement in the bin. This is code-derived TEC with receiver-bias and spatial-coverage limitations, not independent positioning truth. An unavailable database does not generate substitute observations.

The RTK monitor measures stream latency and message rate. Neither verifies rover fix success or positioning accuracy. PRN and forecast modules include heuristic position-error, convergence and integrity estimates. These are excluded from the new advisory evidence pipeline. Existing experimental panels remain visible with a qualification; they are not inputs to the new news assessment.

## Components and data flow

* `zgiis/navigation/advisory_assessment.py`: pure evidence assessment, station matching, quality checks, independent sector grading, current versus forecast intervals.
* `zgiis/navigation/advisory_rules.json`: versioned quality controls and disabled calibration/model gates.
* `zgiis/navigation/advisory_messages.py`: deterministic plain-language drafts from the assessment; no LLM or invented measurements.
* `backend/routers/navigation_news.py`, schemas and news cache: same canonical assessment and messages for web and existing delivery integrations. Optional `city` and ISO `day` query parameters; `day` is a CAT calendar day.
* `frontend/components/gnssIntelligence/AdvisoryOverview.tsx`: operational overview, separate ionospheric and measured GNSS states, working-window table, expandable evidence.
* GNSS Intelligence page, API client and types: three primary audiences, secondary audiences expandable, two-minute refresh, location/day controls and existing sharing actions.
* CORS map: replaces unsupported low GNSS-risk wording with “Not verified”; TEC overlays and station markers remain.

The root assessment contains location, issue/observation/expiry/update times, VTEC, calibrated anomaly, station-mean TEC rate, ROT/ROTI/gradient, global context, coverage, risk, measured performance, sectors, sources, rule version and working windows. Each draft includes an `advisory` object identifying its assessment, sector, potential impacts, recommended action and working-window statement.

`GET /navigation-news?city=HARARE&day=2026-11-01` returns the assessment and six audience drafts. `audience=surveyor` filters drafts without dropping the root assessment. Existing single-brief and delivery endpoints use the same builder. No additional paid service, database migration or generative provider is required. Existing broadcast cadence is retained; on-demand assessments refresh more frequently. This change does not enable delivery credentials, send posts or deploy.

## Scientific methodology and quality safeguards

VTEC measures electrons along a vertical column (one TECU = 10^16 electrons/m²). Absolute TEC alone does not establish local GPS failure or centimetre-level RTK accuracy. Rapid variation, scintillation, satellite geometry, correction delivery and receiver behaviour also matter. NOAA describes the effects of ionospheric disturbances on GPS [here](https://www.spaceweather.gov/impacts/space-weather-and-gps-systems). Aviation users must follow official advisories and approved procedures; see [FAA space weather guidance](https://www.faa.gov/nextgen/programs/weather/awrp/space-weather).

The assessment selects the nearest eligible fresh registry station to the named area's reference station. Distances are from that reference, not the user's field. The configurable 80 km eligibility cap is an engineering coverage guard, not a validated area of representativeness. Displayed coverage remains station-only; there is no spatial interpolation or national inference. A different city cannot borrow a distant Harare reading.

Defaults reject samples older than 15 minutes, more than 60 seconds into the future, nonfinite/nonpositive values, zero observations and conflicting values with identical station/timestamps. Station-mean change requires at least three bins within 30 minutes with gaps no larger than ten minutes. It is explicitly **not** same-satellite ROT or ROTI. A quiet-time anomaly requires an independently validated station/hour baseline with reference and validity dates. No production baseline is connected.

Signal metrics and performance adapters accept only observed, good-quality, timestamped, station-matched records with source and sample count. Signal metrics additionally require arc consistency. Model proxies are rejected. Surveyor verification additionally requires a check against known control. Global Kp/Dst/solar-wind values are labelled context; feed check time is not relabelled as an observation time.

Current ionospheric and sector policies require an explicit validation flag, calibration identifier, dataset reference, validation report, station scope, validity interval, minimum sample count and ordered caution/high thresholds. No production numerical risk thresholds are invented. Synthetic test thresholds exercise code paths only. A calibrated adverse ionospheric assessment gives caution without claiming observed GNSS failure. Measured sector degradation can give caution/high risk. Favourable requires both applicable favourable ionospheric evidence and verified sector performance. Otherwise the result is insufficient data. Confidence remains null until supported.

## Working windows and plain-language generation

The selected CAT day always has five rows: 06–09, 09–12, 12–15, 15–18 and 18–21. Past intervals without saved assessments say not assessed. The interval containing now shows the current assessment only, explicitly not a prediction for the rest of the interval. Future rows say pending unless a configured, approved model/validation ID matches a fresh location-specific forecast with exact interval bounds and explicit confidence. No forecast provider is connected. No best morning/afternoon window is fabricated from a single current TEC value.

The Everyone, Farmers and Surveyors cards answer what is measured, whether reliability is verified, what to check and whether a recommended window exists. Farmers are told to check guidance and pause auto-steer if positions jump or corrections fail. Surveyors are told to check control, fix and correction age. Everyday users are told to compare their position with road signs and stop safely before adjusting a route. Drafts preserve distinct “Data observed” and “Brief generated” times, next update and the official platform link. Copy for WhatsApp/Facebook, open WhatsApp and native sharing remain user initiated.

## Validation performed and remaining work

`tests/test_advisory_assessment.py` covers low VTEC without performance, high VTEC with stable measured performance, low VTEC with elevated ROTI, global storms, missing/stale CORS data, disabled forecasts, conflicting samples, different locations, sector-specific classifications, proxy rejection, known-control requirements, forecast identity/bounds and consistent draft provenance. Existing plain-news, regional-news, renderer and Facebook tests are also run; Facebook tests use mocks and do not post. TypeScript and browser/mobile checks are recorded in the implementation handoff.

Verification on 31 October 2026: 76 Python tests passed across those five test modules, including canonical API filtering and cache expiry. TypeScript `tsc --noEmit --incremental false` passed. `node scripts/verify_navigation_advisories.mjs` passed against the local API and browser: three primary cards, five intervals, station-backed response, location changes, future-date pending states, draft/WhatsApp-link equality, clipboard copy, refresh callback, no runtime exceptions and no horizontal page overflow at 1440/390/320 pixels. The API returned HTTP 200 with a timestamped Harare station reading and explicitly unverified GNSS performance. Browser tests did not send messages or invoke deployments.

For operational deployment, connect actual rover/receiver telemetry: timestamped RTK fixed/float ratio, correction age, cycle slips and lock loss, satellite/constellation identifiers, geometry, multipath indicators, convergence and errors against independent known control. Keep telemetry and code-TEC provenance separate. Validate local per-arc ROT/ROTI and spatial gradients, bias handling and quiet-time seasonal/hourly baselines. Extend coverage with documented uncertainty rather than extrapolating sparse stations.

Before enabling thresholds, collocate ionospheric and receiver records across seasons, solar activity, locations and sectors. Label actual work failures, use independent held-out station/time periods, measure false alarms and missed failures, document sample counts and confidence, and review sector tolerances with survey/agriculture operators. Record station scope, dates, validation report and calibration version in configuration. Monitor drift and expire outdated calibrations.

Before enabling future windows, train and independently validate a real short-horizon model against persistence and appropriate baselines. Report skill by lead time, location and activity, reliability/calibration of probabilities, uncertainty and missing-data behaviour. Require model approval/version, validation ID, fresh issuance and exact interval outputs. Add an authenticated model adapter, archived assessments, monitoring and rollback. The current table truthfully remains pending until that work is complete.


## National scope

The default page, API and sharing drafts cover Zimbabwe, with all monitored areas assessed separately. A city filter narrows the view only when explicitly selected. National drafts report monitored-area coverage and the range across distinct selected reporting stations, not a national TEC average or a Harare proxy. Missing areas remain unverified. A favourable result in one city cannot turn the national brief green. Each national draft links to all regional assessment identifiers and a distinct national identifier, with an observation-time range. No local working-window forecast is promoted to a countrywide recommendation.
