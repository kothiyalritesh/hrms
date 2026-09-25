<#
Build the production web package for https://<your-domain>/HRMS/.

Run from the project folder:
  powershell -ExecutionPolicy Bypass -File .\build_hrms_production.ps1
#>

$ErrorActionPreference = "Stop"

$workspaceRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
Push-Location -LiteralPath $workspaceRoot
try {
  & powershell -ExecutionPolicy Bypass -File .\deploy_bop_web.ps1 -WebBasePath "HRMS"
  if ($LASTEXITCODE -ne 0) {
    throw "The production build failed with exit code $LASTEXITCODE."
  }

  $archivePath = Join-Path $workspaceRoot "bop-hrms-deploy.zip"
  if (-not (Test-Path -LiteralPath $archivePath)) {
    throw "Expected production archive was not created: $archivePath"
  }

  Write-Host "Production archive is ready: $archivePath"
  Write-Host "Upload it to public_html and extract it to create public_html/HRMS/."
} finally {
  Pop-Location
}
