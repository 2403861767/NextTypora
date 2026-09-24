param(
  [string]$BaseUrl = "http://127.0.0.1:8080",
  [string]$Token = $env:AUTH_TOKEN,
  [string]$VaultPath = "$env:TEMP\nexttyproa-smoke-vault"
)

if (-not $Token) { throw "Pass -Token <token> (printed by npm run dev, or NEXTTYPROA_TOKEN= in the backend log)" }

$headers = @{ "X-Auth-Token" = $Token; "Content-Type" = "application/json" }

function Invoke-Api {
  param([string]$Method, [string]$Path, [object]$Body)
  $params = @{
    Uri = "$BaseUrl$Path"
    Method = $Method
    Headers = $headers
  }
  if ($Body) { $params.Body = ($Body | ConvertTo-Json -Compress) }
  return Invoke-RestMethod @params
}

Write-Host "1. Health check..."
$health = Invoke-RestMethod "$BaseUrl/api/health"
if ($health.status -ne "UP") { throw "Health check failed" }

Write-Host "2. Set workspace: $VaultPath"
New-Item -ItemType Directory -Force -Path $VaultPath | Out-Null
Invoke-Api POST "/api/workspace" @{ path = $VaultPath } | Out-Null
try { Invoke-Api DELETE "/api/note?path=smoke-test.md" | Out-Null } catch { }

Write-Host "3. Create note..."
$note = Invoke-Api POST "/api/note" @{ path = "smoke-test.md"; content = "# Smoke Test`n`nHello springboot integration." }
if ($note.title -ne "Smoke Test") { throw "Unexpected title: $($note.title)" }

Write-Host "4. Read note..."
$read = Invoke-Api GET "/api/note?path=smoke-test.md"
if ($read.content -notmatch "springboot") { throw "Read content mismatch" }

Write-Host "5. Search..."
$deadline = (Get-Date).AddSeconds(30)
$results = @()
$total = 0
do {
  $search = Invoke-Api GET "/api/search?q=springboot"
  $results = if ($search.PSObject.Properties.Name -contains "results") { @($search.results) } else { @($search) }
  $total = if ($search.PSObject.Properties.Name -contains "total") { [int]$search.total } else { $results.Count }
  if ($total -ge 1 -or $results.Count -ge 1) { break }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
if ($total -lt 1 -and $results.Count -lt 1) { throw "Search returned no results after waiting for indexing" }

Write-Host "6. Delete note..."
Invoke-Api DELETE "/api/note?path=smoke-test.md" | Out-Null

Write-Host "All smoke tests passed."
