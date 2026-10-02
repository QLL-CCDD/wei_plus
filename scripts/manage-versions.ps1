param(
  [ValidateSet('Start','Stop','Status','Diagnose')][string]$Action = 'Start',
  [ValidateSet('current','legacy')][string]$Ruleset = 'current',
  [switch]$OpenBrowser
)
$ErrorActionPreference = 'Stop'
$gameRoot = Split-Path -Parent $PSScriptRoot
$outputsRoot = Split-Path -Parent $gameRoot
$nodeDir = Join-Path $outputsRoot 'runtime\node-v24.21.0-win-x64'
$nodeExe = Join-Path $nodeDir 'node.exe'
$serverScript = Join-Path $gameRoot 'server\index.js'
$stateDir = Join-Path $gameRoot '.local'
$logDir = Join-Path $gameRoot 'logs'
$profiles = @(
  @{ Id='current'; Port=3000; OtherPort=3001; Data=(Join-Path $gameRoot 'data'); State=(Join-Path $stateDir 'server-process.json') },
  @{ Id='legacy'; Port=3001; OtherPort=3000; Data=(Join-Path $gameRoot 'data\legacy'); State=(Join-Path $stateDir 'server-process-legacy.json') }
)
if (Test-Path -LiteralPath $nodeExe) {
  $env:Path = $nodeDir + ';' + $env:Path
} else {
  $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $systemNode) { throw 'Install Node.js 22/24 first: https://nodejs.org/zh-cn/download' }
  $nodeExe = $systemNode.Source
}
$env:HOST = '0.0.0.0'
$env:SP_COMBAT = 'client'
$env:SP_VERIFY = 'off'
$env:TRUST_PROXY = 'auto'

function Get-GameHealth($profile) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($profile.Port)/healthz" -TimeoutSec 2
    if ($health.ok -eq $true -and $health.app -eq '0.1.0' -and (($health.ruleset -eq $profile.Id) -or (-not $health.ruleset -and $profile.Id -eq 'current'))) { return $health }
  } catch { }
  return $null
}
function Show-GameStatus($profile) {
  $health = Get-GameHealth $profile
  if ($health) {
    Write-Host "$($profile.Id): http://localhost:$($profile.Port)" -ForegroundColor Green
    $health | ConvertTo-Json -Compress | Write-Host
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } |
      ForEach-Object { Write-Host "LAN: http://$($_.IPAddress):$($profile.Port) ($($_.InterfaceAlias))" }
  } else { Write-Host "$($profile.Id): stopped" }
}

if (-not (Test-Path -LiteralPath $nodeExe)) { throw "Node.js is missing: $nodeExe" }
Set-Location -LiteralPath $gameRoot
if ($Action -eq 'Diagnose') {
  foreach ($profile in $profiles) { & $nodeExe tools\doctor.mjs --port $profile.Port; Show-GameStatus $profile }
  exit $LASTEXITCODE
}
if ($Action -eq 'Status') { foreach ($profile in $profiles) { Show-GameStatus $profile }; exit 0 }
if ($Action -eq 'Stop') {
  foreach ($profile in $profiles) {
    if (-not (Test-Path -LiteralPath $profile.State)) {
      if (Get-GameHealth $profile) { throw "$($profile.Id) is running without this launcher state. Close its original console to stop it." }
      continue
    }
    $savedProcess = Get-Content -LiteralPath $profile.State -Raw | ConvertFrom-Json
    $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$savedProcess.ProcessId)" -ErrorAction SilentlyContinue
    if ($serverProcess) {
      if ($serverProcess.ExecutablePath -ine $nodeExe -or $serverProcess.CommandLine.IndexOf($serverScript,[StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw 'Saved process no longer belongs to this game. Refusing to stop a different application.'
      }
      Stop-Process -Id $serverProcess.ProcessId -ErrorAction Stop
    }
    Remove-Item -LiteralPath $profile.State -ErrorAction SilentlyContinue
  }
  Write-Host 'Both game versions have stopped. Existing matches have ended.'
  exit 0
}

& $nodeExe tools\setup.mjs --no-local --quiet
if ($LASTEXITCODE -ne 0) { throw 'Game preparation failed.' }
foreach ($manifest in @('assets.json','emotes.json','local-assets.json')) {
  $sourceManifest = Join-Path $gameRoot "data\$manifest"
  if (Test-Path -LiteralPath $sourceManifest) { Copy-Item -LiteralPath $sourceManifest -Destination (Join-Path $gameRoot "data\legacy\$manifest") -Force }
}
New-Item -ItemType Directory -Path $stateDir,$logDir -Force | Out-Null
foreach ($profile in $profiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $profile.Data 'config.json'))) { throw "Game data is missing: $($profile.Data)" }
  if (-not (Get-GameHealth $profile)) {
    if (@(Get-NetTCPConnection -LocalPort $profile.Port -State Listen -ErrorAction SilentlyContinue).Count -gt 0) { throw "Port $($profile.Port) is already occupied by another application." }
    $env:PORT = [string]$profile.Port
    $env:SP_DATA_DIR = $profile.Data
    $env:SP_ALTERNATE_PORT = [string]$profile.OtherPort
    $logStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdoutLog = Join-Path $logDir "$($profile.Id)-$logStamp.log"
    $stderrLog = Join-Path $logDir "$($profile.Id)-$logStamp.err.log"
    $serverProcess = Start-Process -FilePath $nodeExe -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $gameRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
    [pscustomobject]@{ ProcessId=$serverProcess.Id; Ruleset=$profile.Id; StartedUtc=[DateTime]::UtcNow.ToString('o'); Stdout=$stdoutLog; Stderr=$stderrLog } |
      ConvertTo-Json | Set-Content -LiteralPath $profile.State -Encoding UTF8
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
      Start-Sleep -Milliseconds 250
      $health = Get-GameHealth $profile
      $serverProcess.Refresh()
    } while (-not $health -and -not $serverProcess.HasExited -and [DateTime]::UtcNow -lt $deadline)
    if (-not $health) { throw "The $($profile.Id) game did not start. See $stderrLog" }
  }
  Show-GameStatus $profile
}
if ($OpenBrowser) { $selected = $profiles | Where-Object { $_.Id -eq $Ruleset }; Start-Process "http://localhost:$($selected.Port)" }
