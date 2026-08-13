# Set environment variables for current session
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:Path;$env:LOCALAPPDATA\Android\Sdk\platform-tools"

Write-Output "ANDROID_HOME = $env:ANDROID_HOME"
Write-Output "ANDROID_SDK_ROOT = $env:ANDROID_SDK_ROOT"

# Check if adb is accessible
$adbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (Test-Path $adbPath) {
    Write-Output "adb found at: $adbPath"
    & $adbPath --version
} else {
    Write-Error "adb.exe not found!"
    exit 1
}

Write-Output ""
Write-Output "Starting Expo for Android..."
Write-Output "After the Metro bundler starts, press 'a' to open on Android emulator"
Write-Output ""

# Start Expo
npx expo start --android

