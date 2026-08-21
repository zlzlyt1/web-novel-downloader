# Dev helper: syntax check -> restart Electron -> verify window
# Usage: run from project root, e.g.  .\dev-restart.ps1
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "== 1/3 Syntax check ==" -ForegroundColor Cyan
$files = @(
  'main.js',
  'preload.js',
  'src/renderer/app.js',
  'src/renderer/reader.js',
  'src/renderer/markdown.js',
  'src/renderer/paragraph-optimizer.js',
  'scripts/optimize-paragraphs.js',
  'scripts/test-paragraph-optimizer.js',
  'scripts/test-web-search.js',
  'scripts/test-generic-crawler.js'
  'scripts/test-fanqie-directory.js'
)
$bad = 0
foreach ($f in $files) {
  if (Test-Path $f) {
    node --check $f
    if ($LASTEXITCODE -ne 0) { Write-Host "  [X] $f FAILED" -ForegroundColor Red; $bad = 1 }
    else { Write-Host "  [OK] $f" -ForegroundColor DarkGray }
  }
}
if ($bad) { Write-Host "Syntax errors; aborting launch." -ForegroundColor Red; exit 1 }
Write-Host "  all passed" -ForegroundColor Green

Write-Host "== 2/3 Restart Electron ==" -ForegroundColor Cyan
Get-Process electron, '番茄小说下载器', '全网小说下载器' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
Start-Process -FilePath "$root\node_modules\electron\dist\electron.exe" -ArgumentList $root -WorkingDirectory $root

Write-Host "== 3/3 Verify window ==" -ForegroundColor Cyan
Start-Sleep -Seconds 3
$wins = @(Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle })
if ($wins.Count -gt 0) {
  $wins | Select-Object Id, MainWindowTitle | Format-Table -AutoSize
  Write-Host "OK: window(s) started." -ForegroundColor Green
} else {
  Write-Host "Warning: no main window detected." -ForegroundColor Yellow
}
