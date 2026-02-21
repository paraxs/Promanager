$ErrorActionPreference = 'Stop'
Set-Location 'c:\Promanager1'

if (Test-Path 'server/data/state.json') {
  Remove-Item 'server/data/state.json' -Force -ErrorAction SilentlyContinue
}

$job = Start-Job -ScriptBlock {
  Set-Location 'c:\Promanager1'
  $env:TELEGRAM_MVP_PORT = '8788'
  $env:TELEGRAM_BOT_TOKEN = ''
  $env:AGENT_ENABLED = '1'
  $env:AGENT_CRITICAL_FIELDS = 'date,location,address'
  $env:AGENT_FOLLOWUP_INCLUDE_REQUIRED = '0'
  $env:AGENT_PROPERTY_PRIORITY = 'address:100,date:90,location:80'
  node server/index.mjs
}

try {
  Start-Sleep -Seconds 1
  $health = Invoke-RestMethod -Uri 'http://localhost:8788/api/health' -Method Get

  $update = @{
    update_id = 9801
    message = @{
      message_id = 1001
      chat = @{ id = 90111; type = 'private' }
      from = @{ id = 11; first_name = 'Priority'; username = 'priority_test' }
      text = 'Titel: Prioritaet Test'
    }
  } | ConvertTo-Json -Depth 8

  Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $update | Out-Null

  $conversations = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/conversations' -Method Get
  if (-not $conversations.items -or $conversations.items.Count -lt 1) {
    throw 'Kein aktiver Followup-Flow gefunden.'
  }

  $missing = @($conversations.items[0].missingPropertyIds)
  $expected = @('address', 'date', 'location')

  if ($missing.Count -lt 3) {
    throw "Zu wenige Missing-Properties: $($missing -join ', ')"
  }

  for ($i = 0; $i -lt $expected.Count; $i++) {
    if ([string]$missing[$i] -ne [string]$expected[$i]) {
      throw "Prioritaetsreihenfolge falsch. Erwartet: $($expected -join ', ') | Ist: $($missing -join ', ') | agentPropertyPriority=$($health.agentPropertyPriority)"
    }
  }

  [pscustomobject]@{
    ok = $true
    agent_property_priority = $health.agentPropertyPriority
    missing_order = ($missing -join ', ')
    expected_order = ($expected -join ', ')
  } | ConvertTo-Json -Depth 5
}
finally {
  Stop-Job $job -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $job -ErrorAction SilentlyContinue | Out-Null
  if (Test-Path 'server/data/state.json') {
    Remove-Item 'server/data/state.json' -Force -ErrorAction SilentlyContinue
  }
}
