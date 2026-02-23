# Go-Live Check (Final)

## 1) Secrets-Checkliste (Staging)

GitHub Actions Secrets (`Settings -> Secrets and variables -> Actions`):

- `NETLIFY_AUTH_TOKEN_STAGING`
- `NETLIFY_SITE_ID_STAGING`
- `VITE_API_BASE_URL_STAGING`
- `API_STAGING_DEPLOY_HOOK_URL`
- `STAGING_HEALTH_URL`
- `STAGING_READONLY_API_KEY`
- `ALERT_WEBHOOK_URL`

API/Server Runtime (Host env):

- `SECURITY_AUTH_ENABLED=1`
- `SECURITY_OWNER_KEYS`, `SECURITY_DISPATCHER_KEYS`, `SECURITY_READONLY_KEYS`
- `SECURITY_CORS_ORIGINS=<staging-frontend-domain>`
- `TELEGRAM_WEBHOOK_SECRET`
- `BACKUP_ENABLED=1`, `BACKUP_DAILY_ENABLED=1`
- `GOOGLE_DAILY_RESYNC_ENABLED=1`
- `GOOGLE_WEEKLY_HARD_RESYNC_ENABLED=1`

Frontend Runtime (Host env):

- `VITE_API_BASE_URL=https://<staging-api-domain>`

## 2) End-to-End Testablauf (manuell, live)

1. `Deploy Staging` Workflow manuell starten.
2. `Monitor Staging Health` starten oder auf nächsten Schedule warten.
3. Telegram Testnachricht senden (strukturierter Termintext).
4. Im Dashboard `Telegram Sync` ausfuehren.
5. Karte oeffnen und Feldzuordnung pruefen (Titel, Datum/Uhrzeit, Adresse, Quelle).
6. Karte auf `Terminiert` setzen.
7. `Google Sync jetzt` ausfuehren.
8. Event im Google Kalender pruefen.
9. Diagnosepanel pruefen:
   - Server/Webhook: OK
   - LLM: bereit (falls aktiv)
   - Kalender: bereit + Schreibzugriff
   - Alerts: keine `critical`
10. Backup-Drill laufen lassen (`npm run ops:backup-drill`) und Ergebnis protokollieren.

## 3) Automatischer lokaler Go-Live Check

```bash
npm run ops:go-live-check
```

Enthaelt:

- `lint`
- `test`
- `build`
- `test:e2e`
- `ops:backup-drill`
- plus Hinweis, welche Staging-Secrets im aktuellen Terminal fehlen
