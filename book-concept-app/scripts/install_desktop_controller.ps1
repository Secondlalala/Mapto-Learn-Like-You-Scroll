$ErrorActionPreference = "Stop"

$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$controller = Join-Path $PSScriptRoot "MapToLearnControl.ps1"
$desktopSource = Join-Path $PSScriptRoot "MapToLearnDesktop.cs"
$desktopExecutable = Join-Path $PSScriptRoot "MapToLearnControl.exe"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "MapToLearn 启停控制.lnk"

if (-not (Test-Path -LiteralPath $controller)) {
    throw "控制器脚本不存在：$controller"
}
if (-not (Test-Path -LiteralPath $desktopSource)) {
    throw "桌面控制器源码不存在：$desktopSource"
}

$compiler = Join-Path $env:SystemRoot "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $compiler)) {
    $compiler = Join-Path $env:SystemRoot "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path -LiteralPath $compiler)) {
    throw "找不到 Windows C# 编译器。"
}

& $compiler /nologo /target:winexe /optimize+ /codepage:65001 `
    /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
    "/out:$desktopExecutable" $desktopSource
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $desktopExecutable)) {
    throw "桌面控制器编译失败。"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $desktopExecutable
$shortcut.Arguments = ""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = "启动或关闭 MapToLearn 网页应用"
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,167"
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Output $shortcutPath
