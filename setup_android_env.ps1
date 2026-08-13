# Set ANDROID_HOME
[System.Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
Write-Output "ANDROID_HOME = $env:LOCALAPPDATA\Android\Sdk"

# Set ANDROID_SDK_ROOT
[System.Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", "$env:LOCALAPPDATA\Android\Sdk", "User")
Write-Output "ANDROID_SDK_ROOT = $env:LOCALAPPDATA\Android\Sdk"

# Add platform-tools to PATH
$adbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools"
$oldPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
if ($oldPath -notlike "*$adbPath*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$oldPath;$adbPath", "User")
    Write-Output "Added $adbPath to User PATH"
} else {
    Write-Output "platform-tools already in PATH"
}

Write-Output ""
Write-Output "Environment variables set successfully!"
Write-Output "Please RESTART your terminal for changes to take effect."
