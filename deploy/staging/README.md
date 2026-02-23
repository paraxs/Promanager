# Staging Deployment Templates

Frontend (Netlify)
- Template: `deploy/staging/netlify.toml`
- Frontend env template: `deploy/staging/frontend.env.example`
- Build command: `npm run build`
- Publish: `dist`
- Required env in Netlify:
  - `VITE_API_BASE_URL=https://<staging-api-domain>`

API (Render/Fly/Railway)
- Render blueprint template: `deploy/staging/render-api.yaml`
- Set secrets from `.env.staging.example` in host UI.

GitHub Actions deploy workflow
- `.github/workflows/deploy-staging.yml`
- Configure repository secrets:
  - `NETLIFY_AUTH_TOKEN_STAGING`
  - `NETLIFY_SITE_ID_STAGING`
  - `VITE_API_BASE_URL_STAGING`
  - `API_STAGING_DEPLOY_HOOK_URL`
  - `STAGING_HEALTH_URL`
  - `STAGING_READONLY_API_KEY`
  - `ALERT_WEBHOOK_URL`
