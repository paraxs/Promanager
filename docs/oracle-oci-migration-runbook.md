# Oracle OCI Migration Runbook

This runbook covers moving the ProManager API from Render to an Oracle Cloud Infrastructure VM while keeping the Netlify frontend.

## Target setup

- Frontend stays on Netlify.
- API runs on one Oracle Cloud Infrastructure VM in `eu-frankfurt-1`.
- TLS termination and reverse proxy are handled by Caddy.
- Persistent app data lives on a separate block volume mounted at `/srv/promanager-data`.

## 1) OCI prerequisites

Create these resources in Oracle Cloud Infrastructure:

1. An Always Free eligible VM with Ubuntu 24.04, public IPv4, and your SSH public key.
2. One reserved public IP and attach it to the VM.
3. Ingress rules for TCP `22`, `80`, and `443`.
4. A domain or subdomain for the API, for example `api.example.com`, pointing via `A` record to the reserved public IP.
5. One block volume for persistent ProManager data.

Notes:

- The Oracle console currently sends unauthenticated users to the Cloud Sign In page and asks for the Cloud Account Name before login.
- Keep Render online until the Oracle instance is healthy and Telegram plus frontend cutover are complete.

## 2) VM bootstrap

SSH into the VM:

```bash
ssh ubuntu@YOUR_RESERVED_IP
```

Install base packages, Node.js 20, and Caddy:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs caddy
node -v
npm -v
```

## 3) Attach and mount persistent storage

After attaching the OCI block volume to the VM, identify the device:

```bash
lsblk
sudo mkfs.ext4 /dev/oracleoci/oraclevdb
sudo mkdir -p /srv/promanager-data
sudo blkid /dev/oracleoci/oraclevdb
```

Add the volume to `/etc/fstab` using its UUID:

```fstab
UUID=YOUR_UUID /srv/promanager-data ext4 defaults,nofail 0 2
```

Then mount and verify:

```bash
sudo mount -a
df -h
```

## 4) Deploy the app

```bash
sudo mkdir -p /opt/promanager
sudo chown -R $USER:$USER /opt/promanager /srv/promanager-data
git clone https://github.com/paraxs/Promanager.git /opt/promanager/app
cd /opt/promanager/app
npm ci
rm -rf server/data
ln -s /srv/promanager-data server/data
mkdir -p /srv/promanager-data/backups
```

## 5) Production environment

Create `/opt/promanager/app/.env`:

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
TELEGRAM_MVP_HOST=0.0.0.0
TELEGRAM_MVP_PORT=8787

LLM_ENABLED=1
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
LLM_TIMEOUT_MS=12000

GOOGLE_ENABLED=0

SECURITY_AUTH_ENABLED=1
SECURITY_OWNER_KEYS=...
SECURITY_DISPATCHER_KEYS=...
SECURITY_READONLY_KEYS=...
SECURITY_CORS_ORIGINS=https://promanager-live-2026.netlify.app

SECURITY_RATE_LIMIT_ENABLED=1
SECURITY_RATE_LIMIT_WINDOW_MS=60000
SECURITY_RATE_LIMIT_MAX=180
SECURITY_RATE_LIMIT_WEBHOOK_MAX=300

BACKUP_ENABLED=1
BACKUP_DAILY_ENABLED=1
BACKUP_DAILY_HOUR_UTC=2
BACKUP_RETENTION_DAYS=45
```

For Google sync later, additionally set:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_ENABLED=1`

## 6) systemd service

Create `/etc/systemd/system/promanager.service`:

```ini
[Unit]
Description=Promanager API
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/opt/promanager/app
Environment=NODE_ENV=production
EnvironmentFile=/opt/promanager/app/.env
ExecStart=/usr/bin/node server/index.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now promanager
sudo systemctl status promanager
```

## 7) HTTPS with Caddy

Create `/etc/caddy/Caddyfile`:

```caddy
api.example.com {
  encode gzip
  reverse_proxy 127.0.0.1:8787
}
```

Reload Caddy and verify:

```bash
sudo systemctl reload caddy
curl https://api.example.com/api/health
```

## 8) Data migration from Render

Preferred order:

1. Freeze risky changes on Render.
2. Create one final backup on the current host.
3. Copy the current `server/data` contents, or at minimum the latest backup files, to `/srv/promanager-data`.
4. Start Oracle service and verify `/api/health`.
5. Confirm board data, pending Telegram proposals, audit trail, and backups are present.

If you only migrate backup files, verify restore behavior before cutover.

## 9) Cutover

Set Telegram webhook to the Oracle domain:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -d "url=https://api.example.com/api/telegram/webhook" \
  -d "secret_token=<YOUR_WEBHOOK_SECRET>"
```

Point Netlify production to the Oracle API:

```bash
npx netlify-cli env:set VITE_API_BASE_URL https://api.example.com --context production
npx netlify-cli deploy --prod
```

Only disable Render after Oracle is healthy and production traffic is confirmed.

## 10) Post-cutover checks

Run these checks immediately after switch:

1. `curl https://api.example.com/api/health`
2. Open the dashboard and verify board data.
3. Trigger `Telegram Sync`.
4. Send one Telegram test message.
5. Confirm backup directory exists under `/srv/promanager-data/backups`.
6. If Google sync is enabled, run one manual sync and inspect diagnostics.

## Official references

- Oracle Always Free resources: https://docs.oracle.com/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Reserved public IPs: https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/reserved-public-ip-create.htm
- Public IP behavior: https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/managingpublicIPs.htm
- Consistent device paths for block volumes: https://docs.oracle.com/en-us/iaas/Content/Block/References/consistentdevicepaths.htm
- Publish a web server on OCI: https://docs.oracle.com/en/learn/publish-webserver-using-oci/
- Caddy reverse proxy quick start: https://caddyserver.com/docs/quick-starts/reverse-proxy
- Telegram Bot API webhook docs: https://core.telegram.org/bots/api
