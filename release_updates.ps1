param(
  [Parameter(Mandatory = $false)]
  [string]$Message = "BOP HRMS application update",

  [Parameter(Mandatory = $false)]
  [string]$WebBasePath = "HRMS"
)

$ErrorActionPreference = "Stop"

Write-Host "Checking the Expo project..."
npx expo-doctor

Write-Host "Building the web application..."
$previousWebBasePath = $env:EXPO_PUBLIC_WEB_BASE_PATH
$env:EXPO_PUBLIC_WEB_BASE_PATH = $WebBasePath
try {
  npm run export:web
} finally {
  $env:EXPO_PUBLIC_WEB_BASE_PATH = $previousWebBasePath
}

Write-Host "Preparing the bop.in server package..."
powershell -ExecutionPolicy Bypass -File ./prepare_bop_hosting.ps1 -WebBasePath $WebBasePath

Write-Warning "bop.in upload is not configured on this computer yet."
Write-Warning "Upload bop-hrms-deploy.zip to the bop.in web root, or configure SSH/SFTP deployment access before using this as a fully automatic release."

Write-Host "Publishing the mobile update to installed internal builds..."
npx eas-cli update --channel preview --environment preview --platform all --message $Message --non-interactive

Write-Host "Compatible installed mobile applications are updated."
Write-Host "The bop.in web package is ready at bop-hrms-deploy.zip."
