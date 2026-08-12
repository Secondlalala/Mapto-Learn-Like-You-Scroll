param(
    [ValidateSet("Gui", "Start", "Stop", "Status")]
    [string]$Action = "Gui",
    [switch]$NoBrowser,
    [switch]$KeepAlive
)

$ErrorActionPreference = "Stop"

function Resolve-PhysicalPath {
    param([Parameter(Mandatory)][string]$Path)

    $fullPath = [IO.Path]::GetFullPath($Path)
    $cursor = Get-Item -LiteralPath $fullPath -ErrorAction Stop
    while ($cursor) {
        if ($cursor.LinkType -in @("Junction", "SymbolicLink") -and $cursor.Target) {
            $target = @($cursor.Target)[0]
            $relative = [IO.Path]::GetRelativePath($cursor.FullName, $fullPath)
            return [IO.Path]::GetFullPath((Join-Path $target $relative))
        }
        $cursor = $cursor.Parent
    }
    return $fullPath
}

$RequestedProjectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$ProjectRoot = Resolve-PhysicalPath $RequestedProjectRoot
$ProjectRootAliases = @($ProjectRoot, $RequestedProjectRoot) | Select-Object -Unique
$BackendRoot = Join-Path $ProjectRoot "backend"
$FrontendRoot = Join-Path $ProjectRoot "frontend"
$RuntimeRoot = Join-Path $env:LOCALAPPDATA "MapToLearn"
$LogRoot = Join-Path $RuntimeRoot "logs"
$StatePath = Join-Path $RuntimeRoot "launcher-state.json"
$BackendPort = 8000
$FrontendPort = 5173
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:VITE_API_BASE = "http://127.0.0.1:$BackendPort"

New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null

function Get-PortOwner {
    param([int]$Port)
    try {
        return (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
            Select-Object -First 1 -ExpandProperty OwningProcess)
    } catch {
        return $null
    }
}

function Test-MaterialContainsProjectRoot {
    param([string]$Material)
    foreach ($root in $ProjectRootAliases) {
        if ($Material.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return $true
        }
    }
    return $false
}

function Test-ProcessBelongsToProject {
    param([int]$ProcessId)
    $cursor = $ProcessId
    for ($depth = 0; $depth -lt 12 -and $cursor -gt 0; $depth++) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $cursor" -ErrorAction SilentlyContinue
        if (-not $process) { return $false }
        $material = "$($process.ExecutablePath)`n$($process.CommandLine)"
        if (Test-MaterialContainsProjectRoot $material) {
            return $true
        }
        $cursor = [int]$process.ParentProcessId
    }
    return $false
}

function Get-OwnedProcessRoot {
    param([int]$ProcessId)
    $cursor = $ProcessId
    $candidate = $null
    for ($depth = 0; $depth -lt 12 -and $cursor -gt 0; $depth++) {
        if ($cursor -eq $PID) { break }
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $cursor" -ErrorAction SilentlyContinue
        if (-not $process) { break }
        $material = "$($process.ExecutablePath)`n$($process.CommandLine)"
        if (Test-MaterialContainsProjectRoot $material) {
            $candidate = $cursor
        }
        $cursor = [int]$process.ParentProcessId
    }
    return $candidate
}

function Stop-VerifiedProcessTree {
    param([int]$ProcessId)
    if ($ProcessId -le 0 -or $ProcessId -eq $PID) { return }
    if (-not (Test-ProcessBelongsToProject $ProcessId)) {
        throw "拒绝关闭 PID $ProcessId：无法确认它属于 MapToLearn。"
    }

    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $children = @{}
    foreach ($process in $all) {
        $parent = [int]$process.ParentProcessId
        if (-not $children.ContainsKey($parent)) { $children[$parent] = [Collections.Generic.List[int]]::new() }
        $children[$parent].Add([int]$process.ProcessId)
    }
    $ordered = [Collections.Generic.List[int]]::new()
    function Add-TreePostOrder([int]$Current) {
        if ($children.ContainsKey($Current)) {
            foreach ($child in $children[$Current]) { Add-TreePostOrder $child }
        }
        $ordered.Add($Current)
    }
    Add-TreePostOrder $ProcessId
    foreach ($id in $ordered) {
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
}

function Wait-ForPort {
    param([int]$Port, [bool]$ShouldBeOpen, [int]$TimeoutSeconds = 30)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $isOpen = $null -ne (Get-PortOwner $Port)
        if ($isOpen -eq $ShouldBeOpen) { return $true }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    return $false
}

function Wait-ForHttp {
    param([string]$Url, [int]$TimeoutSeconds = 20)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { return $true }
        } catch {}
        Start-Sleep -Milliseconds 300
    } while ([DateTime]::UtcNow -lt $deadline)
    return $false
}

function Get-AppStatus {
    $backendPid = Get-PortOwner $BackendPort
    $frontendPid = Get-PortOwner $FrontendPort
    return [pscustomobject]@{
        BackendRunning = $null -ne $backendPid
        BackendPid = $backendPid
        BackendOwned = $null -ne $backendPid -and (Test-ProcessBelongsToProject $backendPid)
        FrontendRunning = $null -ne $frontendPid
        FrontendPid = $frontendPid
        FrontendOwned = $null -ne $frontendPid -and (Test-ProcessBelongsToProject $frontendPid)
    }
}

function Save-State {
    param([Nullable[int]]$BackendPid, [Nullable[int]]$FrontendPid)
    @{
        projectRoot = $ProjectRoot
        backendPid = $BackendPid
        frontendPid = $FrontendPid
        savedAt = [DateTime]::UtcNow.ToString("o")
    } | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
}

function Start-App {
    $status = Get-AppStatus
    if ($status.BackendRunning -and -not $status.BackendOwned) {
        throw "端口 $BackendPort 已被其他程序占用（PID $($status.BackendPid)）。"
    }
    if ($status.FrontendRunning -and -not $status.FrontendOwned) {
        throw "端口 $FrontendPort 已被其他程序占用（PID $($status.FrontendPid)）。"
    }

    $backendPid = if ($status.BackendRunning) { Get-OwnedProcessRoot $status.BackendPid } else { $null }
    $frontendPid = if ($status.FrontendRunning) { Get-OwnedProcessRoot $status.FrontendPid } else { $null }

    if (-not $status.BackendRunning) {
        $python = Join-Path $BackendRoot ".venv\Scripts\python.exe"
        if (-not (Test-Path -LiteralPath $python)) { throw "后端 Python 环境不存在：$python" }
        $backend = Start-Process -FilePath $python `
            -ArgumentList @("-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "$BackendPort") `
            -WorkingDirectory $BackendRoot -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $LogRoot "backend.out.log") `
            -RedirectStandardError (Join-Path $LogRoot "backend.err.log") -PassThru
        $backendPid = $backend.Id
        if (-not (Wait-ForPort $BackendPort $true)) { throw "后端启动超时，请检查日志。" }
        if (-not (Wait-ForHttp "http://127.0.0.1:$BackendPort/api/health")) { throw "后端健康检查失败，请检查日志。" }
    }

    if (-not $status.FrontendRunning) {
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        $vite = Join-Path $FrontendRoot "node_modules\vite\bin\vite.js"
        if (-not (Test-Path -LiteralPath $vite)) {
            throw "前端依赖尚未安装，请先在 frontend 目录运行 npm install。"
        }
        $frontend = Start-Process -FilePath $node `
            -ArgumentList @($vite, "--host", "127.0.0.1", "--port", "$FrontendPort") `
            -WorkingDirectory $FrontendRoot -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $LogRoot "frontend.out.log") `
            -RedirectStandardError (Join-Path $LogRoot "frontend.err.log") -PassThru
        $frontendPid = $frontend.Id
        if (-not (Wait-ForPort $FrontendPort $true)) { throw "前端启动超时，请检查日志。" }
        if (-not (Wait-ForHttp "http://127.0.0.1:$FrontendPort/")) { throw "前端健康检查失败，请检查日志。" }
    }

    Save-State $backendPid $frontendPid
    if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$FrontendPort/" }
    return Get-AppStatus
}

function Stop-App {
    $roots = [Collections.Generic.HashSet[int]]::new()
    if (Test-Path -LiteralPath $StatePath) {
        try {
            $state = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($candidate in @($state.backendPid, $state.frontendPid)) {
                if ($candidate -and (Test-ProcessBelongsToProject ([int]$candidate))) {
                    [void]$roots.Add([int]$candidate)
                }
            }
        } catch {}
    }
    foreach ($port in @($BackendPort, $FrontendPort)) {
        $owner = Get-PortOwner $port
        if ($owner -and (Test-ProcessBelongsToProject $owner)) {
            $root = Get-OwnedProcessRoot $owner
            if ($root) { [void]$roots.Add([int]$root) }
        }
    }
    foreach ($root in $roots) { Stop-VerifiedProcessTree $root }
    Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    [void](Wait-ForPort $BackendPort $false 10)
    [void](Wait-ForPort $FrontendPort $false 10)
    return Get-AppStatus
}

function Format-Status {
    param($Status)
    $backend = if ($Status.BackendRunning) { "运行中 (PID $($Status.BackendPid))" } else { "已关闭" }
    $frontend = if ($Status.FrontendRunning) { "运行中 (PID $($Status.FrontendPid))" } else { "已关闭" }
    return "后端：$backend`n前端：$frontend"
}

function Show-ControlPanel {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    if (-not ("MapToLearn.NativeWindow" -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace MapToLearn {
    public static class NativeWindow {
        [DllImport("kernel32.dll")]
        public static extern IntPtr GetConsoleWindow();

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    }
}
"@
    }

    $form = [Windows.Forms.Form]::new()
    $form.Text = "MapToLearn 应用控制"
    $form.ClientSize = [Drawing.Size]::new(430, 270)
    $form.StartPosition = "CenterScreen"
    $form.ShowInTaskbar = $true
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false
    $form.BackColor = [Drawing.Color]::FromArgb(247, 247, 245)
    $form.Font = [Drawing.Font]::new("Microsoft YaHei UI", 10)

    $title = [Windows.Forms.Label]::new()
    $title.Text = "MapToLearn"
    $title.Font = [Drawing.Font]::new("Microsoft YaHei UI", 19, [Drawing.FontStyle]::Bold)
    $title.Location = [Drawing.Point]::new(24, 18)
    $title.AutoSize = $true
    $form.Controls.Add($title)

    $statusLabel = [Windows.Forms.Label]::new()
    $statusLabel.Location = [Drawing.Point]::new(26, 66)
    $statusLabel.Size = [Drawing.Size]::new(380, 52)
    $form.Controls.Add($statusLabel)

    $message = [Windows.Forms.Label]::new()
    $message.Location = [Drawing.Point]::new(26, 218)
    $message.Size = [Drawing.Size]::new(378, 34)
    $message.ForeColor = [Drawing.Color]::FromArgb(90, 90, 90)
    $form.Controls.Add($message)

    $startButton = [Windows.Forms.Button]::new()
    $startButton.Text = "启动应用"
    $startButton.Location = [Drawing.Point]::new(26, 132)
    $startButton.Size = [Drawing.Size]::new(116, 48)
    $startButton.BackColor = [Drawing.Color]::FromArgb(32, 32, 30)
    $startButton.ForeColor = [Drawing.Color]::White
    $startButton.FlatStyle = "Flat"
    $form.Controls.Add($startButton)

    $stopButton = [Windows.Forms.Button]::new()
    $stopButton.Text = "关闭应用"
    $stopButton.Location = [Drawing.Point]::new(157, 132)
    $stopButton.Size = [Drawing.Size]::new(116, 48)
    $form.Controls.Add($stopButton)

    $openButton = [Windows.Forms.Button]::new()
    $openButton.Text = "打开网页"
    $openButton.Location = [Drawing.Point]::new(288, 132)
    $openButton.Size = [Drawing.Size]::new(116, 48)
    $form.Controls.Add($openButton)

    $uiState = @{
        ActionProcess = $null
        SupervisorProcess = $null
        PendingAction = $null
        OpenAfterStart = $false
        ActionErrorLog = $null
    }

    $startBackgroundAction = {
        param([ValidateSet("Start", "Stop")][string]$RequestedAction)
        if ($uiState.ActionProcess -and -not $uiState.ActionProcess.HasExited) {
            throw "已有启动或关闭操作正在执行。"
        }
        $actionName = $RequestedAction.ToLowerInvariant()
        $actionOutputLog = Join-Path $LogRoot "controller-$actionName.out.log"
        $actionErrorLog = Join-Path $LogRoot "controller-$actionName.err.log"
        Remove-Item -LiteralPath $actionOutputLog -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $actionErrorLog -Force -ErrorAction SilentlyContinue
        $pwsh = (Get-Process -Id $PID).Path
        $arguments = @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", $PSCommandPath,
            "-Action", $RequestedAction,
            "-NoBrowser"
        )
        if ($RequestedAction -eq "Start") { $arguments += "-KeepAlive" }
        $uiState.ActionProcess = Start-Process -FilePath $pwsh -ArgumentList $arguments `
            -WindowStyle Hidden `
            -RedirectStandardOutput $actionOutputLog `
            -RedirectStandardError $actionErrorLog -PassThru
        $uiState.PendingAction = $RequestedAction
        $uiState.ActionErrorLog = $actionErrorLog
    }

    $refresh = {
        $current = Get-AppStatus
        $statusLabel.Text = Format-Status $current
        $actionRunning = $uiState.ActionProcess -and -not $uiState.ActionProcess.HasExited
        $startButton.Enabled = -not $actionRunning -and -not ($current.BackendRunning -and $current.FrontendRunning)
        $stopButton.Enabled = -not $actionRunning -and ($current.BackendRunning -or $current.FrontendRunning)
        $openButton.Enabled = $current.FrontendRunning

        if ($uiState.PendingAction -eq "Start" -and $current.BackendRunning -and $current.FrontendRunning) {
            $message.Text = "应用已启动。"
            $uiState.SupervisorProcess = $uiState.ActionProcess
            $uiState.ActionProcess = $null
            $uiState.PendingAction = $null
            if ($uiState.OpenAfterStart) {
                $uiState.OpenAfterStart = $false
                Start-Process "http://127.0.0.1:$FrontendPort/"
            }
        } elseif ($uiState.PendingAction -eq "Stop" -and -not $current.BackendRunning -and -not $current.FrontendRunning) {
            $message.Text = "应用已关闭。"
            $uiState.ActionProcess = $null
            $uiState.SupervisorProcess = $null
            $uiState.PendingAction = $null
        } elseif ($uiState.PendingAction -and $uiState.ActionProcess -and $uiState.ActionProcess.HasExited) {
            $errorText = if (Test-Path -LiteralPath $uiState.ActionErrorLog) {
                (Get-Content -LiteralPath $uiState.ActionErrorLog -Raw -Encoding UTF8).Trim()
            } else { "" }
            if ([string]::IsNullOrWhiteSpace($errorText)) {
                $errorText = "操作未完成，请查看 $LogRoot。"
            }
            $message.Text = $errorText
            $uiState.PendingAction = $null
            $uiState.OpenAfterStart = $false
        }
    }
    $startButton.Add_Click({
        $startButton.Enabled = $false
        $message.Text = "正在启动，请稍候..."
        try {
            $uiState.OpenAfterStart = $true
            & $startBackgroundAction "Start"
        }
        catch { $message.Text = $_.Exception.Message }
        & $refresh
    })
    $stopButton.Add_Click({
        $stopButton.Enabled = $false
        $message.Text = "正在关闭..."
        try { & $startBackgroundAction "Stop" }
        catch { $message.Text = $_.Exception.Message }
        & $refresh
    })
    $openButton.Add_Click({ Start-Process "http://127.0.0.1:$FrontendPort/" })

    $timer = [Windows.Forms.Timer]::new()
    $timer.Interval = 1500
    $timer.Add_Tick($refresh)
    $timer.Start()
    $form.Add_FormClosed({ $timer.Stop(); $timer.Dispose() })
    & $refresh

    [void]$form.Handle
    $consoleWindow = [MapToLearn.NativeWindow]::GetConsoleWindow()
    if ($consoleWindow -ne [IntPtr]::Zero) {
        [void][MapToLearn.NativeWindow]::ShowWindow($consoleWindow, 0)
    }
    $workingArea = [Windows.Forms.Screen]::FromControl($form).WorkingArea
    $form.Location = [Drawing.Point]::new(
        $workingArea.Left + [Math]::Max(0, [int](($workingArea.Width - $form.Width) / 2)),
        $workingArea.Top + [Math]::Max(0, [int](($workingArea.Height - $form.Height) / 2))
    )
    $form.WindowState = [Windows.Forms.FormWindowState]::Normal
    $form.Show()
    [void][MapToLearn.NativeWindow]::ShowWindow($form.Handle, 5)
    [void][MapToLearn.NativeWindow]::ShowWindow($form.Handle, 5)
    $form.TopMost = $true
    $form.Activate()
    $form.BringToFront()
    [Windows.Forms.Application]::Run($form)
}

switch ($Action) {
    "Start" {
        Format-Status (Start-App)
        if ($KeepAlive) {
            while ((Get-AppStatus).BackendRunning -or (Get-AppStatus).FrontendRunning) {
                Start-Sleep -Seconds 2
            }
        }
    }
    "Stop" { Format-Status (Stop-App) }
    "Status" { Format-Status (Get-AppStatus) }
    default { Show-ControlPanel }
}
