param(
    [int]$Port = 8501,
    [switch]$SkipProcessStop
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

function Stop-StreamlitListener {
    param([int]$ListenPort = 8501)

    $projectPattern = [regex]::Escape($projectRoot)
    $portPattern = "--server\.port\s+$ListenPort(?:\s|$)"
    $allProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $streamlitProcesses = @(
        $allProcesses |
            Where-Object {
                $_.Name -match "^python(?:\.exe)?$" -and
                $_.CommandLine -match $projectPattern -and
                $_.CommandLine -match "streamlit\s+run\s+Home\.py" -and
                $_.CommandLine -match $portPattern
            } |
            Select-Object -ExpandProperty ProcessId -Unique
    )
    $childProcesses = @(
        $allProcesses |
            Where-Object { $_.ParentProcessId -in $streamlitProcesses } |
            Select-Object -ExpandProperty ProcessId -Unique
    )
    $listenerProcesses = @(
        Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue |
            Where-Object { $_.OwningProcess -gt 0 } |
            Select-Object -ExpandProperty OwningProcess -Unique
    )

    $processIds = @(
        $streamlitProcesses + $childProcesses + $listenerProcesses |
            Select-Object -Unique
    )
    if (-not $processIds -or $processIds.Count -eq 0) {
        Write-Host "No Streamlit listener on port $ListenPort."
        return
    }

    foreach ($procId in $processIds) {
        Write-Host "Stopping ZGIIS Streamlit process (PID $procId) on port $ListenPort..."
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

if (-not $SkipProcessStop) {
    Stop-StreamlitListener -ListenPort $Port
}

Write-Host "Removing __pycache__..."
$previousErrorPreference = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
Get-ChildItem -Path $projectRoot -Recurse -Directory -Filter "__pycache__" |
    Remove-Item -Recurse -Force
$ErrorActionPreference = $previousErrorPreference

$streamlitCache = Join-Path $env:USERPROFILE ".streamlit\cache"
if (Test-Path $streamlitCache) {
    Write-Host "Removing Streamlit cache: $streamlitCache"
    Remove-Item -Path $streamlitCache -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Cache cleared."
