$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker Desktop is not installed. Install it, then run this file again while internet is available."
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not running." }

Write-Host "Downloading the base images needed for offline event day..." -ForegroundColor Cyan
docker pull postgres:16-alpine
docker pull python:3.12-slim
docker pull eclipse-temurin:21-jdk-jammy

if (-not (Test-Path -LiteralPath ".env.offline")) {
    $sessionSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    $databasePassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(16)).ToLowerInvariant()
    $hostPassword = "Host-" + [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(8)).ToLowerInvariant()
    @"
POSTGRES_PASSWORD=$databasePassword
SESSION_SECRET=$sessionSecret
EVENT_HOST_PASSWORD=$hostPassword
"@ | Set-Content -LiteralPath ".env.offline" -Encoding utf8NoBOM
    @"
TECHX MADRAS 26 - LOCAL HOST LOGIN
Host ID: HOST-01
Password: $hostPassword

Participant login: the team name is both username and initial password.
"@ | Set-Content -LiteralPath "offline-credentials.txt" -Encoding utf8NoBOM
}

Write-Host "Building the web app and judge worker for offline use..." -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath "node_modules")) { npm ci }
npm run build
if ($LASTEXITCODE -ne 0) { throw "The production web build failed." }
docker compose --env-file .env.offline -f docker-compose.offline.yml build web
if ($LASTEXITCODE -ne 0) { throw "The offline web image could not be built." }
docker compose --env-file .env.offline -f docker-compose.offline.yml build judge-worker
if ($LASTEXITCODE -ne 0) { throw "The offline images could not be built." }

Write-Host "Offline package is ready. You can disconnect the internet and run .\start-event.ps1" -ForegroundColor Green
Write-Host "Host credentials are saved in offline-credentials.txt" -ForegroundColor Yellow
