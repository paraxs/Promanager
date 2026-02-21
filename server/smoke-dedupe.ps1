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

  $msgText = 'Termin: morgen 15 Uhr Ort lienz, Peter Weber Gasse, Datum: 19.02.2026.'

  $update1 = @{
    update_id = 8001
    message = @{
      message_id = 501
      chat = @{ id = 90031; type = 'private' }
      from = @{ id = 3; first_name = 'Test'; username = 'dedupe_test' }
      text = $msgText
    }
  } | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $update1 | Out-Null

  $pending1 = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/pending' -Method Get
  $proposal1 = $pending1.items[0].id

  $cb1 = @{
    update_id = 8002
    callback_query = @{
      id = 'cbq-dedupe-1'
      from = @{ id = 3; first_name = 'Test'; username = 'dedupe_test' }
      data = "tg:ok:$proposal1"
      message = @{ message_id = 502; chat = @{ id = 90031; type = 'private' } }
    }
  } | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $cb1 | Out-Null

  $update2 = @{
    update_id = 8003
    message = @{
      message_id = 503
      chat = @{ id = 90031; type = 'private' }
      from = @{ id = 3; first_name = 'Test'; username = 'dedupe_test' }
      text = $msgText
    }
  } | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $update2 | Out-Null

  $pending2 = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/pending' -Method Get
  $proposal2 = $pending2.items[0].id

  $cb2 = @{
    update_id = 8004
    callback_query = @{
      id = 'cbq-dedupe-2'
      from = @{ id = 3; first_name = 'Test'; username = 'dedupe_test' }
      data = "tg:ok:$proposal2"
      message = @{ message_id = 504; chat = @{ id = 90031; type = 'private' } }
    }
  } | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $cb2 | Out-Null

  $board = Invoke-RestMethod -Uri 'http://localhost:8788/api/board/state' -Method Get
  $audit = Invoke-RestMethod -Uri 'http://localhost:8788/api/board/audit?limit=20' -Method Get

  $cardCount = @($board.board.cardsById.PSObject.Properties).Count
  $types = @($audit.items | ForEach-Object { $_.type })

  [pscustomobject]@{
    imported_card_count = $cardCount
    has_dedup_event = ($types -contains 'telegram_import_deduplicated')
    audit_types = ($types -join ', ')
  } | ConvertTo-Json -Depth 6
}
finally {
  Stop-Job $job -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $job -ErrorAction SilentlyContinue | Out-Null
  if (Test-Path 'server/data/state.json') {
    Remove-Item 'server/data/state.json' -Force -ErrorAction SilentlyContinue
  }
}
