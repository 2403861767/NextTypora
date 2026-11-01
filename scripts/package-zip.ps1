$ErrorActionPreference = "Stop"

$root = Join-Path $PSScriptRoot ".."
$source = Join-Path $root "release\win-unpacked"

# 版本号的唯一来源是 package.json，和 electron-builder 的 artifactName 保持一致。
# 之前这个 zip 叫 NextTyproa-win-x64.zip（旧拼写），不带版本号——拿到文件就认不出是哪个构建，
# 正是 1.0.2 被手工改名那类问题的同一面。见 .scratch/v1.0.3/issues/06-...
$version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
if (-not $version) {
  Write-Error "Could not read version from package.json"
  exit 1
}
$dest = Join-Path $root "release\NextTypora-$version-win-x64.zip"

if (-not (Test-Path (Join-Path $source "NextTypora.exe"))) {
  Write-Error "NextTypora.exe not found. Run: npm run dist:dir"
  exit 1
}

if (Test-Path $dest) { Remove-Item $dest -Force }
Compress-Archive -Path "$source\*" -DestinationPath $dest -Force
Write-Host "Created: $dest"
