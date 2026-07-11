$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Python = Join-Path $Backend ".venv\Scripts\python.exe"

Push-Location $Frontend
npm run build
Pop-Location

Push-Location $Backend
& $Python -m pip install pyinstaller
Pop-Location

Push-Location $Root
& $Python -m PyInstaller .\BookConceptApp.spec --noconfirm
Pop-Location

Write-Host "Done: $Root\dist\BookConceptApp\BookConceptApp.exe"
