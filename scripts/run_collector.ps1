# Wrapper invoked by the "ZGIIS-NTRIP-Collector" Scheduled Task.
# Runs the persistent NTRIP collector (scripts/live_ntrip_collector.py) with
# output redirected to log files at the repo root, matching dev.ps1's pattern.
$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $projectRoot

$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
$collectorScript = Join-Path $projectRoot "scripts\live_ntrip_collector.py"
$log = Join-Path $projectRoot "collector.log"
$errLog = Join-Path $projectRoot "collector.err.log"

& $venvPython $collectorScript 1>> $log 2>> $errLog
