<?php
// BOP HRMS - Same-origin OTP Authentication Proxy Gateway
// Strictly relays authentication requests to Supabase Edge Function otp-auth.
// Solves Android WebView CORS/domain boundary restrictions on https://bop.in/HRMS/
declare(strict_types=1);

// 1. Handle preflight CORS requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: POST, OPTIONS, GET');
    header('Access-Control-Allow-Headers: Authorization, apikey, Content-Type, x-client-info');
    header('Access-Control-Max-Age: 86400');
    http_response_code(200);
    exit;
}

// 2. Reject non-POST requests
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: *');
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'error'   => 'METHOD_NOT_ALLOWED',
        'message' => 'Only POST requests are accepted.'
    ]);
    exit;
}

// 3. Resolve Client IP
$clientIp = '127.0.0.1';
if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
    $clientIp = trim((string)$_SERVER['HTTP_CF_CONNECTING_IP']);
} elseif (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
    $parts = explode(',', (string)$_SERVER['HTTP_X_FORWARDED_FOR']);
    $clientIp = trim($parts[0]);
} elseif (!empty($_SERVER['REMOTE_ADDR'])) {
    $clientIp = trim((string)$_SERVER['REMOTE_ADDR']);
}

// 4. File-Based Rate Limiting (Max 25 requests / 10 minutes per IP)
$rateLimitDir = sys_get_temp_dir() . '/bop_hrms_ratelimit';
if (!is_dir($rateLimitDir)) {
    @mkdir($rateLimitDir, 0777, true);
}
$ipHash = md5($clientIp);
$rateLimitFile = $rateLimitDir . '/' . $ipHash . '.json';
$now = time();
$requests = [];

if (file_exists($rateLimitFile)) {
    $content = @file_get_contents($rateLimitFile);
    if ($content) {
        $data = @json_decode($content, true);
        if (is_array($data)) {
            $requests = array_filter($data, function ($timestamp) use ($now) {
                return is_numeric($timestamp) && ($now - (int)$timestamp) < 600;
            });
        }
    }
}

if (count($requests) >= 25) {
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: *');
    http_response_code(429);
    echo json_encode([
        'success'     => false,
        'error'       => 'IP_RATE_LIMITED',
        'message'     => 'Too many requests from this network. Please wait a few minutes.',
        'retry_after' => 300
    ]);
    exit;
}

$requests[] = $now;
@file_put_contents($rateLimitFile, json_encode(array_values($requests)), LOCK_EX);

// 5. Read and Validate Request Body
$rawInput = file_get_contents('php://input');
if ($rawInput === false || strlen(trim($rawInput)) === 0) {
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: *');
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error'   => 'EMPTY_REQUEST',
        'message' => 'Request body cannot be empty.'
    ]);
    exit;
}

// 6. Supabase Edge Function Configuration
$supabaseUrl = 'https://fuchvtzbgwzdpzfaizbj.supabase.co';
$anonKey     = 'sb_publishable_SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PX';
$targetUrl   = $supabaseUrl . '/functions/v1/otp-auth';
$supabaseUrl = getenv('SUPABASE_URL') ?: 'https://fuchvtzbgwzdpzfaizbj.supabase.co';
$anonKey     = getenv('SUPABASE_ANON_KEY') ?: 'sb_publishable_SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PX';
$supabaseUrl = getenv('SUPABASE_URL');
$anonKey     = getenv('SUPABASE_ANON_KEY');

if (!$supabaseUrl || !$anonKey) {
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error'   => 'CONFIG_ERROR',
        'message' => 'Proxy environment configuration missing.'
    ]);
    exit;
}

// Note: Ensure that SUPABASE_ANON_KEY is securely rotated in Supabase and set in your PHP environment variables.

$targetUrl   = rtrim($supabaseUrl, '/') . '/functions/v1/otp-auth';

$headers = [
    'Content-Type: application/json',
    'Accept: application/json',
    'apikey: ' . $anonKey,
    'Authorization: Bearer ' . $anonKey,
    'X-Forwarded-For: ' . $clientIp
];

$response = false;
$httpCode = 500;

// 7. Execute Pass-Through Relay via cURL
if (function_exists('curl_init')) {
    $ch = curl_init($targetUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $rawInput);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    $response = curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    if (curl_errno($ch)) {
        $response = false;
    }
    curl_close($ch);

    // Fallback: if SSL verification failed due to outdated cPanel CA bundle, retry without strict SSL peer check
    if ($response === false) {
        $ch2 = curl_init($targetUrl);
        curl_setopt($ch2, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch2, CURLOPT_POST, true);
        curl_setopt($ch2, CURLOPT_POSTFIELDS, $rawInput);
        curl_setopt($ch2, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch2, CURLOPT_TIMEOUT, 20);
        curl_setopt($ch2, CURLOPT_CONNECTTIMEOUT, 10);
        curl_setopt($ch2, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch2, CURLOPT_SSL_VERIFYHOST, 0);
        $response = curl_exec($ch2);
        $httpCode = (int)curl_getinfo($ch2, CURLINFO_HTTP_CODE);
        if (curl_errno($ch2)) {
            $response = false;
        }
        curl_close($ch2);
    }
}

// Fallback to stream_context if cURL extension is unavailable
if ($response === false || $response === null) {
    $opts = [
        'http' => [
            'method'        => 'POST',
            'header'        => implode("\r\n", $headers) . "\r\n",
            'content'       => $rawInput,
            'timeout'       => 20,
            'ignore_errors' => true
        ],
        'ssl' => [
            'verify_peer'      => false,
            'verify_peer_name' => false
        ]
    ];
    $context = stream_context_create($opts);
    $response = @file_get_contents($targetUrl, false, $context);
    if (isset($http_response_header) && is_array($http_response_header)) {
        foreach ($http_response_header as $hdr) {
            if (preg_match('#^HTTP/\d\.\d\s+(\d{3})#i', $hdr, $m)) {
                $httpCode = (int)$m[1];
                break;
            }
        }
    }
}

// 8. Propagate Status and Output to Client
// 8. Auto-Exchange token_hash for an active session if action was verify
if ($httpCode === 200 && $response !== false && $response !== null) {
    $decoded = json_decode((string)$response, true);
    if (is_array($decoded) && !empty($decoded['success']) && !empty($decoded['auth']['token_hash'])) {
        $tokenHash = $decoded['auth']['token_hash'];
        $verifyUrl = rtrim($supabaseUrl, '/') . '/auth/v1/verify';
        $vPayload = json_encode(['token_hash' => $tokenHash, 'type' => 'magiclink']);
        $vHeaders = [
            'Content-Type: application/json',
            'apikey: ' . $anonKey,
            'Authorization: Bearer ' . $anonKey
        ];

        $vRes = false;
        $vCode = 0;
        if (function_exists('curl_init')) {
            $vCh = curl_init($verifyUrl);
            curl_setopt($vCh, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($vCh, CURLOPT_POST, true);
            curl_setopt($vCh, CURLOPT_POSTFIELDS, $vPayload);
            curl_setopt($vCh, CURLOPT_HTTPHEADER, $vHeaders);
            curl_setopt($vCh, CURLOPT_TIMEOUT, 10);
            curl_setopt($vCh, CURLOPT_CONNECTTIMEOUT, 5);
            curl_setopt($vCh, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($vCh, CURLOPT_SSL_VERIFYHOST, 0);
            $vRes = curl_exec($vCh);
            $vCode = (int)curl_getinfo($vCh, CURLINFO_HTTP_CODE);
            curl_close($vCh);
        }
        if ($vCode === 200 && $vRes) {
            $vJson = json_decode((string)$vRes, true);
            if (is_array($vJson) && !empty($vJson['access_token'])) {
                $decoded['auth']['session'] = [
                    'access_token'  => $vJson['access_token'],
                    'refresh_token' => $vJson['refresh_token'] ?? null,
                    'expires_in'    => $vJson['expires_in'] ?? 3600,
                    'expires_at'    => $vJson['expires_at'] ?? (time() + 3600),
                    'token_type'    => $vJson['token_type'] ?? 'bearer',
                    'user'          => $vJson['user'] ?? null
                ];
                $response = json_encode($decoded);
            }
        }
    }
}

// 9. Propagate Status and Output to Client
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
http_response_code($httpCode > 0 ? $httpCode : 500);

if ($response !== false && $response !== null && strlen(trim((string)$response)) > 0) {
    echo $response;
} else {
    echo json_encode([
        'success' => false,
        'error'   => 'PROXY_TIMEOUT',
        'message' => 'Authentication gateway temporarily unavailable. Please try again.'
    ]);
}
