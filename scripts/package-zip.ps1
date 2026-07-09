$source = Join-Path $PSScriptRoot "..\release\win-unpacked"
$dest = Join-Path $PSScriptRoot "..\release\NextTyproa-win-x64.zip"

if (-not (Test-Path (Join-Path $source "NextTyproa.exe"))) {
  Write-Error "NextTyproa.exe not found. Run: npm run dist:dir"
  exit 1
}

if (Test-Path $dest) { Remove-Item $dest -Force }
Compress-Archive -Path "$source\*" -DestinationPath $dest -Force
Write-Host "Created: $dest"
