param(
  [switch]$Apply,
  [switch]$Restore,
  [string]$BackupPath
)
$ErrorActionPreference = 'Stop'
if ($Apply -and $Restore) { throw 'Use either -Apply or -Restore.' }
if ($BackupPath -and -not $Restore) { throw '-BackupPath is only used with -Restore.' }
$gameRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$stateDir = Join-Path $gameRoot '.local'
$serverScript = Join-Path $gameRoot 'server\index.js'
$baseRule = 'StrongholdProtocolLocal'
$ports = @('3000','3001')

function Normalize-Program($value) {
  if (-not $value -or $value -eq 'Any') { return '' }
  return [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables(([string]$value).Trim('"'))).ToLowerInvariant()
}
function Require-Administrator {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this command in an Administrator PowerShell window. This script never requests elevation automatically.'
  }
}
function Read-Rule($name) {
  # Rule names can contain a checkout path with wildcard characters such as [ and ].
  return Get-NetFirewallRule -PolicyStore PersistentStore | Where-Object { $_.Name -eq $name }
}
function Snapshot-Rule($rule) {
  $app = $rule | Get-NetFirewallApplicationFilter
  $port = $rule | Get-NetFirewallPortFilter
  $address = $rule | Get-NetFirewallAddressFilter
  return [pscustomobject]@{
    Name=$rule.Name; Enabled=[string]$rule.Enabled; Direction=[string]$rule.Direction; Action=[string]$rule.Action
    Profile=@(([string]$rule.Profile) -split ',\s*'); Program=[string]$app.Program
    Protocol=[string]$port.Protocol; LocalPort=@($port.LocalPort | ForEach-Object { [string]$_ })
    RemoteAddress=@($address.RemoteAddress | ForEach-Object { [string]$_ })
  }
}
function Set-Snapshot($saved) {
  $rule = Read-Rule $saved.Name
  if (-not $rule) { throw "Original rule is missing: $($saved.Name)" }
  Set-NetFirewallRule -InputObject $rule -Enabled $saved.Enabled -Direction $saved.Direction -Action $saved.Action -Profile $saved.Profile -Program $saved.Program -Protocol $saved.Protocol -LocalPort $saved.LocalPort -RemoteAddress $saved.RemoteAddress | Out-Null
}
function Is-Tcp($protocol) { return ([string]$protocol -eq 'TCP' -or [string]$protocol -eq '6') }
function Has-GamePort($localPorts) {
  foreach ($value in @($localPorts)) {
    foreach ($part in ([string]$value -split ',')) {
      $part = $part.Trim()
      if ($part -eq 'Any' -or $ports -contains $part) { return $true }
      if ($part -match '^(\d+)-(\d+)$') {
        foreach ($port in $ports) { if ([int]$port -ge [int]$Matches[1] -and [int]$port -le [int]$Matches[2]) { return $true } }
      }
    }
  }
  return $false
}
function ConvertTo-PortIntervals($localPorts) {
  $intervals = New-Object 'System.Collections.Generic.List[object]'
  foreach ($value in @($localPorts)) {
    foreach ($part in ([string]$value -split ',')) {
      $part = $part.Trim()
      if ($part -eq 'Any') { $start = 1; $end = 65535 }
      elseif ($part -match '^(\d+)$') { $start = [int]$Matches[1]; $end = $start }
      elseif ($part -match '^(\d+)-(\d+)$') { $start = [int]$Matches[1]; $end = [int]$Matches[2] }
      else { throw "Unsupported local-port token: $part" }
      if ($start -lt 1 -or $end -gt 65535 -or $start -gt $end) { throw "Invalid local-port interval: $part" }
      $intervals.Add([pscustomobject]@{ Start=$start; End=$end })
    }
  }
  $merged = New-Object 'System.Collections.Generic.List[object]'
  foreach ($interval in @($intervals | Sort-Object Start,End)) {
    if ($merged.Count -gt 0 -and $interval.Start -le $merged[$merged.Count - 1].End + 1) {
      $previous = $merged[$merged.Count - 1]
      $previous.End = [Math]::Max($previous.End, $interval.End)
    } else { $merged.Add([pscustomobject]@{ Start=$interval.Start; End=$interval.End }) }
  }
  return $merged.ToArray()
}
function ConvertTo-PortSpec($intervals) {
  foreach ($interval in @($intervals)) {
    if ($interval.Start -eq $interval.End) { [string]$interval.Start }
    else { "$($interval.Start)-$($interval.End)" }
  }
}
function Remove-GamePorts($localPorts, [int[]]$removePorts = @(3000,3001)) {
  $remaining = @(ConvertTo-PortIntervals $localPorts)
  foreach ($removed in @($removePorts | Select-Object -Unique)) {
    $next = New-Object 'System.Collections.Generic.List[object]'
    foreach ($interval in $remaining) {
      if ($removed -lt $interval.Start -or $removed -gt $interval.End) { $next.Add($interval); continue }
      if ($interval.Start -lt $removed) { $next.Add([pscustomobject]@{ Start=$interval.Start; End=($removed - 1) }) }
      if ($removed -lt $interval.End) { $next.Add([pscustomobject]@{ Start=($removed + 1); End=$interval.End }) }
    }
    $remaining = @($next.ToArray())
  }
  return ConvertTo-PortSpec $remaining
}
function Same-PortSet($first, $second) {
  $a = @(ConvertTo-PortSpec @(ConvertTo-PortIntervals $first)) -join ','
  $b = @(ConvertTo-PortSpec @(ConvertTo-PortIntervals $second)) -join ','
  return $a -eq $b
}
function Write-Backup($value, $path) {
  $temporary = $path + '.tmp'
  $value | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $temporary -Encoding UTF8
  Move-Item -LiteralPath $temporary -Destination $path -Force
}
function Restore-Backup($saved) {
  if ($saved.Version -ne 2 -or [IO.Path]::GetFullPath([string]$saved.GameRoot) -ine $gameRoot) { throw 'Backup format is unsupported or does not belong to this game folder.' }
  foreach ($blocked in @($saved.BlockRules)) {
    $rule = Read-Rule $blocked.Name
    if (-not $rule) { throw "Blocked rule is missing: $($blocked.Name)" }
    $current = Snapshot-Rule $rule
    if ((Normalize-Program $current.Program) -ne (Normalize-Program $blocked.Program) -or -not (Is-Tcp $current.Protocol) -or $current.Direction -ne 'Inbound' -or $current.Action -ne 'Block') {
      throw "Rule scope has changed; refusing to restore: $($blocked.Name)"
    }
    if (-not (Same-PortSet $current.LocalPort $blocked.LocalPort) -and -not (Same-PortSet $current.LocalPort $blocked.PlannedLocalPort)) {
      throw "Rule ports have changed outside the repair plan; refusing to restore: $($blocked.Name)"
    }
    if ($current.Enabled -ne $blocked.Enabled -and $current.Enabled -ne $blocked.PlannedEnabled) {
      throw "Rule enabled state has changed outside the repair plan: $($blocked.Name)"
    }
    Set-NetFirewallRule -InputObject $rule -LocalPort $blocked.LocalPort -Enabled $blocked.Enabled | Out-Null
  }
  foreach ($entry in @($saved.AllowRules)) {
    if ($entry.Name -ne $baseRule -and $entry.Name -notmatch '^StrongholdProtocolLocal-[0-9a-f]{12}$') { throw 'Unexpected allow-rule name in backup.' }
    $rule = Read-Rule $entry.Name
    if (-not $rule) {
      if ($entry.Original) { throw "Original allow rule is missing: $($entry.Name)" }
      continue
    }
    $current = Snapshot-Rule $rule
    if ((Normalize-Program $current.Program) -ne (Normalize-Program $entry.Program)) { throw "Program scope has changed; refusing to restore: $($entry.Name)" }
    if ($entry.Original) { Set-Snapshot $entry.Original }
    else {
      if ($current.Direction -ne 'Inbound' -or $current.Action -ne 'Allow' -or -not (Is-Tcp $current.Protocol) -or (@($current.LocalPort | Sort-Object) -join ',') -ne '3000,3001' -or (@($current.RemoteAddress) -join ',') -ne 'LocalSubnet') {
        throw "Created rule has changed; refusing to remove it: $($entry.Name)"
      }
      Remove-NetFirewallRule -InputObject $rule
    }
  }
}

if ($Restore) {
  Require-Administrator
  if (-not $BackupPath) {
    $latest = Get-ChildItem -LiteralPath $stateDir -Filter 'network-firewall-backup-*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $latest) { throw 'No firewall backup exists for this game folder.' }
    $BackupPath = $latest.FullName
  }
  $BackupPath = [IO.Path]::GetFullPath($BackupPath)
  if (-not $BackupPath.StartsWith($stateDir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup must be inside this game folder .local directory.' }
  $saved = Get-Content -LiteralPath $BackupPath -Raw | ConvertFrom-Json
  Restore-Backup $saved
  $saved.Status = 'Restored'
  Write-Backup $saved $BackupPath
  Write-Host "Restored firewall settings from $BackupPath"
  exit 0
}

# Match the launcher's portable runtime, then its system Node fallback.
$nodeExe = Join-Path (Split-Path -Parent $gameRoot) 'runtime\node-v24.21.0-win-x64\node.exe'
if (-not (Test-Path -LiteralPath $nodeExe)) {
  $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $systemNode) { throw 'Install Node.js 22/24 first.' }
  $nodeExe = $systemNode.Source
}
$nodes = @((Normalize-Program $nodeExe))
# A state PID is accepted only when Node's main script belongs to this checkout.
foreach ($stateName in @('server-process.json','server-process-legacy.json')) {
  $stateFile = Join-Path $stateDir $stateName
  if (-not (Test-Path -LiteralPath $stateFile)) { continue }
  try {
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$state.ProcessId)" -ErrorAction SilentlyContinue
    $main = [regex]::Match([string]$process.CommandLine, '^\s*(?:"[^"]+"|[^\s"]+)\s+(?:"(?<script>[^"]+)"|(?<script>[^\s"]+))(?=\s|$)')
    if ($process -and $process.ExecutablePath -and [IO.Path]::GetFileName($process.ExecutablePath) -ieq 'node.exe' -and $main.Success -and $main.Groups['script'].Value.Equals($serverScript, [StringComparison]::OrdinalIgnoreCase)) {
      $nodes += Normalize-Program $process.ExecutablePath
    } elseif ($process) { Write-Warning "Ignoring stale or unrelated process state: $stateName" }
  } catch { Write-Warning "Ignoring unreadable process state: $stateName" }
}
$nodes = @($nodes | Select-Object -Unique)
$activeProfiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object { if ($_.NetworkCategory -eq 'DomainAuthenticated') { 'Domain' } else { [string]$_.NetworkCategory } } | Select-Object -Unique)
$blockedRules = @()
foreach ($rule in @(Get-NetFirewallRule -PolicyStore PersistentStore -Enabled True -Direction Inbound -Action Block)) {
  $snapshot = Snapshot-Rule $rule
  if ($nodes -notcontains (Normalize-Program $snapshot.Program) -or -not (Is-Tcp $snapshot.Protocol) -or -not (Has-GamePort $snapshot.LocalPort)) { continue }
  $active = $snapshot.Profile -contains 'Any' -or @($snapshot.Profile | Where-Object { $activeProfiles -contains $_ }).Count -gt 0
  if (-not $active) { continue }
  # Only broad LAN-applicable blocks are changed. Custom address restrictions require manual review.
  if (@($snapshot.RemoteAddress | Where-Object { $_ -eq 'Any' -or $_ -eq 'LocalSubnet' }).Count -eq 0) {
    Write-Warning "TCP block has custom remote addresses; left for manual review: $($rule.Name)"
    continue
  }
  try { $remaining = @(Remove-GamePorts $snapshot.LocalPort) }
  catch { Write-Warning "Cannot safely subtract game ports; left for manual review: $($rule.Name). $($_.Exception.Message)"; continue }
  $plannedPorts = @($snapshot.LocalPort)
  if ($remaining.Count) { $plannedPorts = @($remaining) }
  $snapshot | Add-Member -NotePropertyName RemainingLocalPort -NotePropertyValue $remaining
  $snapshot | Add-Member -NotePropertyName PlannedLocalPort -NotePropertyValue $plannedPorts
  $snapshot | Add-Member -NotePropertyName PlannedEnabled -NotePropertyValue $(if ($remaining.Count) { $snapshot.Enabled } else { 'False' })
  $snapshot | Add-Member -NotePropertyName Modification -NotePropertyValue $(if ($remaining.Count) { 'ExcludeGamePorts' } else { 'DisableEmptyRule' })
  $blockedRules += $snapshot
}
$base = Read-Rule $baseRule
$baseProgram = if ($base) { Normalize-Program (($base | Get-NetFirewallApplicationFilter).Program) } else { '' }
$allowRules = @()
foreach ($program in $nodes) {
  if ($baseProgram -eq $program -or (-not $base -and $program -eq $nodes[0])) { $name = $baseRule }
  else {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $suffix = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($program)))).Replace('-','').Substring(0,12).ToLowerInvariant() } finally { $sha.Dispose() }
    $name = "$baseRule-$suffix"
  }
  $existing = Read-Rule $name
  $original = if ($existing) { Snapshot-Rule $existing } else { $null }
  if ($original -and (Normalize-Program $original.Program) -ne $program) { throw "Allow-rule name belongs to another program: $name" }
  $allowRules += [pscustomobject]@{ Name=$name; Program=$program; Original=$original }
}
Write-Host 'Preview: local game firewall configuration (no changes unless -Apply).'
Write-Host "Network profiles: $($activeProfiles -join ', ')"
foreach ($program in $nodes) { Write-Host "Game Node: $program" }
foreach ($entry in $allowRules) {
  if ($entry.Original) { Write-Host "Existing allow: $($entry.Original | ConvertTo-Json -Compress)" }
  else { Write-Host "Allow rule to create: $($entry.Name)" }
}
foreach ($rule in $blockedRules) {
  $after = if ($rule.RemainingLocalPort.Count) { $rule.RemainingLocalPort -join ',' } else { '(empty; disable rule)' }
  Write-Host "TCP block plan: [$($rule.LocalPort -join ',')] -> [$after]; Enabled $($rule.Enabled) -> $($rule.PlannedEnabled); $($rule.Name)"
}
Write-Host "Plan: allow this game's Node on TCP 3000,3001 from LocalSubnet, Profile Any; subtract only these ports from $($blockedRules.Count) matching TCP block(s). Other blocked ports remain blocked."
Write-Host 'UDP rules, other programs, and Windows network profiles are unchanged.'
if (-not $Apply) { Write-Host 'To apply manually, use Administrator PowerShell: .\scripts\repair-local-network.ps1 -Apply'; exit 0 }
Require-Administrator
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$BackupPath = Join-Path $stateDir ('network-firewall-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.json')
$saved = [pscustomobject]@{ Version=2; GameRoot=$gameRoot; CreatedUtc=[DateTime]::UtcNow.ToString('o'); Status='Applying'; AllowRules=$allowRules; BlockRules=$blockedRules }
Write-Backup $saved $BackupPath
try {
  # Update existing rules in place. The old allow rule is never removed to make room for a new one.
  foreach ($entry in $allowRules) {
    $params = @{ Direction='Inbound'; Action='Allow'; Enabled='True'; Profile='Any'; Program=$entry.Program; Protocol='TCP'; LocalPort=$ports; RemoteAddress='LocalSubnet' }
    if ($entry.Original) { Set-NetFirewallRule @params -InputObject (Read-Rule $entry.Name) | Out-Null }
    else { New-NetFirewallRule @params -PolicyStore PersistentStore -Name $entry.Name -DisplayName 'Stronghold Protocol LAN' -Description 'Current and legacy game servers; local subnet only.' | Out-Null }
  }
  foreach ($blocked in $blockedRules) {
    $rule = Read-Rule $blocked.Name
    if (-not $rule) { throw "Blocked rule disappeared before repair: $($blocked.Name)" }
    $current = Snapshot-Rule $rule
    if ((Normalize-Program $current.Program) -ne (Normalize-Program $blocked.Program) -or $current.Direction -ne 'Inbound' -or $current.Action -ne 'Block' -or -not (Is-Tcp $current.Protocol) -or -not (Same-PortSet $current.LocalPort $blocked.LocalPort) -or $current.Enabled -ne $blocked.Enabled) {
      throw "Blocked rule changed after the preview: $($blocked.Name)"
    }
    if ($blocked.Modification -eq 'DisableEmptyRule') { Set-NetFirewallRule -InputObject $rule -Enabled False | Out-Null }
    else { Set-NetFirewallRule -InputObject $rule -LocalPort $blocked.PlannedLocalPort | Out-Null }
  }
  $saved.Status = 'Applied'
  Write-Backup $saved $BackupPath
  Write-Host "Applied. Backup: $BackupPath"
  Write-Host 'Restore manually with: .\scripts\repair-local-network.ps1 -Restore'
} catch {
  $applyError = $_.Exception.Message
  try { Restore-Backup $saved; $saved.Status = 'FailedAndRolledBack' }
  catch { $saved.Status = 'RollbackNeedsReview'; Write-Warning $_.Exception.Message }
  Write-Backup $saved $BackupPath
  throw "Firewall repair failed: $applyError. Backup: $BackupPath"
}
