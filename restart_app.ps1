# Gracefully restart ZGIIS Streamlit on port 8501.
param([int]$Port = 8501)

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

Write-Host "Restarting ZGIIS on port $Port..."
& (Join-Path $projectRoot "run_app.ps1") -Port $Port
