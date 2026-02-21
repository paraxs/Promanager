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

  $initial = Invoke-RestMethod -Uri 'http://localhost:8788/api/telemetry/presets' -Method Get
  if (-not $initial.ok) {
    throw 'Initiales Telemetrie-GET fehlgeschlagen.'
  }

  $event1 = @{
    channel = 'dispatch'
    action = 'applied'
    presetId = 'ausgeglichen'
  } | ConvertTo-Json -Depth 4

  $event2 = @{
    channel = 'dispatch'
    action = 'approved'
    presetId = 'ausgeglichen'
  } | ConvertTo-Json -Depth 4

  $event3 = @{
    channel = 'agent'
    action = 'applied'
    presetId = 'voice'
  } | ConvertTo-Json -Depth 4

  Invoke-RestMethod -Uri 'http://localhost:8788/api/telemetry/presets/event' -Method Post -ContentType 'application/json' -Body $event1 | Out-Null
  Invoke-RestMethod -Uri 'http://localhost:8788/api/telemetry/presets/event' -Method Post -ContentType 'application/json' -Body $event2 | Out-Null
  Invoke-RestMethod -Uri 'http://localhost:8788/api/telemetry/presets/event' -Method Post -ContentType 'application/json' -Body $event3 | Out-Null

  $afterEvents = Invoke-RestMethod -Uri 'http://localhost:8788/api/telemetry/presets' -Method Get
  if (($afterEvents.telemetry.dispatch.appliedByPreset.ausgeglichen -as [int]) -lt 1) {
    throw 'Dispatch applied Counter wurde nicht inkrementiert.'
  }
  if (($afterEvents.telemetry.dispatch.approvedByPreset.ausgeglichen -as [int]) -lt 1) {
    throw 'Dispatch approved Counter wurde nicht inkrementiert.'
  }
  if (($afterEvents.telemetry.agent.appliedByPreset.voice -as [int]) -lt 1) {
    throw 'Agent applied Counter wurde nicht inkrementiert.'
  }

  $exported = Invoke-RestMethod -Uri 'http://localhost:8788/api/telemetry/presets/export' -Method Get
  if (-not $exported.ok) {
    throw 'Telemetrie-Export fehlgeschlagen.'
  }
  if (-not $exported.telemetry.events -or $exported.telemetry.events.Count -lt 3) {
    throw 'Zu wenige Events im Export.'
  }

  Invoke-RestMethod -Uri 'http://localhost:8788/api/telemetry/presets/reset' -Method Post -ContentType 'application/json' -Body '{}' | Out-Null
  $afterReset = Invoke-RestMethod -Uri 'http://localhost:8788/api/telemetry/presets' -Method Get
  if (($afterReset.telemetry.eventsCount -as [int]) -ne 0) {
    throw 'Reset hat Events nicht geloescht.'
  }

  [pscustomobject]@{
    ok = $true
    before_events = $initial.telemetry.eventsCount
    after_events = $afterEvents.telemetry.eventsCount
    after_reset = $afterReset.telemetry.eventsCount
  } | ConvertTo-Json -Depth 5
}
finally {
  Stop-Job $job -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $job -ErrorAction SilentlyContinue | Out-Null
  if (Test-Path 'server/data/state.json') {
    Remove-Item 'server/data/state.json' -Force -ErrorAction SilentlyContinue
  }
}
