# Scientist-facing space-weather updates

Reviewed SolarHam's current-month news on 31 October 2026. The useful editorial pattern is dated updates connecting solar observations, eruptions, in-situ conditions and forecast changes. ZINGSA now uses that structure in **Live Space Weather → Solar Activity → Scientific space-weather updates**. SolarHam remains an explicitly independent further-reading link; its articles are not copied into the application or used as instrument data.

## Sources and generation

The briefing assembles the existing NOAA GOES 0.1–0.8 nm X-ray, real-time solar-wind plasma and magnetic-field measurements. Each panel identifies its source, sample time and units. It separates measurement text from scientific interpretation. Freshness is checked against the actual sample time, not merely a response's fetch time; missing, stale, future or nonfinite data do not become quiet conditions. An instantaneous GOES class is not a 24-hour flare maximum. The component updates its clock every minute and follows the existing solar-data updates.

The new read-only `/space-weather/scientific-updates` endpoint retrieves the [official NOAA SWPC forecast discussion](https://services.swpc.noaa.gov/text/discussion.txt). Its four topics—Solar Activity, Energetic Particle, Solar Wind and Geospace—preserve separate observed summaries and forecasts. The issue and retrieval times are separate. Responses are cached for three minutes; network requests have a six-second timeout. Failed refreshes retain previous text only with a stale warning. Issues older than 18 hours are labelled stale; future issue times and malformed responses are rejected. No language model manufactures a replacement forecast.

Recent catalogue flares and CMEs use the existing NOAA/NASA event feeds. The chronology sorts timestamped events newest first, excludes future observation entries and displays the catalogue date range. Missing catalogue entries are not interpreted as proof that no eruption occurred. Catalogue speeds and associations do not supply an Earth-arrival forecast. The NOAA discussion supplies explicit forecaster guidance, without transforming it into local RTK work windows.

## Scientific corrections

* Revised `scientistBulletin.ts` interpretations: G levels are not restricted to auroral latitudes; no fixed Bz value uniquely determines Kp/Dst; northward instantaneous Bz does not rule out ongoing effects; Dst is not a NOAA G scale; CME trajectory/arrival cannot be deduced from flare duration or limb position alone. GOES observes flare photons when their terrestrial radiative effects occur, without another eight-minute delay.
* Removed synthetic magnetic classifications and sunspot counts inferred from flare class. The table now identifies flare-associated sources, the largest catalogued flare and actual catalogue-entry counts; magnetic data remain unavailable pending an actual region-summary feed.
* Removed invented radio-burst types, frequencies and intensities derived from GOES flare class. The radio panel explains that measured radio data are not connected.
* Removed Earth-impact and halo claims inferred from CME cone half-angle or linked events. Cone half-angle, apparent halo and Earth-directed model guidance are distinct quantities.
* Kept Zimbabwe interpretation conditional on local coverage, a suitable TEC baseline, measured signal variability and actual receiver performance. Global forecasts do not certify local GNSS accuracy.

## Implementation and verification

Backend: `zgiis/space_weather/scientific_updates.py`, the space-weather API router and corrected solar catalogue helpers. Frontend: `ScientificSpaceWeatherUpdates.tsx` and its CSS module, pure `scientificUpdate.ts` helpers, revised scientist interpretation text, API/types and the Solar Activity tab. Existing charts, public navigation briefs and audience-sharing controls are preserved.

Tests cover discussion parsing, observation/forecast separation, issue versus retrieval time, stale/malformed/future bulletins, unavailable magnetic/radio measurements and non-inferred CME impact. The Node check `scripts/verify_scientific_updates.mjs` covers measurement freshness, missing/nonfinite/future observations, UTC normalization and event ordering. Browser checks exercise the scientist tab, source links and responsive widths without posting or deploying.

Verification on 31 October 2026: 26 targeted Python tests passed across the scientific-updates, solar NOAA fallback and space-weather API-resilience modules. TypeScript passed. The pure Node helper checks passed. The local API returned HTTP 200 with the NOAA issue time and all four topics. `scripts/verify_scientific_updates_browser.mjs` passed against the live API and browser, confirming separate sample/issue/retrieval times, observed/forecast headings, source links and no horizontal page overflow at 1440/390/320 pixels, with no runtime exceptions.

Scientific references: [NOAA forecast discussion purpose](https://www.spaceweather.gov/products/forecast-discussion), [NOAA scales](https://www.spaceweather.gov/noaa-scales-explanation), [solar flare effects](https://www.spaceweather.gov/phenomena/solar-flares-radio-blackouts), [CME observations and transit](https://www.spaceweather.gov/phenomena/coronal-mass-ejections). Editorial reference: [SolarHam monthly updates](https://solarham.com/news_current_month.htm).

Remaining limitations: active-region magnetic topology needs a real SRS/magnetogram source; radio phenomena need spectrograph/event reports; CME arrival uncertainty needs explicit model ensemble output; local TEC anomalies and GNSS attribution require validated baselines and independent receiver evidence. NOAA text may be unavailable or delayed, which is displayed explicitly. No deployment or social posting is performed.
