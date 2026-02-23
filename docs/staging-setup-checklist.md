# Staging Setup Checklist

1. Generate API keys:

```bash
npm run ops:generate-api-keys
```

2. Configure API host (Render/Fly/Railway) with values from `.env.staging.example`.
3. Configure frontend host (Netlify/Vercel) with `VITE_API_BASE_URL` pointing to staging API.
4. Configure GitHub repository secrets for automated deploy:
   - `NETLIFY_AUTH_TOKEN_STAGING`
   - `NETLIFY_SITE_ID_STAGING`
   - `VITE_API_BASE_URL_STAGING`
   - `API_STAGING_DEPLOY_HOOK_URL`
   - `STAGING_HEALTH_URL`
   - `STAGING_READONLY_API_KEY`
   - `ALERT_WEBHOOK_URL`
5. Run staging deploy workflow: `.github/workflows/deploy-staging.yml`.
6. Verify health monitor workflow runs green: `.github/workflows/monitor-staging-health.yml`.
7. Verify config panel shows:
   - Auth aktiv: Ja
   - Webhook verbunden
   - LLM bereit
   - Kalender bereit
   - Backup aktiv
8. Run final local readiness check:

```bash
npm run ops:go-live-check
```
