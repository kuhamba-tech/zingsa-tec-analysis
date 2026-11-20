# Zimbabwe GNSS Ionospheric Information System (ZGIIS)

Source of truth: [`kuhamba-tech/zingsa-tec-analysis`](https://github.com/kuhamba-tech/zingsa-tec-analysis) (`master`).

ZGIIS consists of a Next.js frontend and a FastAPI backend. The legacy
Streamlit interface has been removed.

This Python app replaces MATLAB post-processing and follows the same operational flow used with GOP:

1. Process RINEX in GOP to create `.Cmn` files.
2. Load `.Cmn` files in this app.
3. Filter noisy observations with elevation mask `>= 30 deg`.
4. Extract and analyze `Time`, `Elevation`, `VTEC`.
5. Produce day, month, and year TEC summaries with storm visualization.
6. Optionally merge Kp index to study TEC-Kp relationship.

## Theory (Chapter 4 aligned)

From *Atmospheric Remote Sensing - Chapter 4* (Gopi K. Seemala):

- Slant TEC is computed from dual-frequency GNSS observables (L1/L2 or P1/P2 forms).
- Vertical conversion is done using a single-shell ionosphere model at IPP height (default 350 km).
- Mapping form used in code:
  - `M(E) = 1 / sqrt(1 - (Re*cos(E)/(Re+h))^2)`
  - `VTEC = STEC / M(E)`

Depending on notation, this is equivalent to `VTEC = STEC * S(E)` when `S(E)=1/M(E)`.

## Run locally

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The API is available at
`http://localhost:8000`, with interactive documentation at
`http://localhost:8000/docs`.

For the Zimbabwe North–South TEC research module (Live Space Weather → Zimbabwe tab):

```text
http://127.0.0.1:3001/space-weather/?tab=zimbabwe
```

API: `GET /live/north-south-tec-research?hours=24&resample_minutes=15`

On Windows, `run.ps1`/`dev.ps1` starts both services.

### Partner stations in the TrigNet tab

The TrigNet tab includes Senegal's `NKHR` at `crtk.net:2101` using the public
`centipede`/`centipede` login, and Ghana's `ACRG00GHA0` (Accra) at
`igs-ip.net:2101`. Ghana requires an IGS account: set `IGS_NTRIP_USERNAME` and
`IGS_NTRIP_PASSWORD` in `backend/.env`, then restart. An RTK2go email alone does
not grant IGS stream access. Each network uses its own stream connection and
the shared TEC/PyTECGg pipeline; pending readings are not filled with invented TEC.

The TrigNet and Geomagnetic views also list EarthScope stations BYAH and RUBO
(Rwanda, low magnetic latitude) and ACSB and AGMT (USA, magnetic mid-latitudes).
PCCL, FBAQ, IQQE and GTA1 in Chile provide geographic-latitude comparisons
with Zimbabwe; they are not matches for Zimbabwe's magnetic latitude.
ISCO (Costa Rica), CN46 (Grenada), CN64 (Venezuela) and CN47 (Saint Lucia)
cover the northern EIA crest region at approximately +15° to +17° magnetic latitude.
Set `EARTHSCOPE_NTRIP_USERNAME` and `EARTHSCOPE_NTRIP_PASSWORD` in `backend/.env`
to credentials issued by EarthScope for an active streaming licence, then
restart the backend. Connections use NTRIP V2 and TLS at
`ntrip.earthscope.org:3101`. A directory listing does not prove the local stream
is connected; TEC stays empty until suitable raw observations are available.

Additional EarthScope receivers cover the northern crest (PTPP and CN60,
Panama), southern crest (SRGD and CBAA, Chile), mid latitudes (CONS, Chile;
AB07, Alaska), and high latitudes (AB09 and AB11, Alaska). Groups use IGRF-14
dip latitude, not geographic latitude. The active RTCM 3.3 directory checked
on 2026-11-18 offered no additional receivers within 3 degrees of the dip
equator; the existing IGS equatorial receivers retain their separate access.
Catalog positions remain mapped when an older collector snapshot omits them;
this does not mark those receivers online or supply missing TEC.

Magnetic-equator comparison sites SGOC (Sri Lanka), POHN (Micronesia), POVE
and NAUS (Brazil), and ADIS (Ethiopia) use the IGS caster at `igs-ip.net:2101`.
They share the `IGS_NTRIP_USERNAME` and `IGS_NTRIP_PASSWORD` settings with Ghana.
EarthScope credentials are not used on the IGS caster.

## Supabase database

Supabase is the recommended hosted Postgres replacement for the live ZGIIS app.
Use it for CORS station status, TEC measurements, TEC map metadata, ionosonde
comparisons, alerts, users/permissions, reports, and receiver-bias history.

Set the hosted database URL in `.env` or your deployment environment:

```env
SUPABASE_DATABASE_URL=postgresql://postgres:[PASSWORD]@[SUPABASE_HOST]:5432/postgres
```

`SUPABASE_DATABASE_URL` is the only database setting. Long-running processes use
that session-pooler URL. Vercel functions use `SUPABASE_POOLER_URL`. The
self-hosted pooler has no TLS, so the app sets `sslmode=disable` unless the URL
already chooses a mode.

To bootstrap the tables:

```bash
python scripts/init_supabase_schema.py
```

If `SUPABASE_DATABASE_URL` is missing, database routes return HTTP 503.

The always-on `scripts/live_ntrip_collector.py` worker also collects live TEC
from South African TrigNet/SANSA sites and publishes a current station snapshot
to this database for the Vercel dashboard. Set the optional `TRIGNET_NTRIP_*`
settings in the collector's `backend/.env` to enable authenticated SANSA RTCM
streams; public TrigNet station/RINEX data remains available without those
credentials. Keep these separate from the Zimbabwe `NTRIP_*` credentials.

### One-click Windows launcher

Use PowerShell:

```powershell
cd "C:\Users\Tapiwa\Documents\Timothy\ZINGSA\Space Science\tec_python_app"
.\run_app.ps1
```

Optional custom port:

```powershell
.\run_app.ps1 -Port 8502
```

## Recommended input folder

Use your processed folder, for example:

`C:\Users\Tapiwa\Documents\Timothy\ZINGSA\Space Science\TEC ANAlYSIS`

The app recursively reads all `.Cmn` files.

## Outputs

Saved in `<data_folder>\tec_python_outputs`:

- `filtered_observations.csv` (time/elevation/vtec records after `>=25 deg` filter)
- `daily_summary.csv`
- `monthly_summary.csv`
- `yearly_summary.csv`

## KP CSV format (optional)

Provide a CSV with at least:

- `date` (or `day` / `timestamp`)
- `kp_index` (or `kp` / `kpindex`)
