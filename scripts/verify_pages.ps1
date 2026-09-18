param(
    [string]$OutDir = ""
)

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $OutDir) {
    $OutDir = Join-Path (Join-Path $repoRoot "frontend") "out"
}

$OutDir = (Resolve-Path $OutDir -ErrorAction SilentlyContinue).Path
if (-not $OutDir -or -not (Test-Path $OutDir)) {
    Write-Host "FAIL: export folder not found at $OutDir"
    Write-Host "Run: cd frontend && npm run build"
    exit 1
}

$routes = @(
    @{ Path = "/"; Marker = "GNSS Based TEC" },
    @{ Path = "/dashboard/"; Marker = "Space Weather Operations Dashboard" },
    @{ Path = "/processing/"; Marker = "RINEX" },
    @{ Path = "/time-series/"; Marker = "TEC Time Series" },
    @{ Path = "/prn-explorer/"; Marker = "PRN Explorer" },
    @{ Path = "/tec-heatmap/"; Marker = "TEC" },
    @{ Path = "/anomaly-detection/"; Marker = "Anomaly" },
    @{ Path = "/space-weather/"; Marker = "Space Weather Monitoring" },
    @{ Path = "/space-weather/gnss-intelligence/"; Marker = "Navigation Weather" },
    @{ Path = "/storm-watch/"; Marker = "Storm Watch" },
    @{ Path = "/gic-monitor/"; Marker = "GIC Monitor" },
    @{ Path = "/understanding-tec/"; Marker = "Understanding TEC" },
    @{ Path = "/vtec-theory/"; Marker = "Calculating VTEC" },
    @{ Path = "/geomagnetic-storm-theory/"; Marker = "Geomagnetic" },
    @{ Path = "/cors-hardware/"; Marker = "CORS" },
    @{ Path = "/live-pipeline/"; Marker = "Pipeline" },
    @{ Path = "/ai-assistant/"; Marker = "AI Assistant" }
)

$ok = 0
$fail = 0

foreach ($route in $routes) {
    $rel = $route.Path.Trim("/")
    if ($rel -eq "") {
        $htmlPath = Join-Path $OutDir "index.html"
    } else {
        $parts = $rel -split "/"
        $htmlPath = Join-Path $OutDir $parts[0]
        for ($i = 1; $i -lt $parts.Count; $i++) {
            $htmlPath = Join-Path $htmlPath $parts[$i]
        }
        $htmlPath = Join-Path $htmlPath "index.html"
    }

    if (-not (Test-Path $htmlPath)) {
        Write-Host "MISSING  $($route.Path)"
        $fail++
        continue
    }

    $html = Get-Content $htmlPath -Raw
    $hasMain = $html -match 'class="app-main"'
    $hasMarker = $html -match [regex]::Escape($route.Marker)
    $len = $html.Length

    if ($hasMain -and $hasMarker -and $len -gt 4000) {
        Write-Host "OK       $($route.Path)"
        $ok++
    } else {
        Write-Host "FAIL     $($route.Path)  main=$hasMain marker=$hasMarker len=$len"
        $fail++
    }
}

Write-Host ""
Write-Host "Result: $ok passed, $fail failed (of $($routes.Count) routes)"
if ($fail -gt 0) { exit 1 }
