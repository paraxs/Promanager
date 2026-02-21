$ErrorActionPreference = 'Stop'
Set-Location 'c:\Promanager1'

if (Test-Path 'server/data/state.json') {
  Remove-Item 'server/data/state.json' -Force -ErrorAction SilentlyContinue
}

$job = Start-Job -ScriptBlock {
  Set-Location 'c:\Promanager1'
  $env:TELEGRAM_MVP_PORT = '8788'
  $env:TELEGRAM_BOT_TOKEN = ''
  node server/index.mjs
}

try {
  Start-Sleep -Seconds 1

  $update = @{
    update_id = 9001
    message = @{
      message_id = 601
      chat = @{ id = 90041; type = 'private' }
      from = @{ id = 4; first_name = 'Cmd'; username = 'cmd_test' }
      text = '/neu'
    }
  } | ConvertTo-Json -Depth 8

  $result = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $update
  $pending = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/pending' -Method Get
  $audit = Invoke-RestMethod -Uri 'http://localhost:8788/api/board/audit?limit=10' -Method Get
  $types = @($audit.items | ForEach-Object { $_.type })

  [pscustomobject]@{
    webhook_ok = $result.ok
    pending_count = @($pending.items).Count
    has_command_audit = ($types -contains 'telegram_command_received')
    has_proposal_created = ($types -contains 'telegram_proposal_created')
    audit_types = ($types -join ', ')
  } | ConvertTo-Json -Depth 5
}
finally {
  Stop-Job $job -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $job -ErrorAction SilentlyContinue | Out-Null
  if (Test-Path 'server/data/state.json') {
    Remove-Item 'server/data/state.json' -Force -ErrorAction SilentlyContinue
  }
}
