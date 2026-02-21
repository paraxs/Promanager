# Production Operations Runbook

## Deployment target

Recommended split:

- Frontend: Netlify or Vercel (static Vite build)
- API: dedicated Node host (Render/Fly.io/Railway/VM) for Telegram webhook and Google sync

Reason: Telegram webhooks and persistent server state are not a fit for static-only hosting.

## Environment strategy

Use separate env sets:

- Development: `.env.development.example`
- Staging: `.env.staging.example`
- Production: `.env.production.example`

Never commit real secrets. Use host secret manager.

## Security baseline

- Enable `SECURITY_AUTH_ENABLED=1` in staging/prod
- Provide at least one owner key via `SECURITY_OWNER_KEYS`
- Set strict `SECURITY_CORS_ORIGINS` to real frontend domains
- Keep webhook protected with `TELEGRAM_WEBHOOK_SECRET`
- Keep rate-limit active (`SECURITY_RATE_LIMIT_ENABLED=1`)

Client auth headers:

- `x-promanager-api-key: <key>` or
- `Authorization: Bearer <key>`

Roles:

- Owner: config/security/backup/restore
- Dispatcher: sync actions + telemetry events
- ReadOnly: read board/health

## Backups and restore

Server persists under:

- `server/data/state.json`
- Daily/manual backups: `server/data/backups/*.json`

API endpoints:

- `GET /api/backups`
- `POST /api/backups/run`
- `POST /api/backups/restore`

Daily backup config:

- `BACKUP_ENABLED`
- `BACKUP_DAILY_ENABLED`
- `BACKUP_DAILY_HOUR_UTC`
- `BACKUP_RETENTION_DAYS`

## Restore test (monthly)

1. `POST /api/backups/run` with reason `restore-drill`
2. Verify backup appears in `GET /api/backups`
3. Restore latest file using `POST /api/backups/restore`
4. Verify health + board data + telegram pending state
5. Record result in operations log

## Monitoring and alerting

- Dashboard Diagnosepanel: warnings + security + backup health
- `GET /api/health` for external checks
- Optional webhook alerts via `ALERT_WEBHOOK_URL`

Critical health states:

- Google sync failed
- Auth enabled but no owner key
- Backup stale/missing when daily backup enabled

## Google sync conflict policy

Current sync hardening includes:

- Re-linking orphaned events
- Recreate on deleted/invalid target events
- Deduplication of duplicate events
- Daily optional resync

Operational guidance:

- Use normal sync for routine updates
- Use hard resync when diagnosis shows repeated event-link failures
- Review sync counts and errors in diagnostics after each run
