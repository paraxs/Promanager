$ErrorActionPreference = 'Stop'
Set-Location 'c:\Promanager1'

$statePath = 'server/data/state.json'
if (-not (Test-Path $statePath)) {
  Write-Output 'Kein server/data/state.json gefunden.'
  exit 0
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = "server/data/state.backup.$timestamp.json"
Copy-Item $statePath $backupPath -Force
Remove-Item $statePath -Force

Write-Output "Backup erstellt: $backupPath"
Write-Output 'Server-State wurde zurueckgesetzt.'
