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

  $schemaBody = @{
    database = @{
      id = 'service-card-db'
      name = 'Service Cards'
      properties = @(
        @{ id = 'title'; name = 'Titel'; type = 'text'; system = $true; required = $true },
        @{ id = 'status'; name = 'Status'; type = 'select'; system = $true; required = $true; options = @('Eingang / Anfrage', 'Warteschlange', 'Terminiert', 'Erledigt') },
        @{ id = 'date'; name = 'Datum'; type = 'date'; system = $true },
        @{ id = 'address'; name = 'Adresse'; type = 'text'; system = $true },
        @{ id = 'location'; name = 'Ort'; type = 'text'; system = $true },
        @{ id = 'phone'; name = 'Telefon'; type = 'text'; system = $true },
        @{ id = 'quelle'; name = 'Quelle'; type = 'select'; options = @('E-Mail', 'WhatsApp', 'Telefon', 'Im Gespräch') }
      )
    }
  } | ConvertTo-Json -Depth 10

  Invoke-RestMethod -Uri 'http://localhost:8788/api/board/schema' -Method Post -ContentType 'application/json' -Body $schemaBody | Out-Null

  $update = @{
    update_id = 9981
    message = @{
      message_id = 1701
      chat = @{ id = 90631; type = 'private' }
      from = @{ id = 64; first_name = 'SourceProp'; username = 'source_property_test' }
      text = 'Titel: Quellen Property Test Datum: 19.02.2026 Adresse: Peter Weber Gasse Quelle: WhatsApp'
    }
  } | ConvertTo-Json -Depth 8

  Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/webhook' -Method Post -ContentType 'application/json' -Body $update | Out-Null
  $pending = Invoke-RestMethod -Uri 'http://localhost:8788/api/telegram/pending' -Method Get
  $proposal = $pending.items[0]

  [pscustomobject]@{
    title = $proposal.values.title
    date = $proposal.values.date
    address = $proposal.values.address
    metadata_source = $proposal.metadata.source
    value_quelle = $proposal.values.quelle
  } | ConvertTo-Json -Depth 6
}
finally {
  Stop-Job $job -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $job -ErrorAction SilentlyContinue | Out-Null
  if (Test-Path 'server/data/state.json') {
    Remove-Item 'server/data/state.json' -Force -ErrorAction SilentlyContinue
  }
}
