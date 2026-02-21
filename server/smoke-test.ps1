$ErrorActionPreference = 'Stop'
Set-Location 'c:\Promanager1'

if (Test-Path 'server/data/state.json') {
  Remove-Item 'server/data/state.json' -Force -ErrorAction SilentlyContinue
}

$job = Start-Job -ScriptBlock {
  Set-Location 'c:\Promanager1'
  $env:TELEGRAM_MVP_PORT = '8788'
  node server/index.mjs
}

try {
  Start-Sleep -Seconds 1

  $health = Invoke-RestMethod -Uri 'http://localhost:8788/api/health' -Method Get

  $update1 = @{
    update_id = 1001
    message = @{
      message_id = 77
      chat = @{ id = 90001; type = 'private' }
      from = @{ id = 123456; first_name = 'Franz'; username = 'franz_test' }
      text = "Titel: Müller Dachreparatur`nStatus: Warteschlange`nDatum: 21.02.2026`nAdresse: Hauptstraße 15`nOrt: Wien`nTelefon: +43 6601234567`nKommentar: Bitte vorab anrufen"
    }
  } | ConvertTo-Json -Depth 8

  $webhook1 = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $update1

  $pending = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/pending' -Method Get
  if (-not $pending.items -or $pending.items.Count -lt 1) {
    throw 'Kein Pending-Proposal nach Message-Webhook erzeugt.'
  }

  $proposalId = $pending.items[0].id

  $update2 = @{
    update_id = 1002
    callback_query = @{
      id = 'cbq-1'
      from = @{ id = 123456; first_name = 'Franz'; username = 'franz_test' }
      data = "tg:ok:$proposalId"
      message = @{
        message_id = 88
        chat = @{ id = 90001; type = 'private' }
      }
    }
  } | ConvertTo-Json -Depth 8

  $webhook2 = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $update2

  $pendingAfter = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/pending' -Method Get
  $board = Invoke-RestMethod -Uri 'http://localhost:8788/api/board/state' -Method Get
  $audit = Invoke-RestMethod -Uri 'http://localhost:8788/api/board/audit?limit=10' -Method Get

  $cardCount = @($board.board.cardsById.PSObject.Properties).Count
  $auditTypes = @($audit.items | ForEach-Object { $_.type })

  [pscustomobject]@{
    health_ok = $health.ok
    webhook_message_ok = $webhook1.ok
    pending_count_before_confirm = @($pending.items).Count
    proposal_id = $proposalId
    webhook_callback_ok = $webhook2.ok
    pending_count_after_confirm = @($pendingAfter.items).Count
    imported_card_count = $cardCount
    audit_types = ($auditTypes -join ', ')
  } | ConvertTo-Json -Depth 4
}
finally {
  Stop-Job $job -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $job -ErrorAction SilentlyContinue | Out-Null
  if (Test-Path 'server/data/state.json') {
    Remove-Item 'server/data/state.json' -Force -ErrorAction SilentlyContinue
  }
}

