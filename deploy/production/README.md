# Production Deployment Templates

Frontend (Netlify Live)
- Root config: `netlify.toml`
- Frontend env template: `deploy/production/frontend.env.example`
- Build command: `npm run build`
- Publish: `dist`
- Required env in Netlify:
  - `VITE_API_BASE_URL=https://<production-api-domain>`

API (Render)
- Production blueprint: `deploy/production/render-api.yaml`
- Persistent disk mount: `/opt/render/project/src/server/data`
- Set all `sync: false` values in Render Dashboard (secrets).

GitHub Actions live workflow
- `.github/workflows/deploy-live.yml`
- Configure repository secrets:
  - `NETLIFY_AUTH_TOKEN_PROD`
  - `NETLIFY_SITE_ID_PROD`
  - `VITE_API_BASE_URL_PROD`

Local runbook
- `docs/netlify-live-runbook.md`
