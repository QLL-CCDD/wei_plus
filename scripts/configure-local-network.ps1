$ErrorActionPreference = 'Stop'
$gameRoot = Split-Path -Parent $PSScriptRoot
$outputsRoot = Split-Path -Parent $gameRoot
$nodeExe = Join-Path $outputsRoot 'runtime\node-v24.21.0-win-x64\node.exe'
$stateDir = Join-Path $gameRoot '.local'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$resultFile = Join-Path $stateDir 'network-configuration.json'
try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator rights are required to add the Windows Firewall rule.' }
  if (-not (Test-Path -LiteralPath $nodeExe)) { throw 'Installed Node.js runtime is missing.' }
  $ruleName = 'StrongholdProtocolLocal'
  $existingRule = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
  if ($existingRule) { Remove-NetFirewallRule -Name $ruleName }
  New-NetFirewallRule -Name $ruleName -DisplayName 'Stronghold Protocol' -Description 'Current and legacy game servers: TCP 3000/3001, installed Node.js, connections from the local subnet only.' -Direction Inbound -Action Allow -Enabled True -Profile Any -Program $nodeExe -Protocol TCP -LocalPort 3000,3001 -RemoteAddress LocalSubnet | Out-Null
  $rule = Get-NetFirewallRule -Name $ruleName
  [pscustomobject]@{ Success=$true; RuleName=$rule.Name; Profile=[string]$rule.Profile; Port=@(3000,3001); RemoteAddress='LocalSubnet'; Program=$nodeExe; CompletedUtc=[DateTime]::UtcNow.ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $resultFile -Encoding UTF8
} catch {
  [pscustomobject]@{ Success=$false; Error=$_.Exception.Message; CompletedUtc=[DateTime]::UtcNow.ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $resultFile -Encoding UTF8
  exit 1
}
