# Recycle Bin inspection for item 9 (the Storage cleanup must TRASH the backup dirs,
# not delete them). ASCII only.
#
#   list                      every item currently in the bin (name + original path)
#   match -Needle "<text>"    only items whose original path contains the needle

param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$Needle = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$shell = New-Object -ComObject Shell.Application
$bin = $shell.Namespace(10)
if ($null -eq $bin) { throw 'cannot open the Recycle Bin namespace' }

$rows = @()
foreach ($item in $bin.Items()) {
  # 0 = Name, 1 = original location (localized column names vary; indexes do not)
  $orig = $bin.GetDetailsOf($item, 1)
  $date = $bin.GetDetailsOf($item, 2)
  $rows += [pscustomobject]@{ Name = $item.Name; Original = $orig; Deleted = $date }
}

switch ($Action.ToLower()) {
  'list' { $rows | ForEach-Object { "{0} | {1} | {2}" -f $_.Name, $_.Original, $_.Deleted } }
  'match' {
    $hit = $rows | Where-Object { $_.Original -like "*$Needle*" -or $_.Name -like "*$Needle*" }
    if (-not $hit) { 'none' } else { $hit | ForEach-Object { "{0} | {1} | {2}" -f $_.Name, $_.Original, $_.Deleted } }
  }
  default { throw "unknown action '$Action'" }
}
