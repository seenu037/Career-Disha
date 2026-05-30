# refresh-data.ps1 — one-command market-data refresh for Windows.
#
# Pulls fresh Adzuna numbers into data/careers.json, regenerates data/data.js,
# then runs the integrity test so you immediately know the data is well-formed.
#
# Usage (from anywhere):
#   powershell -ExecutionPolicy Bypass -File scripts\refresh-data.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\refresh-data.ps1 -DryRun
#
# Reads ADZUNA_APP_ID / ADZUNA_APP_KEY from the .env file in the project root.

param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# Resolve project root (parent of this script's folder) so it works from any cwd.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "CareerDisha · refreshing market data from Adzuna..." -ForegroundColor Cyan

$refreshArgs = @('scripts/refresh-market-data.js')
if ($DryRun) { $refreshArgs += '--dry-run' }

node @refreshArgs
if ($LASTEXITCODE -ne 0) { Write-Host "Refresh failed (exit $LASTEXITCODE)." -ForegroundColor Red; exit $LASTEXITCODE }

if (-not $DryRun) {
  Write-Host "`nVerifying regenerated data..." -ForegroundColor Cyan
  node data/_test-matcher.js | Select-Object -Last 6
  if ($LASTEXITCODE -ne 0) { Write-Host "Integrity check FAILED." -ForegroundColor Red; exit $LASTEXITCODE }
  Write-Host "`nDone. Review changes with: git diff data/careers.json" -ForegroundColor Green
}
