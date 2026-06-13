$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

Write-Host "Stopping Streamlit/Python on port 8501..."
Get-NetTCPConnection -LocalPort 8501 -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Write-Host "Removing __pycache__..."
Get-ChildItem -Path $projectRoot -Recurse -Directory -Filter "__pycache__" |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

$streamlitCache = Join-Path $env:USERPROFILE ".streamlit\cache"
if (Test-Path $streamlitCache) {
    Write-Host "Removing Streamlit cache: $streamlitCache"
    Remove-Item -Path $streamlitCache -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Cache cleared."
