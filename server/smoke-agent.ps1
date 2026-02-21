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
  $env:AGENT_REQUIRED_FIELDS = 'date,location,address'
  node server/index.mjs
}

try {
  Start-Sleep -Seconds 1

  $chatId = 90061
  $nextUpdateId = 9301
  $nextMessageId = 801

  $initial = @{
    update_id = $nextUpdateId
    message = @{
      message_id = $nextMessageId
      chat = @{ id = $chatId; type = 'private' }
      from = @{ id = 6; first_name = 'Agent'; username = 'agent_test' }
      text = 'Titel: Dachreparatur'
    }
  } | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $initial | Out-Null

  $answerMap = @{
    address = 'Peter Weber Gasse'
    location = 'Lienz'
    date = 'morgen'
    phone = '+43 660 1111111'
    uhrzeit = '15 Uhr'
    zeit = '15 Uhr'
  }

  for ($i = 0; $i -lt 8; $i++) {
    $conversations = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/conversations' -Method Get
    if (-not $conversations.items -or $conversations.items.Count -eq 0) { break }

    $conversation = $conversations.items[0]
    $missing = @($conversation.missingPropertyIds)
    if (-not $missing -or $missing.Count -eq 0) { break }
    $target = [string]$missing[0]
    $answer = $answerMap[$target]
    if (-not $answer) { $answer = 'Testwert' }

    $nextUpdateId++
    $nextMessageId++
    $update = @{
      update_id = $nextUpdateId
      message = @{
        message_id = $nextMessageId
        chat = @{ id = $chatId; type = 'private' }
        from = @{ id = 6; first_name = 'Agent'; username = 'agent_test' }
        text = $answer
      }
    } | ConvertTo-Json -Depth 8

    Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $update | Out-Null
  }

  $pending = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/pending' -Method Get
  $conversationsAfter = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/conversations' -Method Get
  $proposal = $pending.items[0]

  [pscustomobject]@{
    pending_count = @($pending.items).Count
    open_conversations = @($conversationsAfter.items).Count
    title = $proposal.values.title
    date = $proposal.values.date
    location = $proposal.values.location
    address = $proposal.values.address
    extraction_mode = $proposal.extractionMode
  } | ConvertTo-Json -Depth 6
}
finally {
  Stop-Job $job -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $job -ErrorAction SilentlyContinue | Out-Null
  if (Test-Path 'server/data/state.json') {
    Remove-Item 'server/data/state.json' -Force -ErrorAction SilentlyContinue
  }
}
