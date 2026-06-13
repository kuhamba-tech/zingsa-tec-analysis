param(
    [int]$Port = 8501,
    [switch]$SkipProcessStop
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

function Stop-StreamlitListener {
    param([int]$ListenPort = 8501)
    $listeners = @(
        Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue |
            Where-Object { $_.OwningProcess -gt 0 } |
            Select-Object -ExpandProperty OwningProcess -Unique
    )
    if (-not $listeners -or $listeners.Count -eq 0) {
        Write-Host "No Streamlit listener on port $ListenPort."
        return
    }
    foreach ($procId in $listeners) {
        Write-Host "Stopping Streamlit listener (PID $procId) on port $ListenPort..."
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

if (-not $SkipProcessStop) {
    Stop-StreamlitListener -ListenPort $Port
}

Write-Host "Removing __pycache__..."
Get-ChildItem -Path $projectRoot -Recurse -Directory -Filter "__pycache__" |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

$streamlitCache = Join-Path $env:USERPROFILE ".streamlit\cache"
if (Test-Path $streamlitCache) {
    Write-Host "Removing Streamlit cache: $streamlitCache"
    Remove-Item -Path $streamlitCache -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Cache cleared."
