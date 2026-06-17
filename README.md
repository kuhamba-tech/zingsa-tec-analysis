# GNSS TEC Analyzer (Zimbabwe CORS / GOP workflow)

This Python app replaces MATLAB post-processing and follows the same operational flow used with GOP:

1. Process RINEX in GOP to create `.Cmn` files.
2. Load `.Cmn` files in this app.
3. Filter noisy observations with elevation mask `>= 25 deg`.
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

## Run

```bash
pip install -r requirements-streamlit.txt
streamlit run app.py
```

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

