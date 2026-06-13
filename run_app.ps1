param(
    [int]$Port = 8501
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host "Creating virtual environment..."
    python -m venv .venv
}

Write-Host "Installing/updating requirements..."
& $venvPython -m pip install --upgrade pip -q
& $venvPython -m pip install -r requirements.txt -q

$env:STREAMLIT_BROWSER_GATHER_USAGE_STATS = "false"

Write-Host "Clearing Python/Streamlit cache..."
if (Test-Path (Join-Path $projectRoot "clear_cache.ps1")) {
    & (Join-Path $projectRoot "clear_cache.ps1")
}

Write-Host "Verifying map module import..."
& $venvPython -c "from zgiis.maps.station_map import render_cors_station_map; print('station_map OK')"

Write-Host "Verifying space weather scales import..."
& $venvPython -c "from zgiis.space_weather import render_horizontal_geomagnetic_scale, render_horizontal_kp_scale; print('kp_scale OK')"

Write-Host "Verifying tec_core import..."
& $venvPython -c "from tec_core import read_rinex_files; print('tec_core OK')"

Write-Host ""
Write-Host "============================================================"
Write-Host " ZGIIS - Zimbabwe GNSS Ionosphere Intelligence System"
Write-Host "============================================================"
Write-Host " URL: http://localhost:$Port"
Write-Host "============================================================"
Write-Host ""

& $venvPython -m streamlit run Home.py --server.headless true --server.port $Port
