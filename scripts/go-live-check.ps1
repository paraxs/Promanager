$ErrorActionPreference = 'Stop'
Set-Location 'c:\Promanager1'

$checks = @(
  @{ name = 'lint'; cmd = 'npm run lint' },
  @{ name = 'test'; cmd = 'npm run test' },
  @{ name = 'build'; cmd = 'npm run build' },
  @{ name = 'e2e'; cmd = 'npm run test:e2e' },
  @{ name = 'backup_drill'; cmd = 'npm run ops:backup-drill' }
)

$results = @()

foreach ($check in $checks) {
  Write-Host "Running $($check.name): $($check.cmd)"
  cmd /c $check.cmd
  $exitCode = $LASTEXITCODE
  $ok = ($exitCode -eq 0)
  $results += [pscustomobject]@{
    name = $check.name
    command = $check.cmd
    ok = $ok
    exitCode = $exitCode
  }
  if (-not $ok) {
    break
  }
}

$requiredSecrets = @(
  'NETLIFY_AUTH_TOKEN_STAGING',
  'NETLIFY_SITE_ID_STAGING',
  'VITE_API_BASE_URL_STAGING',
  'API_STAGING_DEPLOY_HOOK_URL',
  'STAGING_HEALTH_URL',
  'STAGING_READONLY_API_KEY',
  'ALERT_WEBHOOK_URL'
)

$secretStatus = $requiredSecrets | ForEach-Object {
  $value = [Environment]::GetEnvironmentVariable($_)
  [pscustomobject]@{
    name = $_
    present = -not [string]::IsNullOrWhiteSpace($value)
  }
}

$missingSecrets = @($secretStatus | Where-Object { -not $_.present } | Select-Object -ExpandProperty name)
$allChecksOk = (@($results | Where-Object { -not $_.ok }).Count -eq 0)

[pscustomobject]@{
  ok = $allChecksOk
  checkedAt = (Get-Date).ToString('s')
  checks = $results
  stagingSecretsPresent = (@($missingSecrets).Count -eq 0)
  missingStagingSecrets = $missingSecrets
} | ConvertTo-Json -Depth 6

if (-not $allChecksOk) {
  exit 1
}
