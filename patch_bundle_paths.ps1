param(
  [string]$WebBasePath = ""
)

# Load env if needed
if (-not $WebBasePath) {
  $envFile = Join-Path $PSScriptRoot ".env"
  if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
      if ($_ -match '^\s*EXPO_PUBLIC_WEB_BASE_PATH\s*=\s*(.+)\s*$') {
        $WebBasePath = $matches[1].Trim("'").Trim('"')
      }
    }
  }
}
$WebBasePath = $WebBasePath.Trim('/').Trim()
Write-Host "Base path: '$WebBasePath'"

if (-not $WebBasePath) {
  Write-Host "No base path configured - nothing to rewrite."
  exit 0
}

$scriptDirectory = Join-Path $PSScriptRoot "dist\_expo\static\js\web"
if (-not (Test-Path $scriptDirectory)) {
  Write-Error "Bundle directory not found: $scriptDirectory"
  exit 1
}

# Metro bakes two kinds of absolute paths that must be rewritten:
#   1. "/_expo/  -> "/HRMS/_expo/   (lazy-loaded JS chunk paths)
#   2. "/assets/ -> "/HRMS/assets/  (font/image asset paths used at runtime)
# Both are emitted as absolute-from-root strings regardless of experiments.baseUrl.
$replacements = @(
  @{ Old = '"/_expo/';   New = '"/' + $WebBasePath + '/_expo/' },
  @{ Old = '"/assets/';  New = '"/' + $WebBasePath + '/assets/' }
)

$jsBundles = Get-ChildItem -LiteralPath $scriptDirectory -File -Filter "*.js"
$patchedFiles = 0

foreach ($jsFile in $jsBundles) {
  $jsContent = Get-Content -LiteralPath $jsFile.FullName -Raw
  if (-not $jsContent) { continue }
  $changed = $false
  foreach ($r in $replacements) {
    if ($jsContent.Contains($r.Old)) {
      $jsContent = $jsContent.Replace($r.Old, $r.New)
      $changed = $true
    }
  }
  if ($changed) {
    Set-Content -LiteralPath $jsFile.FullName -Value $jsContent -NoNewline
    $patchedFiles++
  }
}
Write-Host "Patched $patchedFiles / $($jsBundles.Count) bundles"

# Verify on main bundle
$indexBundles = Get-ChildItem $scriptDirectory -Filter "index-*.js"
if ($indexBundles.Count -eq 0) { Write-Error "No index-*.js found"; exit 1 }
$verify = Get-Content -LiteralPath $indexBundles[0].FullName -Raw

$checks = @(
  @{ Pattern = '"/_expo/';                  Label = 'bare /_expo/';   ShouldExist = $false },
  @{ Pattern = '"/' + $WebBasePath + '/_expo/'; Label = "/$WebBasePath/_expo/"; ShouldExist = $true },
  @{ Pattern = '"/assets/';                 Label = 'bare /assets/';  ShouldExist = $false },
  @{ Pattern = '"/' + $WebBasePath + '/assets/'; Label = "/$WebBasePath/assets/"; ShouldExist = $true }
)

foreach ($c in $checks) {
  $found = $verify.Contains($c.Pattern)
  if ($c.ShouldExist) {
    if ($found) { Write-Host "PASS: $($c.Label) prefix confirmed" }
    else         { Write-Host "WARN: $($c.Label) NOT found - check bundle" }
  } else {
    if ($found) { Write-Host "FAIL: bare $($c.Label) still present in main bundle" }
    else         { Write-Host "PASS: no bare $($c.Label) in main bundle" }
  }
}
