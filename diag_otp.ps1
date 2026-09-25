$ErrorActionPreference = "SilentlyContinue"

$anonKey = "sb_publishable_SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PX"
$versionBody = '{"action":"version"}'
$phoneBody   = '{"action":"request","phone":"9999999999"}'

function Test-Endpoint($label, $uri, $method, $body, $headers) {
  Write-Host "`n=== $label ==="
  try {
    $params = @{
      Uri             = $uri
      Method          = $method
      UseBasicParsing = $true
      ErrorAction     = "Stop"
    }
    if ($body)    { $params.Body        = $body }
    if ($headers) { $params.Headers     = $headers }
    if ($body)    { $params.ContentType = "application/json" }
    $r = Invoke-WebRequest @params
    Write-Host "HTTP $($r.StatusCode)"
    Write-Host $r.Content
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Host "HTTP $code  ERROR: $($_.Exception.Message)"
    try {
      $s = $_.Exception.Response.GetResponseStream()
      $rd = New-Object System.IO.StreamReader($s)
      Write-Host "Body: $($rd.ReadToEnd())"
    } catch {}
  }
}

# 1. GET proxy (expect 405 JSON if PHP is working)
Test-Endpoint "GET otp-proxy.php" "https://bop.in/HRMS/otp-proxy.php" "GET" $null $null

# 2. POST version ping through proxy
Test-Endpoint "POST proxy (version ping)" "https://bop.in/HRMS/otp-proxy.php" "POST" $versionBody $null

# 3. POST version ping directly to Edge Function
$efHeaders = @{
  "apikey"        = $anonKey
  "Authorization" = "Bearer $anonKey"
}
Test-Endpoint "POST edge function direct (version)" "https://fuchvtzbgwzdpzfaizbj.supabase.co/functions/v1/otp-auth" "POST" $versionBody $efHeaders

# 4. POST real OTP request directly to Edge Function (system admin = 9999999999)
Test-Endpoint "POST edge function direct (otp request)" "https://fuchvtzbgwzdpzfaizbj.supabase.co/functions/v1/otp-auth" "POST" $phoneBody $efHeaders
