<#
Build the testing web package for https://<your-domain>/hrms-testing/.

Run from the project folder:
  powershell -ExecutionPolicy Bypass -File .\build_hrms_testing.ps1

The script saves the testing archive as bop-hrms-testing-deploy.zip and
restores an existing production bop-hrms-deploy.zip after the test build.
#>

$ErrorActionPreference = "Stop"

$workspaceRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$productionArchive = Join-Path $workspaceRoot "bop-hrms-deploy.zip"
$testingArchive = Join-Path $workspaceRoot "bop-hrms-testing-deploy.zip"
$backupArchive = Join-Path $workspaceRoot ".bop-hrms-production-backup-$PID.zip"
$hasProductionArchive = Test-Path -LiteralPath $productionArchive

if ($hasProductionArchive) {
  Copy-Item -LiteralPath $productionArchive -Destination $backupArchive -Force
}

Push-Location -LiteralPath $workspaceRoot
try {
  & powershell -ExecutionPolicy Bypass -File .\deploy_bop_web.ps1 -WebBasePath "hrms-testing"
  if ($LASTEXITCODE -ne 0) {
    throw "The testing build failed with exit code $LASTEXITCODE."
  }

  if (-not (Test-Path -LiteralPath $productionArchive)) {
    throw "Expected testing archive was not created: $productionArchive"
  }

  Copy-Item -LiteralPath $productionArchive -Destination $testingArchive -Force
  Write-Host "Testing archive is ready: $testingArchive"
  Write-Host "Upload it to public_html and extract it to create public_html/hrms-testing/."
} finally {
  Pop-Location

  if ($hasProductionArchive -and (Test-Path -LiteralPath $backupArchive)) {
    if (Test-Path -LiteralPath $productionArchive) {
      Remove-Item -LiteralPath $productionArchive -Force
    }
    Move-Item -LiteralPath $backupArchive -Destination $productionArchive -Force
    Write-Host "Restored the production archive: $productionArchive"
  } elseif (Test-Path -LiteralPath $backupArchive) {
    Remove-Item -LiteralPath $backupArchive -Force
  }
}
