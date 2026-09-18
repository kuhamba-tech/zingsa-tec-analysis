param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 3000
)

& (Join-Path $PSScriptRoot "dev.ps1") -BackendPort $BackendPort -FrontendPort $FrontendPort
