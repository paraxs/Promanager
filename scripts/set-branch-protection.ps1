param(
  [Parameter(Mandatory = $true)][string]$Owner,
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$Branch = 'main',
  [string]$Token = $env:GITHUB_TOKEN
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Token)) {
  throw 'GITHUB_TOKEN fehlt. Setze ein Personal Access Token mit repo/admin:repo_hook Rechten.'
}

$uri = "https://api.github.com/repos/$Owner/$Repo/branches/$Branch/protection"
$headers = @{
  Authorization = "Bearer $Token"
  Accept = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
}

$body = @{
  required_status_checks = @{
    strict = $true
    contexts = @(
      'Lint',
      'Test',
      'Build',
      'E2E (Playwright Chromium)'
    )
  }
  enforce_admins = $true
  required_pull_request_reviews = @{
    dismiss_stale_reviews = $true
    require_code_owner_reviews = $false
    required_approving_review_count = 1
  }
  restrictions = $null
  required_linear_history = $false
  allow_force_pushes = $false
  allow_deletions = $false
  block_creations = $false
  required_conversation_resolution = $true
  lock_branch = $false
  allow_fork_syncing = $false
}

Invoke-RestMethod -Method Put -Uri $uri -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 10)
Write-Host "Branch protection fuer $Owner/$Repo:$Branch wurde gesetzt."
