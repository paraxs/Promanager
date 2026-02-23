$ErrorActionPreference = 'Stop'
Set-Location 'c:\Promanager1'

$port = 8790
$ownerKey = "owner_drill_$([Guid]::NewGuid().ToString('N'))"
$headers = @{
  'x-promanager-api-key' = $ownerKey
}

$job = Start-Job -ScriptBlock {
  Set-Location 'c:\Promanager1'
  $env:TELEGRAM_MVP_PORT = '8790'
  $env:TELEGRAM_MVP_HOST = '127.0.0.1'
  $env:TELEGRAM_BOT_TOKEN = ''
  $env:LLM_ENABLED = '0'
  $env:GOOGLE_ENABLED = '0'
  $env:SECURITY_AUTH_ENABLED = '1'
  $env:SECURITY_OWNER_KEYS = $using:ownerKey
  $env:SECURITY_DISPATCHER_KEYS = ''
  $env:SECURITY_READONLY_KEYS = ''
  $env:SECURITY_CORS_ORIGINS = '*'
  $env:BACKUP_ENABLED = '1'
  $env:BACKUP_DAILY_ENABLED = '0'
  node server/index.mjs
}

try {
  Start-Sleep -Seconds 2

  $healthBefore = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$port/api/health"

  $runBackupBody = @{ reason = 'drill-manual' } | ConvertTo-Json -Depth 5
  $runBackup = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/backups/run" -Headers $headers -ContentType 'application/json' -Body $runBackupBody
  if (-not $runBackup.ok) {
    throw 'Backup-Run API meldet ok=false.'
  }

  $backups = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$port/api/backups" -Headers $headers
  if (-not $backups.ok -or -not $backups.backups -or $backups.backups.Count -lt 1) {
    throw 'Backup-Liste ist leer.'
  }

  $latestBackup = [string]$backups.backups[0].file
  if ([string]::IsNullOrWhiteSpace($latestBackup)) {
    throw 'Kein gueltiger Backup-Dateiname gefunden.'
  }

  $restoreBody = @{ fileName = $latestBackup } | ConvertTo-Json -Depth 5
  $restore = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/backups/restore" -Headers $headers -ContentType 'application/json' -Body $restoreBody
  if (-not $restore.ok) {
    throw 'Backup-Restore API meldet ok=false.'
  }

  $healthAfter = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$port/api/health"

  [pscustomobject]@{
    ok = $true
    backupFile = $latestBackup
    backupsListed = $backups.backups.Count
    healthService = $healthAfter.service
    healthAlerts = @($healthAfter.alerts).Count
    lastBackupAt = $healthAfter.backup.lastBackupAt
    lastRestoreAt = $healthAfter.backup.lastRestoreAt
    checkedAt = (Get-Date).ToString('s')
  } | ConvertTo-Json -Depth 6
}
finally {
  Stop-Job $job -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $job -ErrorAction SilentlyContinue | Out-Null
}
