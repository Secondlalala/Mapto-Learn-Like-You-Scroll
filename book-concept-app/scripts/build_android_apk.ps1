param(
    [switch]$Offline,
    [switch]$KeepStaging
)

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repositoryRoot = (Resolve-Path (Join-Path $projectRoot '..')).Path
$source = Join-Path $projectRoot 'android-app'
$stage = "C:\mtl-build-$PID"
$expectedPrefix = 'C:\mtl-build-'
$stageFullPath = [System.IO.Path]::GetFullPath($stage)

if (-not $stageFullPath.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe staging path: $stageFullPath"
}
if (Test-Path -LiteralPath $stageFullPath) {
    throw "Staging path already exists: $stageFullPath"
}

& (Join-Path $PSScriptRoot 'check_android_environment.ps1')
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GITHUB_WORKSPACE = $repositoryRoot

if (Get-NetTCPConnection -LocalPort 7897 -State Listen -ErrorAction SilentlyContinue) {
    $proxy = 'http://127.0.0.1:7897'
    $env:HTTP_PROXY = $proxy
    $env:HTTPS_PROXY = $proxy
    $env:GRADLE_OPTS = '-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7897 -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7897'
    Write-Output 'Using local proxy 127.0.0.1:7897.'
}

$completed = $false
New-Item -ItemType Directory -Path $stageFullPath | Out-Null
try {
    robocopy $source $stageFullPath /E /R:2 /W:2 /XD node_modules .gradle build .cxx .tools .gradle-user-home /XF *.log /NFL /NDL /NJH /NJS /NP
    $robocopyExit = $LASTEXITCODE
    if ($robocopyExit -gt 7) { throw "robocopy failed with exit code $robocopyExit" }
    if (-not (Test-Path (Join-Path $stageFullPath 'android\gradlew.bat'))) {
        throw 'Staged Android project is incomplete.'
    }

    Push-Location $stageFullPath
    try {
        npm ci --no-audit --fund=false
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
        npm test -- --runInBand --testTimeout=15000
        if ($LASTEXITCODE -ne 0) { throw 'Android unit tests failed.' }
        npx tsc --noEmit
        if ($LASTEXITCODE -ne 0) { throw 'TypeScript validation failed.' }
        npm run lint
        if ($LASTEXITCODE -ne 0) { throw 'Lint failed.' }

        $gradleArguments = @('-p', '.\android', 'assembleRelease', '--no-daemon')
        if ($Offline) { $gradleArguments += '--offline' }
        & '.\android\gradlew.bat' @gradleArguments
        if ($LASTEXITCODE -ne 0) { throw 'Gradle release build failed.' }

        $apk = (Resolve-Path '.\android\app\build\outputs\apk\release\app-release.apk').Path
        if ((Get-Item $apk).Length -lt 60MB) {
            throw 'APK is too small to contain the bundled TTS runtime and model.'
        }

        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [System.IO.Compression.ZipFile]::OpenRead($apk)
        try {
            $abis = @($archive.Entries.FullName |
                Where-Object { $_ -match '^lib/[^/]+/' } |
                ForEach-Object { ($_ -split '/')[1] } |
                Sort-Object -Unique)
            $requiredEntries = @(
                'assets/index.android.bundle',
                'assets/vits-icefall-zh-aishell3/model.onnx',
                'assets/vits-icefall-zh-aishell3/lexicon.txt',
                'assets/vits-icefall-zh-aishell3/phone.fst',
                'assets/vits-icefall-zh-aishell3/date.fst',
                'assets/vits-icefall-zh-aishell3/number.fst',
                'assets/vits-icefall-zh-aishell3/new_heteronym.fst',
                'lib/arm64-v8a/libonnxruntime.so',
                'lib/arm64-v8a/libsherpa-onnx-jni.so',
                'assets/licenses/sherpa-onnx-APACHE-2.0.txt'
            )
            foreach ($entry in $requiredEntries) {
                if (-not $archive.GetEntry($entry)) { throw "APK entry is missing: $entry" }
            }
        } finally {
            $archive.Dispose()
        }
        if ($abis.Count -ne 1 -or $abis[0] -ne 'arm64-v8a') {
            throw "Expected only arm64-v8a, found: $($abis -join ', ')"
        }

        $apksigner = Join-Path $env:ANDROID_HOME 'build-tools\35.0.0\apksigner.bat'
        & $apksigner verify --verbose $apk
        if ($LASTEXITCODE -ne 0) { throw 'APK signature validation failed.' }

        $outputDirectory = Join-Path $repositoryRoot 'outputs'
        New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
        $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $output = Join-Path $outputDirectory "MapToLearn-release-arm64-$timestamp.apk"
        Copy-Item -LiteralPath $apk -Destination $output
        $hash = Get-FileHash $output -Algorithm SHA256
        Write-Output "APK=$output"
        Write-Output "SHA256=$($hash.Hash)"
        $completed = $true
    } finally {
        Pop-Location
    }
} finally {
    if ($completed -and -not $KeepStaging) {
        $resolvedStage = (Resolve-Path -LiteralPath $stageFullPath).Path
        if (-not $resolvedStage.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove unsafe staging path: $resolvedStage"
        }
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    } elseif (Test-Path -LiteralPath $stageFullPath) {
        Write-Output "Staging retained at $stageFullPath"
    }
}
