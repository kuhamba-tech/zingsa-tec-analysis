param(
    [int]$Port = 8501
)

& (Join-Path $PSScriptRoot "run_app.ps1") -Port $Port
