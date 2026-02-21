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
    update_id = 7101
    message = @{
      message_id = 401
      chat = @{ id = 90021; type = 'private' }
      from = @{ id = 2; first_name = 'Test'; username = 'test_user2' }
      text = 'Termin: morgen 15 Uhr Ort lienz, Peter Weber Gasse, Datum: 19.02.2026.'
    }
  } | ConvertTo-Json -Depth 8

  Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $update | Out-Null
  $pending = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/pending' -Method Get
  $proposal = $pending.items[0]

  [pscustomobject]@{
    title = $proposal.values.title
    status = $proposal.values.status
    date = $proposal.values.date
    address = $proposal.values.address
    location = $proposal.values.location
    phone = $proposal.values.phone
    comment = $proposal.metadata.comment
    confidence = $proposal.confidence
    reasoning = $proposal.reasoning
  } | ConvertTo-Json -Depth 6
}
finally {
  Stop-Job $job -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $job -ErrorAction SilentlyContinue | Out-Null
  if (Test-Path 'server/data/state.json') {
    Remove-Item 'server/data/state.json' -Force -ErrorAction SilentlyContinue
  }
}
