param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 3000
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

function Stop-Port($port) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        Write-Host "Killing stale process on port $port (PID $($c.OwningProcess))..."
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

function Stop-BackendProcesses {
    # uvicorn --reload spawns its actual worker via Python's multiprocessing module.
    # That worker's command line is "...spawn_main(parent_pid=<reloader>...)" -- it does
    # NOT contain "uvicorn", so Stop-Port alone misses it. Killing only the reloader leaves
    # this worker (and its listening socket) running as an orphan indefinitely, silently
    # serving stale code on every future "restart" even though dev.ps1 thinks it killed it.
    $reloaders = Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object {
        $_.CommandLine -match 'uvicorn' -and $_.CommandLine -match 'backend\.main'
    }
    foreach ($r in $reloaders) {
        Write-Host "Killing backend reloader (PID $($r.ProcessId))..."
        Stop-Process -Id $r.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object {
        $_.CommandLine -match 'spawn_main'
    } | ForEach-Object {
        Write-Host "Killing orphaned backend worker (PID $($_.ProcessId))..."
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

# Always restart the backend fresh - never assume a previous instance is still healthy.
Write-Host "Stopping any existing backend on port $BackendPort..."
Stop-BackendProcesses
Stop-Port $BackendPort

$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    throw "Virtual environment not found at $venvPython. Run: python -m venv .venv"
}

Write-Host "Starting backend (uvicorn) on port $BackendPort..."
$backendLog = Join-Path $projectRoot "backend-dev.log"
$backendErrLog = Join-Path $projectRoot "backend-dev.err.log"
# NOTE: ZGIIS_BACKGROUND_SERVICES=1 would start the local live NTRIP pipeline
# (backend/main.py's lifespan) so CORS Connected reads real numbers instead
# of always 0/24 -- tried this, but it opens ~24+ concurrent connections to
# the SAME shared Supabase pooler that scripts/live_ntrip_collector.py's
# always-on Task Scheduler job and production Vercel traffic also use.
# In testing this exhausted the pooler (Postgres connect timeouts, requests
# hanging 280s+) rather than just being locally slow. Leave this OFF for
# local dev -- the standalone collector (already running via the
# ZGIIS-NTRIP-Collector scheduled task) is the correct always-on source for
# live station status; don't duplicate live ingestion here too.
Start-Process -FilePath $venvPython `
    -ArgumentList "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "$BackendPort", "--workers", "4", "--timeout-keep-alive", "2" `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $backendLog `
    -RedirectStandardError $backendErrLog `
    -WindowStyle Hidden

Write-Host "Waiting for backend health check..."
$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$BackendPort/health" -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -eq 200) { $healthy = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 500
}
if (-not $healthy) {
    Write-Host "WARNING: backend did not report healthy within 15s - check $backendErrLog"
} else {
    Write-Host "Backend is up: http://127.0.0.1:$BackendPort/health"
}

Write-Host "Stopping any existing frontend on port $FrontendPort..."
Stop-Port $FrontendPort
Get-Process node -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Killing stale Node process (PID $($_.Id))..."
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 500

# Turbopack dev + `next build` concurrently corrupts `.next` (broken routes.d.ts,
# blank main content with sidebar still visible). Wipe the whole cache every restart.
$frontendDir = Join-Path $projectRoot "frontend"
$nextDir = Join-Path $frontendDir ".next"
if (Test-Path $nextDir) {
    Write-Host "Clearing stale Next.js cache ($nextDir)..."
    Remove-Item -Recurse -Force $nextDir -ErrorAction SilentlyContinue
}

Write-Host "Starting frontend (next dev --webpack) on port $FrontendPort..."
Write-Host ""
Write-Host "IMPORTANT:"
Write-Host "  - Wait until you see 'Ready' before opening the browser."
Write-Host "  - Do NOT run 'npm run build' while this dev server is running."
Write-Host "  - If pages show a blank main area, press Ctrl+C and run this script again."
Write-Host "  - Alternative: cd frontend && npm run build && npm run preview"
Write-Host ""
Set-Location $frontendDir
& npm.cmd run dev -- --port $FrontendPort --webpack
