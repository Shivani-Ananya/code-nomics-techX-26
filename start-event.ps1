$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not running. Start it and run this file again." }
if (-not (Test-Path -LiteralPath ".env.offline")) {
    throw "Offline setup is not prepared. Connect to the internet once and run .\prepare-offline.ps1 first."
}

$requiredImages = @(
    "postgres:16-alpine",
    "python:3.12-slim",
    "eclipse-temurin:21-jdk-jammy",
    "techx-code-auction-web:latest",
    "techx-code-auction-worker:latest"
)
$available = docker image ls --format "{{.Repository}}:{{.Tag}}"
$missing = @($requiredImages | Where-Object { $_ -notin $available })
if ($missing.Count -gt 0) {
    throw "Offline images are missing: $($missing -join ', '). Reconnect once and run .\prepare-offline.ps1."
}

docker compose --env-file .env.offline -f docker-compose.offline.yml up -d --no-build
if ($LASTEXITCODE -ne 0) { throw "The event stack could not be started." }

$deadline = (Get-Date).AddMinutes(2)
do {
    Start-Sleep -Seconds 2
    $webState = docker inspect --format "{{.State.Health.Status}}" techx-code-auction-web-1 2>$null
    $workerState = docker inspect --format "{{.State.Health.Status}}" techx-code-auction-judge-worker-1 2>$null
} while ((Get-Date) -lt $deadline -and ($webState -ne "healthy" -or $workerState -ne "healthy"))

if ($webState -ne "healthy" -or $workerState -ne "healthy") {
    docker compose --env-file .env.offline -f docker-compose.offline.yml ps
    throw "The services did not become healthy. Run .\status-event.ps1 for details."
}

$lanIp = Get-NetIPConfiguration |
    Where-Object {
        $_.NetAdapter.Status -eq "Up" -and
        $_.NetAdapter.HardwareInterface -and
        $_.IPv4DefaultGateway -and
        $_.IPv4Address
    } |
    Sort-Object { $_.NetAdapter.InterfaceMetric } |
    Select-Object -First 1 -ExpandProperty IPv4Address |
    Select-Object -ExpandProperty IPAddress

Write-Host "TECHX Code Auction is ready." -ForegroundColor Green
Write-Host "This laptop: http://localhost:3000" -ForegroundColor Cyan
if ($lanIp) { Write-Host "Participants: http://${lanIp}:3000" -ForegroundColor Cyan }
Write-Host "Host credentials: offline-credentials.txt" -ForegroundColor Yellow
