$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
docker compose --env-file .env.offline -f docker-compose.offline.yml down
Write-Host "Event services stopped. Database data was preserved." -ForegroundColor Green
