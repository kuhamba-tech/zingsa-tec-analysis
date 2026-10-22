$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location $projectDir
while ($true) {
    $worker = Start-Process -FilePath "$projectDir\.venv\Scripts\python.exe" -ArgumentList 'scripts/uptime_monitor.py' -WorkingDirectory $projectDir -RedirectStandardOutput "$projectDir\uptime-monitor.log" -RedirectStandardError "$projectDir\uptime-monitor.err.log" -WindowStyle Hidden -PassThru
    $worker.WaitForExit()
    Start-Sleep -Seconds 5
}
