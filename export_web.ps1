$ErrorActionPreference = "Stop"

$workspaceRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd(
  [System.IO.Path]::DirectorySeparatorChar
)
$distPath = [System.IO.Path]::GetFullPath(
  [System.IO.Path]::Combine($workspaceRoot, "dist")
)
$releaseConfigPath = Join-Path $workspaceRoot "release.config.json"
$releaseConfig = Get-Content -LiteralPath $releaseConfigPath -Raw | ConvertFrom-Json
# Every export gets a unique release ID (IST timestamp) so installed browsers and
# the Android app can tell a new upload apart from the one they are running.
# Set HRMS_BUILD_ID to force a specific ID.
$buildId = if ($env:HRMS_BUILD_ID) {
  [string]$env:HRMS_BUILD_ID
} else {
  [DateTime]::UtcNow.AddHours(5.5).ToString("yyyyMMdd.HHmmss")
}
$requiredSchema = [string]$releaseConfig.requiredBackendSchemaVersion
if (
  [string]::IsNullOrWhiteSpace($buildId) -or
  [string]::IsNullOrWhiteSpace($requiredSchema)
) {
  throw "release.config.json must define buildId and requiredBackendSchemaVersion."
}

if (
  [System.IO.Path]::GetDirectoryName($distPath) -ne $workspaceRoot -or
  [System.IO.Path]::GetFileName($distPath) -ne "dist"
) {
  throw "Refusing to clean an unexpected export directory: $distPath"
}

if (Test-Path -LiteralPath $distPath) {
  Remove-Item -LiteralPath $distPath -Recurse -Force
}

Push-Location -LiteralPath $workspaceRoot
try {
  # Dynamic Expo config embeds release.config.json. Metro's cache can otherwise
  # reuse an older Constants manifest even when the release manifest changed.
  $env:EXPO_PUBLIC_WEB_BASE_PATH = '/HRMS/'
  $previousBuildId = $env:EXPO_PUBLIC_BUILD_ID
  $env:EXPO_PUBLIC_BUILD_ID = $buildId
  & npx expo export --platform web --clear
  if ($LASTEXITCODE -ne 0) {
    throw "Expo web export failed with exit code $LASTEXITCODE"
  }

  $serviceWorkerPath = Join-Path $distPath "sw.js"
  if (-not (Test-Path -LiteralPath $serviceWorkerPath)) {
    throw "The exported service worker is missing: $serviceWorkerPath"
  }
  $serviceWorker = Get-Content -LiteralPath $serviceWorkerPath -Raw
  if (-not $serviceWorker.Contains("__BOP_BUILD_ID__")) {
    throw "The service worker build-ID token is missing."
  }
  if (-not $serviceWorker.Contains("__BOP_PRECACHE_ASSETS__")) {
    throw "The service worker pre-cache token is missing."
  }
  $scriptDirectory = Join-Path $distPath "_expo/static/js/web"
  $releaseScripts = @(
    Get-ChildItem -LiteralPath $scriptDirectory -File -Filter "*.js" |
      Sort-Object Name |
      ForEach-Object { "./_expo/static/js/web/$($_.Name)" }
  )
  if ($releaseScripts.Count -eq 0) {
    throw "The web export produced no JavaScript bundles to pre-cache."
  }

  $bundleText = ($releaseScripts | ForEach-Object {
    $relativeBundlePath = $_.TrimStart([char[]]@('.', '/')).Replace(
      "/",
      [System.IO.Path]::DirectorySeparatorChar
    )
    $bundlePath = Join-Path $distPath $relativeBundlePath
    Get-Content -LiteralPath $bundlePath -Raw
  }) -join "`n"
  $normalizedBundleText = $bundleText.Replace('\"', '"')
  $embeddedBuildIds = @(
    [regex]::Matches($normalizedBundleText, '"buildId":"([^"]+)"') |
      ForEach-Object { $_.Groups[1].Value } |
      Sort-Object -Unique
  )
  $embeddedSchemas = @(
    [regex]::Matches($normalizedBundleText, '"requiredBackendSchemaVersion":"([^"]+)"') |
      ForEach-Object { $_.Groups[1].Value } |
      Sort-Object -Unique
  )
  if ($embeddedBuildIds.Count -ne 1 -or $embeddedBuildIds[0] -ne $buildId) {
    throw "Exported bundle build IDs do not match release.config.json: $($embeddedBuildIds -join ', ')"
  }
  if ($embeddedSchemas.Count -ne 1 -or $embeddedSchemas[0] -ne $requiredSchema) {
    throw "Exported bundle schema versions do not match release.config.json: $($embeddedSchemas -join ', ')"
  }

  $indexPath = Join-Path $distPath "index.html"
  $indexHtml = Get-Content -LiteralPath $indexPath -Raw
  $indexHtml = $indexHtml.Replace('httpEquiv="X-UA-Compatible"', 'http-equiv="X-UA-Compatible"')
  if ($indexHtml.Contains('httpEquiv=')) {
    throw "The exported index.html contains a non-standard httpEquiv attribute."
  }
  Set-Content -LiteralPath $indexPath -Value $indexHtml -NoNewline
  $releaseScriptsJson = ConvertTo-Json -InputObject $releaseScripts -Compress
  $serviceWorker = $serviceWorker.Replace("__BOP_BUILD_ID__", $buildId)
  $serviceWorker = $serviceWorker.Replace(
    "__BOP_PRECACHE_ASSETS__",
    $releaseScriptsJson
  )
  Set-Content -LiteralPath $serviceWorkerPath -Value $serviceWorker -NoNewline

  # Release manifest read by ReleaseUpdateNotice (web + Android WebView).
  $releaseManifest = [ordered]@{
    buildId = $buildId
    builtAt = [DateTime]::UtcNow.ToString("o")
    mandatory = [bool]$releaseConfig.mandatoryWebUpdate
    message = [string]$releaseConfig.updateMessage
    minAndroidAppVersion = [string]$releaseConfig.minAndroidAppVersion
    androidDownloadUrl = [string]$releaseConfig.androidDownloadUrl
    requiredBackendSchemaVersion = $requiredSchema
  }
  $releaseManifestJson = ConvertTo-Json -InputObject $releaseManifest
  [System.IO.File]::WriteAllText(
    (Join-Path $distPath "version.json"),
    $releaseManifestJson,
    (New-Object System.Text.UTF8Encoding($false))
  )
  Write-Host "Release $buildId written to dist/version.json"
} finally {
  $env:EXPO_PUBLIC_BUILD_ID = $previousBuildId
  Pop-Location
}



