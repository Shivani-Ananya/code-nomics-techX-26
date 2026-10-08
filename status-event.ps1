$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot
docker compose --env-file .env.offline -f docker-compose.offline.yml ps
docker compose --env-file .env.offline -f docker-compose.offline.yml logs --tail 80 web judge-worker
