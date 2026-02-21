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
  node server/index.mjs
}

try {
  Start-Sleep -Seconds 1

  $update = @{
    update_id = 9961
    message = @{
      message_id = 1501
      chat = @{ id = 90611; type = 'private' }
      from = @{ id = 62; first_name = 'AddressOnly'; username = 'address_only_test' }
      text = 'Titel: Test Adresse Datum: 19.02.2026 Adresse: Peter Weber Gasse'
    }
  } | ConvertTo-Json -Depth 8

  Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $update | Out-Null

  $pending = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/pending' -Method Get
  $conversations = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/conversations' -Method Get
  $proposal = $pending.items[0]

  [pscustomobject]@{
    title = $proposal.values.title
    date = $proposal.values.date
    address = $proposal.values.address
    location = $proposal.values.location
    open_conversations = @($conversations.items).Count
    missing = if (@($conversations.items).Count -gt 0) { ($conversations.items[0].missingPropertyIds -join ', ') } else { '' }
  } | ConvertTo-Json -Depth 6
}
finally {
  Stop-Job $job -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $job -ErrorAction SilentlyContinue | Out-Null
  if (Test-Path 'server/data/state.json') {
    Remove-Item 'server/data/state.json' -Force -ErrorAction SilentlyContinue
  }
}
