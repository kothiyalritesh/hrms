param(
  [Parameter(Mandatory = $false)]
  [string]$WebBasePath = "HRMS"
)

$ErrorActionPreference = "Stop"

$WebBasePath = $WebBasePath.Trim().Trim('/')
if (-not $WebBasePath) {
  throw "The bop.in deployment path cannot be empty. Use -WebBasePath HRMS."
}
if ($WebBasePath -notmatch '^[A-Za-z0-9._-]+$') {
  throw "WebBasePath must be one safe path segment."
}

$previousWebBasePath = $env:EXPO_PUBLIC_WEB_BASE_PATH
$env:EXPO_PUBLIC_WEB_BASE_PATH = $WebBasePath
try {
  & powershell -ExecutionPolicy Bypass -File ./export_web.ps1
  if ($LASTEXITCODE -ne 0) {
    throw "Expo web export failed with exit code $LASTEXITCODE"
  }

  & powershell -ExecutionPolicy Bypass -File ./prepare_bop_hosting.ps1 `
    -WebBasePath $WebBasePath
  if ($LASTEXITCODE -ne 0) {
    throw "BOP hosting package creation failed with exit code $LASTEXITCODE"
  }
} finally {
  $env:EXPO_PUBLIC_WEB_BASE_PATH = $previousWebBasePath
}

Write-Host "Ready to upload: bop-hrms-deploy.zip"
Write-Host "Extract it in public_html so that /$WebBasePath/index.html and /$WebBasePath/_expo/ are side by side."
