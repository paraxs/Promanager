# ProManager

Kanban-basiertes Service- und Termin-Management fuer Projekte.

## Features

- Konfigurierbarer Dashboard-Titel und Untertitel
- Kanban-Workflow mit Statuswechsel, Historie und Kommentaren
- Umschaltbare Board-Ansicht: Kartenansicht oder Tabellenansicht
- Tabellenansicht mit speicherbaren Spalten (ein-/ausblenden + Reihenfolge)
- Erweiterbare Quellen an Karten (Telefon, SMS, WhatsApp, Messenger, E-Mail, Persoenlich, Post + eigene)
- Zentrale Quellen-Verwaltung im Eigenschaften-Dialog (global hinzufuegen/entfernen)
- Quelle global umbenennen (inkl. Migration in Karten und Quellen-Properties)
- Karten einklappen (mobile-optimiert)
- Archiv mit Wiederherstellen
- JSON Export/Import inkl. UI-Einstellungen
- PDF Export (A4, druckoptimiert)
- Google Calendar One-Way Sync (Status `Terminiert` + Datum/Uhrzeit -> Event)
- Google Calendar Produktionshaertung: Relink/Recreate bei geloeschten/geaenderten Events + Dublettenbereinigung
- Optionaler Auto-Sync: Telegram-Import -> Google Calendar
- Optionaler taeglicher Hintergrund-Resync fuer Kalender-Konsistenz
- Optionaler woechentlicher Hard-Resync fuer Kalender-Konsistenz
- `google_event_id`/Sync-Status je Karte in `card.values`
- KI-Slot-Vorschlaege aus Google Calendar (freie Zeitfenster)
- Diagnosepanel fuer Server, Telegram Webhook, LLM und Google Calendar
- Technik-Konfigurationspanel im Dashboard (LLM/Google/Agent/Guardrail/Security/Backup) fuer Laufzeitbetrieb
- Operations Radar mit Prioritaetswarnungen und Autopilot fuer sichere Quick-Fixes
- Dispatch Center (Freigabe-Modus): priorisierte Einsatzvorschlaege mit Slot-Zuordnung und manueller Freigabe
- Dispatch Presets im Config-Panel (Konservativ/Ausgeglichen/Aggressiv) mit 1-Klick-Uebernahme
- Agent-Presets im Config-Panel (Fokus/Ausgeglichen/Voice-First) mit 1-Klick-Uebernahme
- Preset-Telemetrie im Diagnosepanel (Preset-Nutzung + Dispatch-Freigabe/Verwerfungswirkung)
- Zentrale Preset-Telemetrie serverseitig (geraeteuebergreifend) inkl. Reset/Export und Wochenranking
- API-Rollenmodell (Owner/Dispatcher/ReadOnly) mit API-Key Headern (optional aktivierbar)
- Striktes CORS + Rate-Limit fuer API/Webhook (konfigurierbar)
- Geplante Backups mit Aufbewahrung, manueller Backup/Restore-API und Backup-Health
- Smart-Suche und Schnellfilter (Ueberfaellig, Heute/Morgen, fehlende Basisdaten)
- Bulk-Aktion: erledigte Karten gesammelt archivieren
- Telegram-Dedupe auf Update- und Nachrichtenebene (robuster gegen Mehrfachimporte)

## Voraussetzungen

- Node.js 20+
- npm 10+

## Lokale Entwicklung

```bash
npm install
npm run dev
```

App startet standardmaessig unter `http://localhost:5173`.

## Neustart nach PC-Reboot (Quick-Runbook)

1. Projektordner oeffnen (`C:\Promanager1`)
2. Frontend starten:

```bash
npm run dev
```

3. API/Telegram-Server in zweitem Terminal starten:

```bash
npm run server:dev
```

4. Health pruefen:

```bash
curl http://localhost:8787/api/health
```

5. Wenn TryCloudflare-URL neu ist:
   - neuen Tunnel starten
   - Webhook neu setzen auf `https://<NEUE-URL>/api/telegram/webhook`
   - im Dashboard `Menue -> Telegram Sync`

## Telegram MVP (Webhook + Confirm-Flow)

### 1) API-Server starten

```bash
npm run server:dev
```

Der Server laeuft standardmaessig auf `http://localhost:8787`.
`npm run server:dev` laedt automatisch Variablen aus `.env`.

### 2) Umgebungsvariablen

Nutze `.env.example` als Vorlage:

- `TELEGRAM_BOT_TOKEN` (von BotFather)
- `TELEGRAM_WEBHOOK_SECRET` (frei waehlbarer Secret-Header)
- `TELEGRAM_MVP_PORT` (optional, default `8787`)
- `TELEGRAM_MVP_HOST` (optional, default `0.0.0.0`)
- `LLM_ENABLED` (`1` oder `0`)
- `LLM_MIN_CONFIDENCE` (z. B. `0.70`)
- `LLM_STRATEGY` (`dominant` | `hybrid` | `fallback`, default `dominant`)
- `LLM_REPAIR_PASS` (`1` oder `0`, default `1`)
- `LLM_REPAIR_MIN_CONFIDENCE` (z. B. `0.82`)
- `LLM_REPAIR_MAX_TRIES` (`1` bis `3`, default `2`)
- `AGENT_ENABLED` (`1` oder `0`, default `1`)
- `AGENT_CRITICAL_FIELDS` (CSV, nur diese Felder loesen Rueckfragen aus; z. B. `date,address,uhrzeit,source`)
- `AGENT_PROPERTY_PRIORITY` (CSV `feld:score`, hoehere Werte zuerst; z. B. `date:100,uhrzeit:97,source:94,address:90,location:78`)
- `AGENT_FOLLOWUP_INCLUDE_REQUIRED` (`1` oder `0`, default `0`; wenn `1`, werden zusätzlich alle `required`-Properties nachgefragt)
- `AGENT_REQUIRED_FIELDS` (Legacy alias fuer `AGENT_CRITICAL_FIELDS`)
- `IMPORT_GUARDRAIL_CONFIDENCE` (z. B. `0.65`, darunter kein direkter Import)
- `OPENAI_API_KEY` (wenn LLM aktiviert)
- `OPENAI_BASE_URL` (OpenAI-kompatible API, default `https://api.openai.com/v1`)
- `OPENAI_MODEL` (z. B. `gpt-4.1-mini`)
- `LLM_TIMEOUT_MS` (optional, default `12000`)
- `GOOGLE_ENABLED` (`1` oder `0`)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_CALENDAR_ID` (optional, alternativ automatische Suche/Erstellung ueber `GOOGLE_CALENDAR_NAME`)
- `GOOGLE_CALENDAR_NAME` (default `Projekte Firma 2026`)
- `GOOGLE_TIMEZONE` (default `Europe/Vienna`)
- `GOOGLE_EVENT_DURATION_MIN` (default `90`)
- `GOOGLE_SLOT_WINDOW_DAYS` (default `14`)
- `GOOGLE_SHARE_ROLE` (`writer` | `reader` | `owner` | `freeBusyReader`)
- `GOOGLE_SHARED_WITH` (mehrere E-Mails mit `,` oder `;` getrennt)
- `AUTO_GOOGLE_SYNC_ON_TELEGRAM_IMPORT` (`1` oder `0`)
- `GOOGLE_DAILY_RESYNC_ENABLED` (`1` oder `0`)
- `GOOGLE_WEEKLY_HARD_RESYNC_ENABLED` (`1` oder `0`)
- `GOOGLE_WEEKLY_HARD_RESYNC_DAY_UTC` (`0`=So bis `6`=Sa)
- `GOOGLE_WEEKLY_HARD_RESYNC_HOUR_UTC` (`0` bis `23`)
- `DISPATCH_ENABLED` (`1` oder `0`)
- `DISPATCH_MIN_SCORE` (`0` bis `200`, default `55`)
- `DISPATCH_MAX_DAILY_SLOTS` (`1` bis `20`, default `3`)
- `DISPATCH_REQUIRED_FIELDS` (CSV, z. B. `date,address,source`)
- `DISPATCH_SCORE_WEIGHTS` (CSV `regel:wert`, z. B. `eingang:80,warteschlange:65,...`)
- `SECURITY_AUTH_ENABLED` (`1` oder `0`, default `0`)
- `SECURITY_OWNER_KEYS`, `SECURITY_DISPATCHER_KEYS`, `SECURITY_READONLY_KEYS` (CSV API Keys)
- `SECURITY_CORS_ORIGINS` (CSV oder `*`)
- `SECURITY_RATE_LIMIT_ENABLED` (`1` oder `0`)
- `SECURITY_RATE_LIMIT_WINDOW_MS` (default `60000`)
- `SECURITY_RATE_LIMIT_MAX` (default `300`)
- `SECURITY_RATE_LIMIT_WEBHOOK_MAX` (default `200`)
- `BACKUP_ENABLED` (`1` oder `0`)
- `BACKUP_DAILY_ENABLED` (`1` oder `0`)
- `BACKUP_DAILY_HOUR_UTC` (`0` bis `23`, default `2`)
- `BACKUP_RETENTION_DAYS` (`1` bis `365`, default `21`)
- `ALERT_WEBHOOK_URL` (optionaler Webhook fuer Security/Backup Alerts)
- Frontend (Staging/Prod, getrennte API): `VITE_API_BASE_URL=https://<api-domain>`

### 3) Webhook bei Telegram setzen

Beispiel:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=<PUBLIC_URL>/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

### 4) Ablauf

1. Nachricht im Bot senden (Vorlage mit `Feld: Wert`)
2. Rule-Parser extrahiert Felder nach `database.properties`
3. Optional (wenn aktiviert): LLM verfeinert Extraktion mit Confidence-Score
4. Bei `LLM_STRATEGY=dominant`: AI-Ergebnis ist primaer, Rule-Parser bleibt Fallback
5. Optionaler Repair-Pass korrigiert niedrige Confidence oder fehlende Felder
6. Optional Agent-Flow stellt Rueckfragen nur zu kritischen Feldern und in priorisierter Reihenfolge
7. Bot antwortet mit Vorschau + Confidence
8. Guardrail:
   - confidence >= `IMPORT_GUARDRAIL_CONFIDENCE`: `Importieren` / `Verwerfen`
   - confidence < `IMPORT_GUARDRAIL_CONFIDENCE`: `Nachbearbeiten` / `Verwerfen`
9. Bei `Nachbearbeiten` sendet der Bot eine editierbare Vorlage, die erneut geschickt wird
10. Bei `Importieren` wird eine Karte persistent gespeichert
11. Audit-Event wird geschrieben
12. Im Dashboard: `Menue -> Telegram Sync`
13. Optional: `Menue -> Google Sync jetzt` fuer Board -> Google Calendar
14. Bei Konflikten/kaputten Event-Links: `Menue -> Google Resync (hart)` fuer automatische Reparatur

Hinweis:
- Wenn `Adresse` vorhanden ist, wird `Ort` im Follow-up standardmaessig nicht mehr separat erzwungen.
- `Quelle/Kanal` wird aus strukturierten Feldern (`Quelle: WhatsApp`) und Freitext (`per Telefon`, `Mail`) erkannt.

Bot-Kommandos:

- `/neu` -> sendet eine Ausfuell-Vorlage
- `/beispiel` -> sendet Beispieltexte
- `/abbrechen` -> beendet aktive Rueckfragen
- `/hilfe` oder `/start` -> Hilfe

### 5) Relevante API-Endpunkte

- `POST /api/telegram/webhook`
- `GET /api/board/state`
- `POST /api/board/schema`
- `GET /api/board/audit`
- `GET /api/telegram/pending`
- `GET /api/telegram/conversations`
- `GET /api/health`
- `GET /api/config`
- `POST /api/config`
- `GET /api/google/health`
- `POST /api/google/setup`
- `POST /api/google/sync`
- `POST /api/google/slots`
- `GET /api/telemetry/presets`
- `GET /api/telemetry/presets/export`
- `POST /api/telemetry/presets/event`
- `POST /api/telemetry/presets/reset`
- `GET /api/backups`
- `POST /api/backups/run`
- `POST /api/backups/restore`

Bei aktivierter API-Auth (`SECURITY_AUTH_ENABLED=1`) wird ein API-Key benoetigt:

- Header `x-promanager-api-key: <key>`
- oder `Authorization: Bearer <key>`

### 6) Lokale Smoke-Tests

```bash
npm run test:telegram:smoke
npm run test:telegram:guardrail
npm run test:telegram:command
npm run test:telegram:schema
npm run test:telegram:agent
npm run test:telegram:agent-priority
npm run test:telegram:voice
npm run test:telegram:singleline
npm run test:telegram:source
npm run test:telegram:source-property
npm run test:telegram:address-optional-location
npm run ops:backup-drill
```

- `test:telegram:smoke`: Message -> Proposal -> `Importieren` -> Card + Audit
- `test:telegram:guardrail`: niedrige Confidence -> `tg:ok` wird serverseitig blockiert
- `ops:backup-drill`: startet lokalen Drill (`/api/backups/run` + `/api/backups/restore`)

### 7) Telegram State Reset (optional)

```bash
npm run server:reset-state
```

- erstellt ein Backup von `server/data/state.json`
- setzt den Telegram-Serverzustand zurueck (Board/Pending/Audit)

## Qualitaetssicherung

```bash
npm run lint
npm run test
npm run build
```

CI-Workflow (`.github/workflows/ci.yml`) fuehrt `Lint`, `Test`, `Build` und `E2E (Playwright Chromium)` aus.

Zusatz-Workflows:

- Staging Deploy (manuell): `.github/workflows/deploy-staging.yml`
- Staging Health Monitoring (15 min): `.github/workflows/monitor-staging-health.yml`

## Git-Workflow (Empfohlen)

1. Arbeitsstand committen/pushen
2. Neues Feature immer in Branch `feature/<thema>` entwickeln
3. Pull Request nach `main`
4. Nur mergen, wenn alle CI-Checks gruen sind
5. Branch-Protection fuer `main` gemaess `docs/branch-protection-checklist.md` setzen

Hilfsskripte:

- API Keys generieren: `npm run ops:generate-api-keys`
- Branch Protection via API setzen: `npm run ops:set-branch-protection -- -Owner <owner> -Repo <repo> -Branch main`

## Produktion/Operations

- Runbook: `docs/operations-runbook.md`
- Import/Export Versionierung + Migration: `docs/import-export-versioning.md`
- Backup-Drill-Protokoll: `docs/backup-drill-log.md`
- Staging Setup Checkliste: `docs/staging-setup-checklist.md`
- Staging Deployment Templates: `deploy/staging/README.md`
- Env-Profile Vorlagen:
  - `.env.development.example`
  - `.env.staging.example`
  - `.env.production.example`

## Datenhaltung

- Board-Daten werden lokal gespeichert (`localStorage`)
- Dashboard-Beschriftung und Untertitel werden ebenfalls lokal gespeichert
- JSON-Backups enthalten Board + UI-Einstellungen
- Telegram-MVP persistiert serverseitig unter `server/data/state.json` (Board, Pending-Proposals, Audit)
- Server-Backups liegen unter `server/data/backups/*.json` (Daily + manuell)
