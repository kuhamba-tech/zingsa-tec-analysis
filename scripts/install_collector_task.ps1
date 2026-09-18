# Run this once from an elevated PowerShell (Right-click PowerShell -> "Run as Administrator").
# Registers a Scheduled Task that keeps scripts/live_ntrip_collector.py running
# persistently, restarting it automatically if it ever exits/crashes, so the
# shared Neon DB keeps getting fresh live VTEC even when no dev session is
# running the FastAPI backend. Without this, the Vercel dashboard falls back
# to stale processed-archive data whenever nothing else is feeding the DB.
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$projectRoot\scripts\run_collector.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Days 0) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName "ZGIIS-NTRIP-Collector" `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Persistent NTRIP collector feeding the shared Neon DB with live VTEC so the Vercel dashboard always has fresh data (scripts/live_ntrip_collector.py)." `
    -Force

Write-Host "Task registered. Starting it now..."
Start-ScheduledTask -TaskName "ZGIIS-NTRIP-Collector"
Start-Sleep -Seconds 3
Get-ScheduledTaskInfo -TaskName "ZGIIS-NTRIP-Collector" | Format-List TaskName, LastRunTime, LastTaskResult, NextRunTime
Write-Host "Logs: $projectRoot\collector.log and $projectRoot\collector.err.log"
