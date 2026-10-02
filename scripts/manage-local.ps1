param(
  [ValidateSet('Start','Stop','Status','Diagnose')][string]$Action = 'Start',
  [switch]$OpenBrowser
)
& (Join-Path $PSScriptRoot 'manage-versions.ps1') -Action $Action -OpenBrowser:$OpenBrowser
exit $LASTEXITCODE
