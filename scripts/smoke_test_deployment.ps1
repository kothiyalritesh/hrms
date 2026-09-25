# scripts/smoke_test_deployment.ps1
# Automated post-deployment verification for BOP HRMS on Hostinger
param(
  [string]$BaseUrl = "https://bop.in/HRMS"
)

$ErrorActionPreference = "Continue"
$BaseUrl = $BaseUrl.TrimEnd('/')
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host " BOP HRMS Production Smoke Test Suite" -ForegroundColor Cyan
Write-Host " Target Base URL: $BaseUrl" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

$passed = 0
$failed = 0

function Test-Endpoint {
  param(
    [string]$Name,
    [string]$Url,
    [string]$Method = "GET",
    [string]$Body = $null,
    [int[]]$ExpectedStatusCodes = @(200),
    [string]$MustContain = $null
  )

  Write-Host -NoNewline "[TEST] $Name ... "
  try {
    $headers = @{
      "User-Agent" = "BOP-HRMS-SmokeTest/1.0"
      "Accept" = "*/*"
    }
    if ($Body) {
      $headers["Content-Type"] = "application/json"
    }

    $response = $null
    if ($Method -eq "POST") {
      $response = Invoke-WebRequest -Uri $Url -Method POST -Headers $headers -Body $Body -TimeoutSec 15 -UseBasicParsing
    } else {
      $response = Invoke-WebRequest -Uri $Url -Method GET -Headers $headers -TimeoutSec 15 -UseBasicParsing
    }

    $status = $response.StatusCode
    $content = $response.Content

    $statusOk = $ExpectedStatusCodes -contains $status
    $contentOk = ($MustContain -eq $null) -or ($content.Contains($MustContain))

    if ($statusOk -and $contentOk) {
      Write-Host "PASS (HTTP $status)" -ForegroundColor Green
      $global:passed++
    } else {
      Write-Host "FAIL (HTTP $status, expected $($ExpectedStatusCodes -join '/'))" -ForegroundColor Red
      $global:failed++
    }
  } catch [System.Net.WebException] {
    $webEx = $_.Exception
    if ($webEx.Response) {
      $statusCode = [int]$webEx.Response.StatusCode
      if ($ExpectedStatusCodes -contains $statusCode) {
        Write-Host "PASS (HTTP $statusCode expected)" -ForegroundColor Green
        $global:passed++
        return
      }
    }
    Write-Host "FAIL ($($webEx.Message))" -ForegroundColor Red
    $global:failed++
  } catch {
    Write-Host "FAIL ($($_.Exception.Message))" -ForegroundColor Red
    $global:failed++
  }
}

# 1. Base URL HTML Delivery
Test-Endpoint -Name "Root Index /HRMS/" -Url "$BaseUrl/" -ExpectedStatusCodes @(200) -MustContain "<!DOCTYPE html>"

# 2. Direct Index HTML
Test-Endpoint -Name "Static /HRMS/index.html" -Url "$BaseUrl/index.html" -ExpectedStatusCodes @(200) -MustContain "HRMS"

# 3. Service Worker
Test-Endpoint -Name "PWA Service Worker /HRMS/sw.js" -Url "$BaseUrl/sw.js" -ExpectedStatusCodes @(200)

# 4. Manifest
Test-Endpoint -Name "PWA Manifest /HRMS/manifest.webmanifest" -Url "$BaseUrl/manifest.webmanifest" -ExpectedStatusCodes @(200)

# 5. Apache SPA Deep-Route Fallback (/HRMS/login)
Test-Endpoint -Name "SPA Deep Route /HRMS/login" -Url "$BaseUrl/login" -ExpectedStatusCodes @(200) -MustContain "<!DOCTYPE html>"

# 6. OTP Proxy Preflight / Active Relay
Test-Endpoint -Name "OTP Proxy Empty Payload (400 expected)" -Url "$BaseUrl/otp-proxy.php" -Method "POST" -Body "{}" -ExpectedStatusCodes @(400)

# 7. OTP Proxy Version Inspection (Verifies Edge Function Connectivity)
Test-Endpoint -Name "OTP Edge Function Version Ping" -Url "$BaseUrl/otp-proxy.php" -Method "POST" -Body '{"action":"version"}' -ExpectedStatusCodes @(200) -MustContain "otp-auth"

# 8. Malformed Phone Validation
Test-Endpoint -Name "OTP Proxy Validation for Invalid Phone (400 expected)" -Url "$BaseUrl/otp-proxy.php" -Method "POST" -Body '{"action":"request","phone":"123"}' -ExpectedStatusCodes @(400)

Write-Host "-------------------------------------------------" -ForegroundColor Cyan
Write-Host " Results: $passed Passed, $failed Failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host "=================================================" -ForegroundColor Cyan

if ($failed -gt 0) {
  exit 1
}
exit 0

