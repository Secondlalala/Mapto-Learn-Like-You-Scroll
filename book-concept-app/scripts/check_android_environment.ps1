$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$env:JAVA_HOME = Join-Path $repositoryRoot '.tools\jdk-17'
$env:ANDROID_HOME = Join-Path $repositoryRoot '.tools\android-sdk'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js is not available on PATH.'
}
node --version

$java = Join-Path $env:JAVA_HOME 'bin\java.exe'
if (-not (Test-Path $java)) {
    throw "JDK 17 was not found at $env:JAVA_HOME."
}
$releaseFile = Join-Path $env:JAVA_HOME 'release'
if (-not (Test-Path $releaseFile)) {
    throw "JDK release metadata was not found at $releaseFile."
}
$javaVersion = Get-Content -Raw $releaseFile
if ($javaVersion -notmatch 'JAVA_VERSION="17(?:\.|\")') {
    throw "Expected JDK 17, received: $javaVersion"
}
Write-Output 'JDK 17 verified.'

$sdkManager = Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin\sdkmanager.bat'
$androidPlatform = Join-Path $env:ANDROID_HOME 'platforms\android-35\android.jar'
$buildTools = Join-Path $env:ANDROID_HOME 'build-tools\35.0.0'
$adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'

if (-not (Test-Path $sdkManager)) { throw 'Android command-line tools are missing.' }
if (-not (Test-Path $androidPlatform)) { throw 'Android SDK platform 35 is missing.' }
if (-not (Test-Path $buildTools)) { throw 'Android build-tools 35.0.0 are missing.' }
if (-not (Test-Path $adb)) { throw 'Android platform-tools are missing.' }

Write-Output "JAVA_HOME=$env:JAVA_HOME"
Write-Output "ANDROID_HOME=$env:ANDROID_HOME"
Write-Output 'Android SDK requirements verified.'
