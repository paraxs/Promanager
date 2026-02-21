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

  $chatId = 90071
  $firstMessage = 'termin mit peter morgen 15 uhr in lienz peter weber gasse'
  $secondMessage = 'Termin: morgen 15 Uhr, Ort: Lienz, Adresse: Peter Weber Gasse'

  $update1 = @{
    update_id = 9501
    message = @{
      message_id = 901
      chat = @{ id = $chatId; type = 'private' }
      from = @{ id = 7; first_name = 'Voice'; username = 'voice_test' }
      text = $firstMessage
    }
  } | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $update1 | Out-Null

  $pending1 = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/pending' -Method Get
  $proposal1 = $pending1.items[0]

  $cb1 = @{
    update_id = 9502
    callback_query = @{
      id = 'cbq-voice-1'
      from = @{ id = 7; first_name = 'Voice'; username = 'voice_test' }
      data = "tg:ok:$($proposal1.id)"
      message = @{ message_id = 902; chat = @{ id = $chatId; type = 'private' } }
    }
  } | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $cb1 | Out-Null

  $update2 = @{
    update_id = 9503
    message = @{
      message_id = 903
      chat = @{ id = $chatId; type = 'private' }
      from = @{ id = 7; first_name = 'Voice'; username = 'voice_test' }
      text = $secondMessage
    }
  } | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $update2 | Out-Null

  $pending2 = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/pending' -Method Get
  $proposal2 = $pending2.items[0]

  $cb2 = @{
    update_id = 9504
    callback_query = @{
      id = 'cbq-voice-2'
      from = @{ id = 7; first_name = 'Voice'; username = 'voice_test' }
      data = "tg:ok:$($proposal2.id)"
      message = @{ message_id = 904; chat = @{ id = $chatId; type = 'private' } }
    }
  } | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $cb2 | Out-Null

  $board = Invoke-RestMethod -Uri 'http://localhost:8788/api/board/state' -Method Get
  $audit = Invoke-RestMethod -Uri 'http://localhost:8788/api/board/audit?limit=30' -Method Get
  $cardCount = @($board.board.cardsById.PSObject.Properties).Count
  $auditTypes = @($audit.items | ForEach-Object { $_.type })

  [pscustomobject]@{
    first_title = $proposal1.values.title
    first_date = $proposal1.values.date
    first_location = $proposal1.values.location
    first_address = $proposal1.values.address
    imported_card_count = $cardCount
    has_dedupe_event = ($auditTypes -contains 'telegram_import_deduplicated')
    audit_types = ($auditTypes -join ', ')
  } | ConvertTo-Json -Depth 6
}
finally {
  Stop-Job $job -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $job -ErrorAction SilentlyContinue | Out-Null
  if (Test-Path 'server/data/state.json') {
    Remove-Item 'server/data/state.json' -Force -ErrorAction SilentlyContinue
  }
}
