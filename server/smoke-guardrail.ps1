$ErrorActionPreference = 'Stop'
Set-Location 'c:\Promanager1'

if (Test-Path 'server/data/state.json') {
  Remove-Item 'server/data/state.json' -Force -ErrorAction SilentlyContinue
}

$job = Start-Job -ScriptBlock {
  Set-Location 'c:\Promanager1'
  $env:TELEGRAM_MVP_PORT = '8788'
  $env:IMPORT_GUARDRAIL_CONFIDENCE = '0.8'
  node server/index.mjs
}

try {
  Start-Sleep -Seconds 1

  $update1 = @{
    update_id = 2001
    message = @{
      message_id = 101
      chat = @{ id = 90002; type = 'private' }
      from = @{ id = 999001; first_name = 'Guard'; username = 'guard_test' }
      text = "Heute bitte schnell bei Kunde vorbeischauen und prüfen"
    }
  } | ConvertTo-Json -Depth 8

  Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $update1 | Out-Null

  $pendingBefore = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/pending' -Method Get
  if (-not $pendingBefore.items -or $pendingBefore.items.Count -lt 1) {
    throw 'Guardrail-Test: kein Pending-Proposal erzeugt.'
  }

  $proposal = $pendingBefore.items[0]
  $proposalId = $proposal.id

  $update2 = @{
    update_id = 2002
    callback_query = @{
      id = 'cbq-guard-1'
      from = @{ id = 999001; first_name = 'Guard'; username = 'guard_test' }
      data = "tg:ok:$proposalId"
      message = @{
        message_id = 102
        chat = @{ id = 90002; type = 'private' }
      }
    }
  } | ConvertTo-Json -Depth 8

  $cbResult = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $update2

  $pendingAfter = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/pending' -Method Get
  $board = Invoke-RestMethod -Uri 'http://localhost:8788/api/board/state' -Method Get
  $audit = Invoke-RestMethod -Uri 'http://localhost:8788/api/board/audit?limit=10' -Method Get

  $cardCount = @($board.board.cardsById.PSObject.Properties).Count
  $auditTypes = @($audit.items | ForEach-Object { $_.type })

  [pscustomobject]@{
    proposal_id = $proposalId
    confidence = $proposal.confidence
    extraction_mode = $proposal.extractionMode
    callback_ok = $cbResult.ok
    pending_before = @($pendingBefore.items).Count
    pending_after = @($pendingAfter.items).Count
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

