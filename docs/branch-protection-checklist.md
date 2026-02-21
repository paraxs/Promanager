# Branch Protection Checklist

Repository: `paraxs/Promanager`
Branch: `main`

## Required checks

Set these required status checks in GitHub branch protection for `main`:

- `Lint`
- `Test`
- `Build`
- `E2E (Playwright Chromium)`

## Recommended protection flags

- Require pull request before merging
- Require approvals: minimum 1
- Dismiss stale approvals on new commits
- Require conversation resolution before merge
- Require branches to be up to date before merging
- Restrict direct pushes to `main`
- Include administrators

## Working model

1. Create feature branch: `feature/<topic>`
2. Open PR to `main`
3. Wait for all required checks to pass
4. Merge PR
5. Delete feature branch
