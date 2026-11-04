# Per-user alternative when Windows denies Task Scheduler registration.
# Starts at logon and supervises the existing collector without duplicating it.
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
$collectorScript = Join-Path $projectRoot "scripts\live_ntrip_collector.py"
$watchLog = Join-Path $projectRoot "collector-watch.log"
$watchMutex = New-Object System.Threading.Mutex($false, "Local\ZGIIS-NTRIP-Collector-Supervisor")
$ownsMutex = $false
try {
    try { $ownsMutex = $watchMutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { exit 0 }
    Set-Location $projectRoot
    while ($true) {
        try {
            $runningCollector = Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
                Where-Object { $_.CommandLine -match 'scripts[\\/]live_ntrip_collector.py' }
            if (-not $runningCollector) {
                Add-Content -LiteralPath $watchLog -Value "$(Get-Date -Format o) Starting collector"
                $collectorChild = Start-Process -FilePath $venvPython `
                    -ArgumentList "-u", "scripts/live_ntrip_collector.py" `
                    -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
                    -RedirectStandardOutput (Join-Path $projectRoot "collector-watch.out.log") `
                    -RedirectStandardError (Join-Path $projectRoot "collector-watch.err.log")
                $collectorChild.WaitForExit()
                Add-Content -LiteralPath $watchLog -Value "$(Get-Date -Format o) Collector exited; retrying in 30 seconds"
            }
        } catch {
            # Log the failure category only; child diagnostics have their own log.
            Add-Content -LiteralPath $watchLog -Value "$(Get-Date -Format o) Supervisor retry: $($_.Exception.GetType().Name)"
        }
        Start-Sleep -Seconds 30
    }
} finally {
    if ($ownsMutex) { $watchMutex.ReleaseMutex() }
    $watchMutex.Dispose()
}
