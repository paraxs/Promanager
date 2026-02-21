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
    update_id = 9951
    message = @{
      message_id = 1401
      chat = @{ id = 90601; type = 'private' }
      from = @{ id = 61; first_name = 'Singleline'; username = 'singleline_test' }
      text = 'Titel: Fensterbank Montage Datum: 19.02.2026 Uhrzeit: 15:00 Ort: Lienz Adresse: Peter Weber Gasse Telefon: +43 660 1234567 Status: Warteschlange Kommentar: Kunde vorher anrufen'
    }
  } | ConvertTo-Json -Depth 8

  Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $update | Out-Null
  $pending = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/pending' -Method Get
  $conversations = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/conversations' -Method Get
  $proposal = $pending.items[0]

  [pscustomobject]@{
    title = $proposal.values.title
    status = $proposal.values.status
    date = $proposal.values.date
    address = $proposal.values.address
    location = $proposal.values.location
    phone = $proposal.values.phone
    comment = $proposal.metadata.comment
    source = $proposal.metadata.source
    unmapped = ($proposal.unmapped -join ' | ')
    open_conversations = @($conversations.items).Count
    missing = if (@($conversations.items).Count -gt 0) { ($conversations.items[0].missingPropertyIds -join ', ') } else { '' }
    confidence = $proposal.confidence
    reasoning = $proposal.reasoning
  } | ConvertTo-Json -Depth 8
}
finally {
  Stop-Job $job -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $job -ErrorAction SilentlyContinue | Out-Null
  if (Test-Path 'server/data/state.json') {
    Remove-Item 'server/data/state.json' -Force -ErrorAction SilentlyContinue
  }
}
