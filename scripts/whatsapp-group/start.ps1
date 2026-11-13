$ErrorActionPreference = 'Stop'
$groupProject = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$groupRuntime = Join-Path $groupProject '.whatsapp-alerts'
if (-not (Test-Path -LiteralPath (Join-Path $groupRuntime 'config.private.json'))) {
    throw 'The private WhatsApp sender configuration is missing. See README.md.'
}
try {
    $existingSender = Invoke-RestMethod 'http://127.0.0.1:8788/status' -TimeoutSec 2
} catch {
    $existingSender = $null
}
if ($existingSender) {
    Write-Output ('Sender is already running: ' + $existingSender.state)
} else {
    $groupWorker = Join-Path $PSScriptRoot 'worker.mjs'
    $groupNode = (Get-Command node -ErrorAction Stop).Source
    Start-Process -FilePath $groupNode -ArgumentList ('"' + $groupWorker + '"') `
        -WorkingDirectory $groupProject -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $groupRuntime 'worker.log') `
        -RedirectStandardError (Join-Path $groupRuntime 'worker.err.log')
    Write-Output 'Sender started. Phone approval may still be required.'
}
Write-Output 'Connection and delivery status: http://127.0.0.1:8788'
