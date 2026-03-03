# Netlify Live Runbook

## 1) Voraussetzungen

- Frontend API-URL ist bekannt: `VITE_API_BASE_URL=https://<api-domain>`
- Netlify Site ist angelegt und liefert eine `SITE_ID`
- Netlify Personal Access Token ist vorhanden

## 2) Lokal mit Tool deployen (Live)

PowerShell:

```powershell
$env:NETLIFY_AUTH_TOKEN="<netlify-token>"
$env:NETLIFY_SITE_ID="<netlify-site-id>"
$env:VITE_API_BASE_URL="https://<api-domain>"
npm run deploy:netlify:live
```

Preview statt Live:

```powershell
npm run deploy:netlify:preview
```

Dry-Run (Build ja, Deploy nein):

```powershell
npm run deploy:netlify:live:dry-run
```

## 3) GitHub Actions Live Deploy

Workflow: `.github/workflows/deploy-live.yml`

Benötigte Repository-Secrets:

- `NETLIFY_AUTH_TOKEN_PROD`
- `NETLIFY_SITE_ID_PROD`
- `VITE_API_BASE_URL_PROD`

Start:

1. GitHub -> Actions -> `Deploy Live`
2. `Run workflow`
3. Nach Abschluss Netlify Deploy-URL pruefen

## 4) Netlify UI Konfiguration

- Build command: `npm run build`
- Publish directory: `dist`
- Node version: `20`
- Environment Variable:
  - `VITE_API_BASE_URL=https://<api-domain>`

Hinweis: Die Root-`netlify.toml` im Repo enthält Build/Publish und SPA-Redirect (`/* -> /index.html`).
