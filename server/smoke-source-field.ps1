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
    update_id = 9971
    message = @{
      message_id = 1601
      chat = @{ id = 90621; type = 'private' }
      from = @{ id = 63; first_name = 'Source'; username = 'source_test' }
      text = 'Titel: Quellen Test Datum: 19.02.2026 Adresse: Peter Weber Gasse Quelle: WhatsApp'
    }
  } | ConvertTo-Json -Depth 8

  Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $update | Out-Null
  $pending = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/pending' -Method Get
  $proposal = $pending.items[0]

  [pscustomobject]@{
    title = $proposal.values.title
    date = $proposal.values.date
    address = $proposal.values.address
    source = $proposal.metadata.source
    open_conversations = 0
  } | ConvertTo-Json -Depth 6
}
finally {
  Stop-Job $job -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $job -ErrorAction SilentlyContinue | Out-Null
  if (Test-Path 'server/data/state.json') {
    Remove-Item 'server/data/state.json' -Force -ErrorAction SilentlyContinue
  }
}
