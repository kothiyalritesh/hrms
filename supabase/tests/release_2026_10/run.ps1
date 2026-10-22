# Runs the 2026-10 release scenario tests against a LOCAL PostgreSQL.
# Each scenario gets a fresh database built from mock_schema.sql, then applies
# the real migration and asserts every rule (the run stops on the first wrong
# result). Never point this at the production project.
#
#   powershell -ExecutionPolicy Bypass -File supabase/tests/release_2026_10/run.ps1 -Port 54330
param(
  [int]$Port = 5432,
  [string]$User = "postgres",
  [string]$Psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
)
# psql prints NOTICE lines on stderr; judge each step by its exit code.
$ErrorActionPreference = "Continue"
if (-not $env:PGPASSWORD) { throw "Set PGPASSWORD for the local test server first." }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
& python -I (Join-Path $here "build_mock_schema.py")
if ($LASTEXITCODE -ne 0) { throw "mock schema generation failed" }
$failed = 0
foreach ($scenario in Get-ChildItem -Path $here -Filter "0*.sql" | Sort-Object Name) {
  $db = "hrms_rel_" + [IO.Path]::GetFileNameWithoutExtension($scenario.Name).Substring(0, 2)
  & $Psql -h 127.0.0.1 -p $Port -U $User -d postgres -q -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db" | Out-Null
  & $Psql -h 127.0.0.1 -p $Port -U $User -d $db -q -v ON_ERROR_STOP=1 -f (Join-Path $here "mock_schema.sql") | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "mock schema failed to load" }
  & $Psql -h 127.0.0.1 -p $Port -U $User -d $db -q -v ON_ERROR_STOP=1 -f $scenario.FullName 2>&1 |
    Where-Object { "$_" -match "ok  |FAIL|PASS|ERROR" } | ForEach-Object { "$_" -replace '^.*NOTICE:\s+', '  ' }
  if ($LASTEXITCODE -ne 0) { $failed++; Write-Host "FAILED: $($scenario.Name)" -ForegroundColor Red }
  & $Psql -h 127.0.0.1 -p $Port -U $User -d postgres -q -c "DROP DATABASE IF EXISTS $db" | Out-Null
}
if ($failed) { exit 1 } else { Write-Host "All release scenarios passed." -ForegroundColor Green }
