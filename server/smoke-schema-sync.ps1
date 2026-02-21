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

  $schemaPayload = @{
    database = @{
      id = 'service-card-db'
      name = 'Service Cards'
      properties = @(
        @{ id = 'title'; name = 'Titel'; type = 'text'; system = $true; required = $true },
        @{ id = 'status'; name = 'Status'; type = 'select'; system = $true; required = $true; options = @('Eingang / Anfrage','Warteschlange','Terminiert','Erledigt') },
        @{ id = 'address'; name = 'Adresse'; type = 'text'; system = $true },
        @{ id = 'location'; name = 'Ort'; type = 'text'; system = $true },
        @{ id = 'phone'; name = 'Telefon'; type = 'text'; system = $true },
        @{ id = 'date'; name = 'Datum'; type = 'date'; system = $true },
        @{ id = 'uhrzeit'; name = 'Uhrzeit'; type = 'text'; system = $false }
      )
    }
  } | ConvertTo-Json -Depth 10

  Invoke-RestMethod -Uri 'http://localhost:8788/api/board/schema' -Method Post -ContentType 'application/json' -Body $schemaPayload | Out-Null

  $update = @{
    update_id = 9201
    message = @{
      message_id = 701
      chat = @{ id = 90051; type = 'private' }
      from = @{ id = 5; first_name = 'Schema'; username = 'schema_test' }
      text = 'Termin: morgen 15 Uhr, Ort: Lienz, Adresse: Peter Weber Gasse, Datum: 19.02.2026'
    }
  } | ConvertTo-Json -Depth 8

  Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $update | Out-Null
  $pending = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/pending' -Method Get
  $proposal = $pending.items[0]

  [pscustomobject]@{
    title = $proposal.values.title
    date = $proposal.values.date
    location = $proposal.values.location
    address = $proposal.values.address
    uhrzeit = $proposal.values.uhrzeit
    comment = $proposal.metadata.comment
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
