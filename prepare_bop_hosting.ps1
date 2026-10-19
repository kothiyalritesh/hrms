param(
  [string]$WebBasePath = $(if ($env:EXPO_PUBLIC_WEB_BASE_PATH) { $env:EXPO_PUBLIC_WEB_BASE_PATH.Trim('/') } else { "" })
)

$ErrorActionPreference = "Stop"

$WebBasePath = $WebBasePath.Trim().Trim('/')
if ($WebBasePath -and $WebBasePath -notmatch '^[A-Za-z0-9._-]+$') {
  throw "WebBasePath must be / or one safe path segment."
}

$workspaceRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$distPath = Join-Path $workspaceRoot "dist"
$stagingPath = Join-Path $workspaceRoot ".bop-hosting-package"
$serverRootPath = Join-Path $stagingPath "server-root"
$hrmsPath = if ($WebBasePath) { Join-Path $serverRootPath $WebBasePath } else { $serverRootPath }

# Compress-Archive (Windows PowerShell 5.1) stores "HRMS\index.html" with
# backslashes; Linux hosting extractors then create files literally named that
# way instead of the HRMS folder. Write entries with forward slashes.
function New-PortableZip([string]$SourceDir, [string]$ZipPath) {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
  $root = (Resolve-Path -LiteralPath $SourceDir).Path.TrimEnd([char]92) + [char]92
  $zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem -LiteralPath $SourceDir -Recurse -Force -File | ForEach-Object {
      $entryName = $_.FullName.Substring($root.Length).Replace([char]92, [char]47)
      [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    }
  } finally {
    $zip.Dispose()
  }
}

$archivePath = Join-Path $workspaceRoot "bop-hrms-deploy.zip"
$backendStagingPath = Join-Path $workspaceRoot ".bop-backend-package"
$backendArchivePath = Join-Path $workspaceRoot "bop-hrms-backend.zip"

if (-not (Test-Path -LiteralPath (Join-Path $distPath "index.html"))) {
  throw "dist/index.html is missing. Run npm run export:web first."
}

$indexHtml = Get-Content -LiteralPath (Join-Path $distPath "index.html") -Raw
$expectedAssetPrefix = if ($WebBasePath) { "/$WebBasePath/_expo/" } else { "/_expo/" }
$unexpectedRootPrefix = $WebBasePath -and $indexHtml.Contains('"/_expo/')
$expectedPrefixMissing = -not $indexHtml.Contains("`"$expectedAssetPrefix")
if ($unexpectedRootPrefix -or $expectedPrefixMissing) {
  $requestedPath = if ($WebBasePath) { "/$WebBasePath/" } else { "/" }
  throw "The exported application was not built for $requestedPath. Set EXPO_PUBLIC_WEB_BASE_PATH to the same path before running npm run export:web, then package it again."
}

foreach ($target in @($stagingPath, $archivePath, $backendStagingPath, $backendArchivePath)) {
  $fullTarget = [System.IO.Path]::GetFullPath($target)
  if (-not $fullTarget.StartsWith($workspaceRoot + [System.IO.Path]::DirectorySeparatorChar)) {
    throw "Refusing to modify a path outside the workspace: $fullTarget"
  }
}

if (Test-Path -LiteralPath $stagingPath) {
  Remove-Item -LiteralPath $stagingPath -Recurse -Force
}
if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}
if (Test-Path -LiteralPath $backendStagingPath) {
  Remove-Item -LiteralPath $backendStagingPath -Recurse -Force
}
if (Test-Path -LiteralPath $backendArchivePath) {
  Remove-Item -LiteralPath $backendArchivePath -Force
}

New-Item -ItemType Directory -Path $hrmsPath -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $distPath "_expo") -Destination $hrmsPath -Recurse
Copy-Item -LiteralPath (Join-Path $distPath "assets") -Destination $hrmsPath -Recurse
Copy-Item -LiteralPath (Join-Path $distPath "index.html") -Destination $hrmsPath
Copy-Item -LiteralPath (Join-Path $distPath "favicon.ico") -Destination $hrmsPath
Copy-Item -LiteralPath (Join-Path $distPath "metadata.json") -Destination $hrmsPath
Copy-Item -LiteralPath (Join-Path $distPath "manifest.webmanifest") -Destination $hrmsPath
Copy-Item -LiteralPath (Join-Path $distPath "sw.js") -Destination $hrmsPath
Copy-Item -LiteralPath (Join-Path $distPath "version.json") -Destination $hrmsPath
Copy-Item -LiteralPath (Join-Path $distPath "icon.png") -Destination $hrmsPath
Copy-Item -LiteralPath (Join-Path $workspaceRoot "public\.htaccess") -Destination $hrmsPath

New-PortableZip $serverRootPath $archivePath

$backendSupabasePath = Join-Path $backendStagingPath "supabase"
New-Item -ItemType Directory -Path $backendSupabasePath -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $workspaceRoot "supabase\migrations") -Destination $backendSupabasePath -Recurse
Copy-Item -LiteralPath (Join-Path $workspaceRoot "supabase\functions") -Destination $backendSupabasePath -Recurse
Copy-Item -LiteralPath (Join-Path $workspaceRoot "supabase\security_audit.sql") -Destination $backendSupabasePath
Copy-Item -LiteralPath (Join-Path $workspaceRoot "PRODUCTION_RELEASE_CHECKLIST.md") -Destination $backendStagingPath
Copy-Item -LiteralPath (Join-Path $workspaceRoot "BACKEND_PACKAGE_README.md") -Destination $backendStagingPath
New-PortableZip $backendStagingPath $backendArchivePath

Write-Host "Created $archivePath"
$displayBase = if ($WebBasePath) { "/$WebBasePath" } else { "" }
Write-Host "Archive layout for configured web base path '$($displayBase)/':"
Write-Host "  $displayBase/index.html"
Write-Host "  $displayBase/favicon.ico"
Write-Host "  $displayBase/manifest.webmanifest"
Write-Host "  $displayBase/sw.js"
Write-Host "  $displayBase/version.json (release ID read by the in-app update notice)"
Write-Host "  $displayBase/icon.png"
Write-Host "  $displayBase/_expo/..."
Write-Host "  $displayBase/assets/..."
Write-Host "  $displayBase/.htaccess (nested-route SPA fallback for Apache)"
Write-Host "Created $backendArchivePath (migrations, Edge Functions, and release checklist)"
