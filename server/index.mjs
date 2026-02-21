import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.TELEGRAM_MVP_PORT ?? 8787);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
const HOST = process.env.TELEGRAM_MVP_HOST ?? '0.0.0.0';
const ALERT_WEBHOOK_URL = String(process.env.ALERT_WEBHOOK_URL ?? '').trim();

const parseEnabledFlag = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase().trim());
};

const clampNumber = (value, min, max, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const parseSharedWithList = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  return String(value ?? '')
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const parseCsvList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean);
  }

  return String(value ?? '')
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const parseRole = (value, fallback = 'readonly') => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['owner', 'dispatcher', 'readonly'].includes(normalized)) return normalized;
  return fallback;
};

let LLM_ENABLED = parseEnabledFlag(process.env.LLM_ENABLED ?? '0');
let LLM_MIN_CONFIDENCE = clampNumber(process.env.LLM_MIN_CONFIDENCE ?? 0.7, 0, 1, 0.7);
let LLM_STRATEGY = ['dominant', 'hybrid', 'fallback'].includes(String(process.env.LLM_STRATEGY ?? 'dominant').toLowerCase())
  ? String(process.env.LLM_STRATEGY ?? 'dominant').toLowerCase()
  : 'dominant';
let LLM_REPAIR_PASS = parseEnabledFlag(process.env.LLM_REPAIR_PASS ?? '1', true);
let LLM_REPAIR_MIN_CONFIDENCE = clampNumber(process.env.LLM_REPAIR_MIN_CONFIDENCE ?? 0.82, 0, 1, 0.82);
let LLM_REPAIR_MAX_TRIES = clampNumber(process.env.LLM_REPAIR_MAX_TRIES ?? 2, 1, 3, 2);
let IMPORT_GUARDRAIL_CONFIDENCE = clampNumber(process.env.IMPORT_GUARDRAIL_CONFIDENCE ?? 0.65, 0, 1, 0.65);
let OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
let OPENAI_BASE_URL = String(process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
let OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
let LLM_TIMEOUT_MS = Math.max(2_000, Number(process.env.LLM_TIMEOUT_MS ?? 12_000) || 12_000);
let AGENT_ENABLED = parseEnabledFlag(process.env.AGENT_ENABLED ?? '1', true);
let AGENT_REQUIRED_FIELDS_RAW = String(process.env.AGENT_REQUIRED_FIELDS ?? '');
let AGENT_CRITICAL_FIELDS_RAW = String(
  process.env.AGENT_CRITICAL_FIELDS ?? (AGENT_REQUIRED_FIELDS_RAW || 'date,address,uhrzeit,source'),
);
let AGENT_PROPERTY_PRIORITY_RAW = String(
  process.env.AGENT_PROPERTY_PRIORITY ??
    'date:100,uhrzeit:97,zeit:97,source:94,quelle:94,kanal:94,address:90,adresse:90,location:78,ort:78,title:80,titel:80',
);
let AGENT_FOLLOWUP_INCLUDE_REQUIRED = parseEnabledFlag(process.env.AGENT_FOLLOWUP_INCLUDE_REQUIRED ?? '0');
let GOOGLE_ENABLED = parseEnabledFlag(process.env.GOOGLE_ENABLED ?? '0');
let GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
let GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
let GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN ?? '';
let GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID ?? '';
let GOOGLE_CALENDAR_NAME = process.env.GOOGLE_CALENDAR_NAME ?? 'Projekte Firma 2026';
let GOOGLE_TIMEZONE = process.env.GOOGLE_TIMEZONE ?? 'Europe/Vienna';
let GOOGLE_EVENT_DURATION_MIN = clampNumber(process.env.GOOGLE_EVENT_DURATION_MIN ?? 90, 15, 8 * 60, 90);
let GOOGLE_SLOT_WINDOW_DAYS = clampNumber(process.env.GOOGLE_SLOT_WINDOW_DAYS ?? 14, 3, 31, 14);
let GOOGLE_SHARE_ROLE = ['owner', 'writer', 'reader', 'freeBusyReader'].includes(
  String(process.env.GOOGLE_SHARE_ROLE ?? 'writer'),
)
  ? String(process.env.GOOGLE_SHARE_ROLE ?? 'writer')
  : 'writer';
let GOOGLE_SHARED_WITH = parseSharedWithList(process.env.GOOGLE_SHARED_WITH ?? '');
let AUTO_GOOGLE_SYNC_ON_TELEGRAM_IMPORT = parseEnabledFlag(process.env.AUTO_GOOGLE_SYNC_ON_TELEGRAM_IMPORT ?? '0');
let GOOGLE_DAILY_RESYNC_ENABLED = parseEnabledFlag(process.env.GOOGLE_DAILY_RESYNC_ENABLED ?? '0');
let DISPATCH_ENABLED = parseEnabledFlag(process.env.DISPATCH_ENABLED ?? '1', true);
let DISPATCH_MIN_SCORE = clampNumber(process.env.DISPATCH_MIN_SCORE ?? 55, 0, 200, 55);
let DISPATCH_MAX_DAILY_SLOTS = clampNumber(process.env.DISPATCH_MAX_DAILY_SLOTS ?? 3, 1, 20, 3);
let DISPATCH_REQUIRED_FIELDS_RAW = String(process.env.DISPATCH_REQUIRED_FIELDS ?? 'date,address,source');
let DISPATCH_SCORE_WEIGHTS_RAW = String(
  process.env.DISPATCH_SCORE_WEIGHTS ??
    'eingang:80,warteschlange:65,termin_ohne_datum:85,ueberfaellig:95,missing_date:18,missing_address:12,missing_phone:8,missing_source:6,no_comment:6,age_per_day:2,age_max:24',
);
let SECURITY_AUTH_ENABLED = parseEnabledFlag(process.env.SECURITY_AUTH_ENABLED ?? '0');
let SECURITY_OWNER_KEYS = parseCsvList(process.env.SECURITY_OWNER_KEYS ?? '');
let SECURITY_DISPATCHER_KEYS = parseCsvList(process.env.SECURITY_DISPATCHER_KEYS ?? '');
let SECURITY_READONLY_KEYS = parseCsvList(process.env.SECURITY_READONLY_KEYS ?? '');
let SECURITY_CORS_ORIGINS = parseCsvList(process.env.SECURITY_CORS_ORIGINS ?? '*');
let SECURITY_RATE_LIMIT_ENABLED = parseEnabledFlag(process.env.SECURITY_RATE_LIMIT_ENABLED ?? '1', true);
let SECURITY_RATE_LIMIT_WINDOW_MS = clampNumber(process.env.SECURITY_RATE_LIMIT_WINDOW_MS ?? 60_000, 5_000, 600_000, 60_000);
let SECURITY_RATE_LIMIT_MAX = clampNumber(process.env.SECURITY_RATE_LIMIT_MAX ?? 300, 10, 50_000, 300);
let SECURITY_RATE_LIMIT_WEBHOOK_MAX = clampNumber(
  process.env.SECURITY_RATE_LIMIT_WEBHOOK_MAX ?? 200,
  10,
  50_000,
  200,
);
let BACKUP_ENABLED = parseEnabledFlag(process.env.BACKUP_ENABLED ?? '1', true);
let BACKUP_RETENTION_DAYS = clampNumber(process.env.BACKUP_RETENTION_DAYS ?? 21, 1, 365, 21);
let BACKUP_DAILY_ENABLED = parseEnabledFlag(process.env.BACKUP_DAILY_ENABLED ?? '1', true);
let BACKUP_DAILY_HOUR_UTC = clampNumber(process.env.BACKUP_DAILY_HOUR_UTC ?? 2, 0, 23, 2);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const RUNTIME_CONFIG_PATH = path.join(DATA_DIR, 'runtime-config.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

const APP_DEFAULTS = {
  fallbackStatus: 'Eingang / Anfrage',
  fallbackSource: 'E-Mail',
  actorName: 'Telegram Bot',
  newCardTitle: 'Neue Seite',
  dashboardLabel: 'Projekte Firma 2026',
  dashboardSubtitle: 'Service Management Dashboard',
};
const MAX_PROCESSED_UPDATE_IDS = 2000;
const MAX_PROCESSED_MESSAGE_KEYS = 5000;
const GOOGLE_SYNC_VERIFY_INTERVAL_MS = 6 * 60 * 60 * 1000;
const GOOGLE_DAILY_RESYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const GOOGLE_DAILY_RESYNC_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const PRESET_TELEMETRY_EVENT_LIMIT = 5000;
const MAX_BACKUP_FILES = 365;

const ROLE_PRIORITY = {
  readonly: 1,
  dispatcher: 2,
  owner: 3,
};

const createDefaultGoogleSyncState = () => ({
  lastRunAt: '',
  lastMode: 'sync',
  ok: null,
  summary: '',
  error: '',
  counts: {
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    relinked: 0,
    recreated: 0,
    deduplicated: 0,
    errors: 0,
  },
});

const createDefaultPresetTelemetryState = () => ({
  updatedAt: '',
  dispatch: {
    appliedByPreset: {},
    approvedByPreset: {},
    dismissedByPreset: {},
    lastAppliedPresetId: null,
  },
  agent: {
    appliedByPreset: {},
    lastAppliedPresetId: null,
  },
  events: [],
});

const CARD_PROPERTY_IDS = {
  title: 'title',
  status: 'status',
  sources: 'sources',
  address: 'address',
  location: 'location',
  phone: 'phone',
  date: 'date',
};

const DEFAULT_STATUS_ORDER = ['Eingang / Anfrage', 'Warteschlange', 'Terminiert', 'Erledigt'];

const DEFAULT_DATABASE = {
  id: 'service-card-db',
  name: 'Service Cards',
  properties: [
    { id: CARD_PROPERTY_IDS.title, name: 'Titel', type: 'text', required: true, system: true },
    {
      id: CARD_PROPERTY_IDS.status,
      name: 'Status',
      type: 'select',
      required: true,
      system: true,
      options: [...DEFAULT_STATUS_ORDER],
    },
    { id: CARD_PROPERTY_IDS.address, name: 'Adresse', type: 'text', system: true },
    { id: CARD_PROPERTY_IDS.location, name: 'Ort', type: 'text', system: true },
    { id: CARD_PROPERTY_IDS.phone, name: 'Telefon', type: 'text', system: true },
    { id: CARD_PROPERTY_IDS.date, name: 'Datum', type: 'date', system: true },
  ],
};

const toNowIso = () => new Date().toISOString();
const randomId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

const normalizeKey = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

const escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const transliterateForSlug = (value) =>
  String(value ?? '')
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .replaceAll('Ä', 'ae')
    .replaceAll('Ö', 'oe')
    .replaceAll('Ü', 'ue');

const slugify = (value) =>
  transliterateForSlug(value)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

const makeEmptyColumns = (statuses) =>
  statuses.reduce((acc, status) => {
    acc[status] = [];
    return acc;
  }, {});

const createDefaultBoard = () => ({
  schemaVersion: 2,
  cardsById: {},
  columns: makeEmptyColumns(DEFAULT_STATUS_ORDER),
  database: {
    ...DEFAULT_DATABASE,
    properties: DEFAULT_DATABASE.properties.map((property) => ({ ...property, options: property.options?.slice() })),
  },
});

const createDefaultState = () => ({
  version: 1,
  board: createDefaultBoard(),
  pending: {},
  conversations: {},
  googleSync: createDefaultGoogleSyncState(),
  presetTelemetry: createDefaultPresetTelemetryState(),
  maintenance: {
    lastBackupAt: '',
    lastBackupFile: '',
    lastRestoreAt: '',
    lastRestoreFile: '',
    lastDailyBackupDate: '',
  },
  audit: [],
  lastUpdateId: -1,
  processedUpdateIds: [],
  processedMessageKeys: [],
});

const normalizeLlmStrategy = (value, fallback = 'dominant') => {
  const candidate = String(value ?? '').toLowerCase().trim();
  if (['dominant', 'hybrid', 'fallback'].includes(candidate)) return candidate;
  return fallback;
};

const normalizeShareRole = (value, fallback = 'writer') => {
  const candidate = String(value ?? '').trim();
  if (['owner', 'writer', 'reader', 'freeBusyReader'].includes(candidate)) return candidate;
  return fallback;
};

const sanitizeBaseUrl = (value, fallback = 'https://api.openai.com/v1') => {
  const candidate = String(value ?? '').trim().replace(/\/+$/, '');
  return candidate || fallback;
};

const buildRuntimeConfigPayload = ({ includeSecrets = false } = {}) => ({
  llm: {
    enabled: LLM_ENABLED,
    model: OPENAI_MODEL,
    strategy: LLM_STRATEGY,
    minConfidence: LLM_MIN_CONFIDENCE,
    repairPass: LLM_REPAIR_PASS,
    repairMinConfidence: LLM_REPAIR_MIN_CONFIDENCE,
    repairMaxTries: LLM_REPAIR_MAX_TRIES,
    timeoutMs: LLM_TIMEOUT_MS,
    baseUrl: OPENAI_BASE_URL,
    apiKey: includeSecrets ? OPENAI_API_KEY : '',
    hasApiKey: Boolean(OPENAI_API_KEY),
  },
  google: {
    enabled: GOOGLE_ENABLED,
    clientId: includeSecrets ? GOOGLE_CLIENT_ID : '',
    clientSecret: includeSecrets ? GOOGLE_CLIENT_SECRET : '',
    refreshToken: includeSecrets ? GOOGLE_REFRESH_TOKEN : '',
    hasClientId: Boolean(GOOGLE_CLIENT_ID),
    hasClientSecret: Boolean(GOOGLE_CLIENT_SECRET),
    hasRefreshToken: Boolean(GOOGLE_REFRESH_TOKEN),
    calendarId: GOOGLE_CALENDAR_ID,
    calendarName: GOOGLE_CALENDAR_NAME,
    timezone: GOOGLE_TIMEZONE,
    eventDurationMin: GOOGLE_EVENT_DURATION_MIN,
    slotWindowDays: GOOGLE_SLOT_WINDOW_DAYS,
    shareRole: GOOGLE_SHARE_ROLE,
    sharedWith: GOOGLE_SHARED_WITH,
  },
  agent: {
    enabled: AGENT_ENABLED,
    requiredFields: AGENT_REQUIRED_FIELDS_RAW,
    criticalFields: AGENT_CRITICAL_FIELDS_RAW,
    propertyPriority: AGENT_PROPERTY_PRIORITY_RAW,
    followupIncludeRequired: AGENT_FOLLOWUP_INCLUDE_REQUIRED,
  },
  automation: {
    autoGoogleSyncOnTelegramImport: AUTO_GOOGLE_SYNC_ON_TELEGRAM_IMPORT,
    dailyGoogleResyncEnabled: GOOGLE_DAILY_RESYNC_ENABLED,
  },
  dispatch: {
    enabled: DISPATCH_ENABLED,
    minScore: DISPATCH_MIN_SCORE,
    maxDailySlots: DISPATCH_MAX_DAILY_SLOTS,
    requiredFields: DISPATCH_REQUIRED_FIELDS_RAW,
    scoreWeights: DISPATCH_SCORE_WEIGHTS_RAW,
  },
  guardrail: {
    importConfidence: IMPORT_GUARDRAIL_CONFIDENCE,
  },
  security: {
    authEnabled: SECURITY_AUTH_ENABLED,
    ownerKeys: includeSecrets ? SECURITY_OWNER_KEYS : [],
    dispatcherKeys: includeSecrets ? SECURITY_DISPATCHER_KEYS : [],
    readonlyKeys: includeSecrets ? SECURITY_READONLY_KEYS : [],
    ownerKeyCount: SECURITY_OWNER_KEYS.length,
    dispatcherKeyCount: SECURITY_DISPATCHER_KEYS.length,
    readonlyKeyCount: SECURITY_READONLY_KEYS.length,
    corsOrigins: SECURITY_CORS_ORIGINS,
    rateLimitEnabled: SECURITY_RATE_LIMIT_ENABLED,
    rateLimitWindowMs: SECURITY_RATE_LIMIT_WINDOW_MS,
    rateLimitMax: SECURITY_RATE_LIMIT_MAX,
    rateLimitWebhookMax: SECURITY_RATE_LIMIT_WEBHOOK_MAX,
  },
  backup: {
    enabled: BACKUP_ENABLED,
    retentionDays: BACKUP_RETENTION_DAYS,
    dailyEnabled: BACKUP_DAILY_ENABLED,
    dailyHourUtc: BACKUP_DAILY_HOUR_UTC,
  },
});

const applyRuntimeConfig = (raw) => {
  if (!raw || typeof raw !== 'object') return;

  const llm = raw.llm && typeof raw.llm === 'object' ? raw.llm : {};
  if ('enabled' in llm) LLM_ENABLED = parseEnabledFlag(llm.enabled, LLM_ENABLED);
  if ('model' in llm && typeof llm.model === 'string') OPENAI_MODEL = llm.model.trim() || OPENAI_MODEL;
  if ('strategy' in llm) LLM_STRATEGY = normalizeLlmStrategy(llm.strategy, LLM_STRATEGY);
  if ('minConfidence' in llm) LLM_MIN_CONFIDENCE = clampNumber(llm.minConfidence, 0, 1, LLM_MIN_CONFIDENCE);
  if ('repairPass' in llm) LLM_REPAIR_PASS = parseEnabledFlag(llm.repairPass, LLM_REPAIR_PASS);
  if ('repairMinConfidence' in llm)
    LLM_REPAIR_MIN_CONFIDENCE = clampNumber(llm.repairMinConfidence, 0, 1, LLM_REPAIR_MIN_CONFIDENCE);
  if ('repairMaxTries' in llm) LLM_REPAIR_MAX_TRIES = clampNumber(llm.repairMaxTries, 1, 3, LLM_REPAIR_MAX_TRIES);
  if ('timeoutMs' in llm) LLM_TIMEOUT_MS = Math.max(2_000, Number(llm.timeoutMs) || LLM_TIMEOUT_MS);
  if ('baseUrl' in llm && typeof llm.baseUrl === 'string') OPENAI_BASE_URL = sanitizeBaseUrl(llm.baseUrl, OPENAI_BASE_URL);
  if ('apiKey' in llm && typeof llm.apiKey === 'string') OPENAI_API_KEY = llm.apiKey.trim();

  const google = raw.google && typeof raw.google === 'object' ? raw.google : {};
  if ('enabled' in google) GOOGLE_ENABLED = parseEnabledFlag(google.enabled, GOOGLE_ENABLED);
  if ('clientId' in google && typeof google.clientId === 'string') GOOGLE_CLIENT_ID = google.clientId.trim();
  if ('clientSecret' in google && typeof google.clientSecret === 'string') GOOGLE_CLIENT_SECRET = google.clientSecret.trim();
  if ('refreshToken' in google && typeof google.refreshToken === 'string') GOOGLE_REFRESH_TOKEN = google.refreshToken.trim();
  if ('calendarId' in google && typeof google.calendarId === 'string') GOOGLE_CALENDAR_ID = google.calendarId.trim();
  if ('calendarName' in google && typeof google.calendarName === 'string') {
    GOOGLE_CALENDAR_NAME = google.calendarName.trim() || GOOGLE_CALENDAR_NAME;
  }
  if ('timezone' in google && typeof google.timezone === 'string') GOOGLE_TIMEZONE = google.timezone.trim() || GOOGLE_TIMEZONE;
  if ('eventDurationMin' in google) {
    GOOGLE_EVENT_DURATION_MIN = clampNumber(google.eventDurationMin, 15, 8 * 60, GOOGLE_EVENT_DURATION_MIN);
  }
  if ('slotWindowDays' in google) {
    GOOGLE_SLOT_WINDOW_DAYS = clampNumber(google.slotWindowDays, 3, 31, GOOGLE_SLOT_WINDOW_DAYS);
  }
  if ('shareRole' in google) GOOGLE_SHARE_ROLE = normalizeShareRole(google.shareRole, GOOGLE_SHARE_ROLE);
  if ('sharedWith' in google) GOOGLE_SHARED_WITH = parseSharedWithList(google.sharedWith);

  const agent = raw.agent && typeof raw.agent === 'object' ? raw.agent : {};
  if ('enabled' in agent) AGENT_ENABLED = parseEnabledFlag(agent.enabled, AGENT_ENABLED);
  if ('requiredFields' in agent && typeof agent.requiredFields === 'string') AGENT_REQUIRED_FIELDS_RAW = agent.requiredFields.trim();
  if ('criticalFields' in agent && typeof agent.criticalFields === 'string') AGENT_CRITICAL_FIELDS_RAW = agent.criticalFields.trim();
  if ('propertyPriority' in agent && typeof agent.propertyPriority === 'string')
    AGENT_PROPERTY_PRIORITY_RAW = agent.propertyPriority.trim();
  if ('followupIncludeRequired' in agent) {
    AGENT_FOLLOWUP_INCLUDE_REQUIRED = parseEnabledFlag(agent.followupIncludeRequired, AGENT_FOLLOWUP_INCLUDE_REQUIRED);
  }

  const automation = raw.automation && typeof raw.automation === 'object' ? raw.automation : {};
  if ('autoGoogleSyncOnTelegramImport' in automation) {
    AUTO_GOOGLE_SYNC_ON_TELEGRAM_IMPORT = parseEnabledFlag(
      automation.autoGoogleSyncOnTelegramImport,
      AUTO_GOOGLE_SYNC_ON_TELEGRAM_IMPORT,
    );
  }
  if ('dailyGoogleResyncEnabled' in automation) {
    GOOGLE_DAILY_RESYNC_ENABLED = parseEnabledFlag(automation.dailyGoogleResyncEnabled, GOOGLE_DAILY_RESYNC_ENABLED);
  }

  const dispatch = raw.dispatch && typeof raw.dispatch === 'object' ? raw.dispatch : {};
  if ('enabled' in dispatch) DISPATCH_ENABLED = parseEnabledFlag(dispatch.enabled, DISPATCH_ENABLED);
  if ('minScore' in dispatch) DISPATCH_MIN_SCORE = clampNumber(dispatch.minScore, 0, 200, DISPATCH_MIN_SCORE);
  if ('maxDailySlots' in dispatch) {
    DISPATCH_MAX_DAILY_SLOTS = clampNumber(dispatch.maxDailySlots, 1, 20, DISPATCH_MAX_DAILY_SLOTS);
  }
  if ('requiredFields' in dispatch && typeof dispatch.requiredFields === 'string') {
    DISPATCH_REQUIRED_FIELDS_RAW = dispatch.requiredFields.trim();
  }
  if ('scoreWeights' in dispatch && typeof dispatch.scoreWeights === 'string') {
    DISPATCH_SCORE_WEIGHTS_RAW = dispatch.scoreWeights.trim();
  }

  const guardrail = raw.guardrail && typeof raw.guardrail === 'object' ? raw.guardrail : {};
  if ('importConfidence' in guardrail) {
    IMPORT_GUARDRAIL_CONFIDENCE = clampNumber(guardrail.importConfidence, 0, 1, IMPORT_GUARDRAIL_CONFIDENCE);
  }

  const security = raw.security && typeof raw.security === 'object' ? raw.security : {};
  if ('authEnabled' in security) SECURITY_AUTH_ENABLED = parseEnabledFlag(security.authEnabled, SECURITY_AUTH_ENABLED);
  if ('ownerKeys' in security) SECURITY_OWNER_KEYS = parseCsvList(security.ownerKeys);
  if ('dispatcherKeys' in security) SECURITY_DISPATCHER_KEYS = parseCsvList(security.dispatcherKeys);
  if ('readonlyKeys' in security) SECURITY_READONLY_KEYS = parseCsvList(security.readonlyKeys);
  if ('corsOrigins' in security) SECURITY_CORS_ORIGINS = parseCsvList(security.corsOrigins);
  if ('rateLimitEnabled' in security) {
    SECURITY_RATE_LIMIT_ENABLED = parseEnabledFlag(security.rateLimitEnabled, SECURITY_RATE_LIMIT_ENABLED);
  }
  if ('rateLimitWindowMs' in security) {
    SECURITY_RATE_LIMIT_WINDOW_MS = clampNumber(
      security.rateLimitWindowMs,
      5_000,
      600_000,
      SECURITY_RATE_LIMIT_WINDOW_MS,
    );
  }
  if ('rateLimitMax' in security) {
    SECURITY_RATE_LIMIT_MAX = clampNumber(security.rateLimitMax, 10, 50_000, SECURITY_RATE_LIMIT_MAX);
  }
  if ('rateLimitWebhookMax' in security) {
    SECURITY_RATE_LIMIT_WEBHOOK_MAX = clampNumber(
      security.rateLimitWebhookMax,
      10,
      50_000,
      SECURITY_RATE_LIMIT_WEBHOOK_MAX,
    );
  }

  const backup = raw.backup && typeof raw.backup === 'object' ? raw.backup : {};
  if ('enabled' in backup) BACKUP_ENABLED = parseEnabledFlag(backup.enabled, BACKUP_ENABLED);
  if ('retentionDays' in backup) {
    BACKUP_RETENTION_DAYS = clampNumber(backup.retentionDays, 1, 365, BACKUP_RETENTION_DAYS);
  }
  if ('dailyEnabled' in backup) BACKUP_DAILY_ENABLED = parseEnabledFlag(backup.dailyEnabled, BACKUP_DAILY_ENABLED);
  if ('dailyHourUtc' in backup) BACKUP_DAILY_HOUR_UTC = clampNumber(backup.dailyHourUtc, 0, 23, BACKUP_DAILY_HOUR_UTC);

  googleAccessTokenCache = {
    token: '',
    expiresAtMs: 0,
  };
  googleResolvedCalendarId = '';
};

const normalizeCounterMap = (value) => {
  if (!isObject(value)) return {};
  const next = {};
  for (const [key, rawCount] of Object.entries(value)) {
    const normalizedKey = String(key ?? '').trim();
    if (!normalizedKey) continue;
    const count = Number(rawCount);
    if (!Number.isFinite(count) || count <= 0) continue;
    next[normalizedKey] = Math.floor(count);
  }
  return next;
};

const normalizeTelemetryEvents = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => isObject(entry))
    .map((entry) => ({
      id: String(entry.id ?? '').trim(),
      channel: String(entry.channel ?? '').trim(),
      action: String(entry.action ?? '').trim(),
      presetId: String(entry.presetId ?? '').trim(),
      occurredAt: String(entry.occurredAt ?? '').trim(),
    }))
    .filter((entry) => entry.id && entry.channel && entry.action && entry.presetId && entry.occurredAt)
    .slice(-PRESET_TELEMETRY_EVENT_LIMIT);
};

const normalizePresetTelemetryState = (value) => {
  const fallback = createDefaultPresetTelemetryState();
  if (!isObject(value)) return fallback;

  return {
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    dispatch: {
      appliedByPreset: normalizeCounterMap(value.dispatch?.appliedByPreset),
      approvedByPreset: normalizeCounterMap(value.dispatch?.approvedByPreset),
      dismissedByPreset: normalizeCounterMap(value.dispatch?.dismissedByPreset),
      lastAppliedPresetId: typeof value.dispatch?.lastAppliedPresetId === 'string' ? value.dispatch.lastAppliedPresetId : null,
    },
    agent: {
      appliedByPreset: normalizeCounterMap(value.agent?.appliedByPreset),
      lastAppliedPresetId: typeof value.agent?.lastAppliedPresetId === 'string' ? value.agent.lastAppliedPresetId : null,
    },
    events: normalizeTelemetryEvents(value.events),
  };
};

const incrementCounter = (map, key) => {
  const normalizedKey = String(key ?? '').trim() || 'custom';
  return {
    ...map,
    [normalizedKey]: (Number(map?.[normalizedKey] ?? 0) || 0) + 1,
  };
};

const registerPresetTelemetryEvent = ({ channel, action, presetId }) => {
  const normalizedChannel = String(channel ?? '').trim().toLowerCase();
  const normalizedAction = String(action ?? '').trim().toLowerCase();
  const normalizedPresetId = String(presetId ?? '').trim() || 'custom';

  if (!['dispatch', 'agent'].includes(normalizedChannel)) {
    throw new Error('Invalid telemetry channel.');
  }
  if (!['applied', 'approved', 'dismissed'].includes(normalizedAction)) {
    throw new Error('Invalid telemetry action.');
  }
  if (normalizedChannel === 'agent' && normalizedAction !== 'applied') {
    throw new Error('Invalid telemetry action for agent.');
  }

  const now = toNowIso();
  const previous = normalizePresetTelemetryState(state.presetTelemetry);
  const next = {
    ...previous,
    updatedAt: now,
    events: [
      ...previous.events,
      {
        id: randomId('telemetry'),
        channel: normalizedChannel,
        action: normalizedAction,
        presetId: normalizedPresetId,
        occurredAt: now,
      },
    ].slice(-PRESET_TELEMETRY_EVENT_LIMIT),
  };

  if (normalizedChannel === 'dispatch') {
    if (normalizedAction === 'applied') {
      next.dispatch.appliedByPreset = incrementCounter(next.dispatch.appliedByPreset, normalizedPresetId);
      next.dispatch.lastAppliedPresetId = normalizedPresetId;
    } else if (normalizedAction === 'approved') {
      next.dispatch.approvedByPreset = incrementCounter(next.dispatch.approvedByPreset, normalizedPresetId);
    } else if (normalizedAction === 'dismissed') {
      next.dispatch.dismissedByPreset = incrementCounter(next.dispatch.dismissedByPreset, normalizedPresetId);
    }
  } else if (normalizedChannel === 'agent') {
    next.agent.appliedByPreset = incrementCounter(next.agent.appliedByPreset, normalizedPresetId);
    next.agent.lastAppliedPresetId = normalizedPresetId;
  }

  state.presetTelemetry = next;
  return next;
};

const buildPresetTelemetryReport = (telemetryInput, { includeEvents = false } = {}) => {
  const telemetry = normalizePresetTelemetryState(telemetryInput);
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekly = {};

  for (const event of telemetry.events) {
    const occurredMs = Date.parse(String(event.occurredAt ?? ''));
    if (!Number.isFinite(occurredMs) || occurredMs < sevenDaysAgoMs) continue;
    if (event.channel !== 'dispatch') continue;
    if (!['approved', 'dismissed'].includes(event.action)) continue;

    const key = String(event.presetId ?? 'custom').trim() || 'custom';
    if (!weekly[key]) {
      weekly[key] = {
        presetId: key,
        approved: 0,
        dismissed: 0,
        totalDecisions: 0,
        approvalRate: 0,
      };
    }
    if (event.action === 'approved') weekly[key].approved += 1;
    if (event.action === 'dismissed') weekly[key].dismissed += 1;
    weekly[key].totalDecisions += 1;
  }

  const weeklyItems = Object.values(weekly)
    .map((entry) => ({
      ...entry,
      approvalRate:
        entry.totalDecisions > 0 ? Math.round((entry.approved / entry.totalDecisions) * 100) : 0,
    }))
    .sort(
      (a, b) =>
        b.approvalRate - a.approvalRate ||
        b.totalDecisions - a.totalDecisions ||
        a.presetId.localeCompare(b.presetId),
    );

  const report = {
    updatedAt: telemetry.updatedAt,
    dispatch: {
      appliedByPreset: telemetry.dispatch.appliedByPreset,
      approvedByPreset: telemetry.dispatch.approvedByPreset,
      dismissedByPreset: telemetry.dispatch.dismissedByPreset,
      lastAppliedPresetId: telemetry.dispatch.lastAppliedPresetId,
    },
    agent: {
      appliedByPreset: telemetry.agent.appliedByPreset,
      lastAppliedPresetId: telemetry.agent.lastAppliedPresetId,
    },
    weeklyDispatchRanking: {
      since: new Date(sevenDaysAgoMs).toISOString(),
      totalDecisions: weeklyItems.reduce((sum, item) => sum + item.totalDecisions, 0),
      items: weeklyItems,
      bestPresetId: weeklyItems[0]?.presetId ?? null,
    },
    eventsCount: telemetry.events.length,
  };

  if (includeEvents) {
    return {
      ...report,
      events: telemetry.events,
    };
  }

  return report;
};

const ensureStateShape = (raw) => {
  if (!raw || typeof raw !== 'object') return createDefaultState();
  const fallback = createDefaultState();

  const board = raw.board && typeof raw.board === 'object' ? raw.board : fallback.board;
  const cardsById = board.cardsById && typeof board.cardsById === 'object' ? board.cardsById : {};

  const statusKeys = Object.keys(board.columns && typeof board.columns === 'object' ? board.columns : {});
  const statuses = statusKeys.length ? statusKeys : DEFAULT_STATUS_ORDER;
  const columns = makeEmptyColumns(statuses);
  for (const status of statuses) {
    const rawIds = board.columns?.[status];
    columns[status] = Array.isArray(rawIds) ? rawIds.filter((id) => typeof id === 'string') : [];
  }

  const database =
    board.database && typeof board.database === 'object' && Array.isArray(board.database.properties)
      ? {
          id: String(board.database.id ?? DEFAULT_DATABASE.id),
          name: String(board.database.name ?? DEFAULT_DATABASE.name),
          properties: board.database.properties
            .filter((property) => property && typeof property === 'object')
            .map((property) => ({
              id: slugify(property.id),
              name: String(property.name ?? property.id ?? 'Feld'),
              type: ['text', 'select', 'date'].includes(property.type) ? property.type : 'text',
              required: Boolean(property.required),
              system: Boolean(property.system),
              options: Array.isArray(property.options)
                ? Array.from(new Set(property.options.map((option) => String(option).trim()).filter(Boolean)))
                : undefined,
            }))
            .filter((property) => property.id),
        }
      : fallback.board.database;

  const pending = raw.pending && typeof raw.pending === 'object' ? raw.pending : {};
  const conversations = raw.conversations && typeof raw.conversations === 'object' ? raw.conversations : {};
  const googleSync =
    raw.googleSync && typeof raw.googleSync === 'object'
      ? {
          ...createDefaultGoogleSyncState(),
          ...raw.googleSync,
          counts: {
            ...createDefaultGoogleSyncState().counts,
            ...(raw.googleSync.counts && typeof raw.googleSync.counts === 'object' ? raw.googleSync.counts : {}),
          },
        }
      : createDefaultGoogleSyncState();
  const presetTelemetry = normalizePresetTelemetryState(raw.presetTelemetry);
  const audit = Array.isArray(raw.audit) ? raw.audit : [];
  const lastUpdateId = Number.isInteger(raw.lastUpdateId) ? raw.lastUpdateId : -1;
  const processedUpdateIds = Array.isArray(raw.processedUpdateIds)
    ? raw.processedUpdateIds.filter((entry) => Number.isInteger(entry)).slice(-MAX_PROCESSED_UPDATE_IDS)
    : [];
  const processedMessageKeys = Array.isArray(raw.processedMessageKeys)
    ? raw.processedMessageKeys
        .map((entry) => String(entry ?? '').trim())
        .filter(Boolean)
        .slice(-MAX_PROCESSED_MESSAGE_KEYS)
    : [];
  const maintenance =
    raw.maintenance && typeof raw.maintenance === 'object'
      ? {
          lastBackupAt: String(raw.maintenance.lastBackupAt ?? ''),
          lastBackupFile: String(raw.maintenance.lastBackupFile ?? ''),
          lastRestoreAt: String(raw.maintenance.lastRestoreAt ?? ''),
          lastRestoreFile: String(raw.maintenance.lastRestoreFile ?? ''),
          lastDailyBackupDate: String(raw.maintenance.lastDailyBackupDate ?? ''),
        }
      : {
          ...fallback.maintenance,
        };

  const next = {
    version: 1,
    board: {
      schemaVersion: 2,
      cardsById,
      columns,
      database,
    },
    pending,
    conversations,
    googleSync,
    presetTelemetry,
    maintenance,
    audit,
    lastUpdateId,
    processedUpdateIds,
    processedMessageKeys,
  };

  for (const required of DEFAULT_DATABASE.properties) {
    if (!next.board.database.properties.some((property) => property.id === required.id)) {
      next.board.database.properties.push({ ...required, options: required.options?.slice() });
    }
  }

  return next;
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });

const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

const isObject = (value) => typeof value === 'object' && value !== null;

const rateLimitBuckets = new Map();

const getClientIp = (req) => {
  const xff = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')[0]
    .trim();
  if (xff) return xff;
  const realIp = String(req.headers['x-real-ip'] ?? '').trim();
  if (realIp) return realIp;
  return String(req.socket?.remoteAddress ?? 'unknown').trim() || 'unknown';
};

const getAllowedOrigin = (origin) => {
  if (!origin) return SECURITY_CORS_ORIGINS.includes('*') ? '*' : '';
  if (SECURITY_CORS_ORIGINS.includes('*')) return origin;
  return SECURITY_CORS_ORIGINS.includes(origin) ? origin : '';
};

const applyCorsHeaders = (req, res) => {
  const origin = String(req.headers.origin ?? '').trim();
  const allowedOrigin = getAllowedOrigin(origin);

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-promanager-api-key, x-telegram-bot-api-secret-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
};

const collectSecurityKeys = () => ({
  owner: new Set(SECURITY_OWNER_KEYS.map((entry) => entry.trim()).filter(Boolean)),
  dispatcher: new Set(SECURITY_DISPATCHER_KEYS.map((entry) => entry.trim()).filter(Boolean)),
  readonly: new Set(SECURITY_READONLY_KEYS.map((entry) => entry.trim()).filter(Boolean)),
});

const resolveAccessRoleFromRequest = (req) => {
  if (!SECURITY_AUTH_ENABLED) return 'owner';

  const fromHeader = String(req.headers['x-promanager-api-key'] ?? '').trim();
  const authHeader = String(req.headers.authorization ?? '').trim();
  const fromBearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const candidate = fromHeader || fromBearer;
  if (!candidate) return null;

  const keys = collectSecurityKeys();
  if (keys.owner.has(candidate)) return 'owner';
  if (keys.dispatcher.has(candidate)) return 'dispatcher';
  if (keys.readonly.has(candidate)) return 'readonly';
  return null;
};

const roleAllows = (role, requiredRole) => {
  const have = ROLE_PRIORITY[parseRole(role, 'readonly')] ?? 0;
  const need = ROLE_PRIORITY[parseRole(requiredRole, 'readonly')] ?? 99;
  return have >= need;
};

const requireRole = (req, res, requiredRole) => {
  const role = resolveAccessRoleFromRequest(req);
  if (!role) {
    sendJson(res, 401, { ok: false, error: 'Authentication required.' });
    return null;
  }
  if (!roleAllows(role, requiredRole)) {
    sendJson(res, 403, { ok: false, error: `Insufficient role. Required: ${requiredRole}` });
    return null;
  }
  return role;
};

const rateLimitKeyForRequest = (req, url) => `${getClientIp(req)}:${url.pathname.startsWith('/api/telegram/webhook') ? 'webhook' : 'api'}`;

const checkRateLimit = (req, url) => {
  if (!SECURITY_RATE_LIMIT_ENABLED) return { limited: false, retryAfterSec: 0 };
  if (!url.pathname.startsWith('/api/')) return { limited: false, retryAfterSec: 0 };

  const now = Date.now();
  const key = rateLimitKeyForRequest(req, url);
  const max = url.pathname.startsWith('/api/telegram/webhook') ? SECURITY_RATE_LIMIT_WEBHOOK_MAX : SECURITY_RATE_LIMIT_MAX;
  const entry = rateLimitBuckets.get(key);
  if (!entry || now >= entry.resetAt) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + SECURITY_RATE_LIMIT_WINDOW_MS,
    });
    return { limited: false, retryAfterSec: 0 };
  }

  entry.count += 1;
  if (entry.count <= max) return { limited: false, retryAfterSec: 0 };

  const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  return { limited: true, retryAfterSec };
};

const cleanupRateLimitBuckets = () => {
  const now = Date.now();
  for (const [key, value] of rateLimitBuckets.entries()) {
    if (!value || now >= Number(value.resetAt ?? 0)) {
      rateLimitBuckets.delete(key);
    }
  }
};

const sendSecurityAlert = async (title, payload = {}) => {
  if (!ALERT_WEBHOOK_URL) return;
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        at: toNowIso(),
        ...payload,
      }),
    });
  } catch (error) {
    console.error('Alert webhook failed:', error);
  }
};

const toIsoLocalDate = (date) =>
  `${date.getFullYear().toString().padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

const trimTrailingPunctuation = (value) => String(value ?? '').trim().replace(/[\s,;:.!?]+$/g, '').trim();

const parseIsoDate = (value) => {
  const trimmed = trimTrailingPunctuation(value).replace(/\s*([./-])\s*/g, '$1');
  if (!trimmed) return null;

  const normalized = normalizeKey(trimmed);
  if (normalized.includes('uebermorgen') || normalized.includes('ubermorgen')) {
    const date = new Date();
    date.setDate(date.getDate() + 2);
    return toIsoLocalDate(date);
  }
  if (normalized.includes('heute')) {
    return toIsoLocalDate(new Date());
  }
  if (normalized.includes('morgen')) {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return toIsoLocalDate(date);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d) return trimmed;
  }

  const legacy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(trimmed);
  if (!legacy) return null;

  const day = Number(legacy[1]);
  const month = Number(legacy[2]);
  const year = Number(legacy[3].length === 2 ? `20${legacy[3]}` : legacy[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() + 1 !== month || dt.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
};

const GERMAN_HOUR_WORDS = {
  null: null,
  zero: 0,
  ein: 1,
  eins: 1,
  eine: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fuenf: 5,
  funf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwoelf: 12,
  zwolf: 12,
  dreizehn: 13,
  vierzehn: 14,
  fuenfzehn: 15,
  funfzehn: 15,
  sechzehn: 16,
  siebzehn: 17,
  achtzehn: 18,
  neunzehn: 19,
  zwanzig: 20,
  einundzwanzig: 21,
  zweiundzwanzig: 22,
  dreiundzwanzig: 23,
  vierundzwanzig: 24,
};

const parseHourToken = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  if (/^\d{1,2}$/.test(trimmed)) {
    const n = Number(trimmed);
    return n >= 0 && n <= 24 ? n : null;
  }

  const normalized = normalizeKey(trimmed);
  if (normalized in GERMAN_HOUR_WORDS) return GERMAN_HOUR_WORDS[normalized];
  return null;
};

const formatTimeLabel = (hours, minutes) => {
  const safeHours = ((Number(hours) % 24) + 24) % 24;
  const safeMinutes = Math.max(0, Math.min(59, Number(minutes)));
  return `${String(safeHours).padStart(2, '0')}:${String(safeMinutes).padStart(2, '0')} Uhr`;
};

const normalizeTimeValue = (value) => {
  const raw = trimTrailingPunctuation(value);
  if (!raw) return null;
  const lower = raw.toLowerCase();

  const hhmmRegex = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g;
  for (const match of lower.matchAll(hhmmRegex)) {
    const index = match.index ?? 0;
    const full = match[0] ?? '';
    const before = lower.slice(Math.max(0, index - 12), index);
    const after = lower.slice(index + full.length, index + full.length + 8);
    if (/(datum|date)\s*[:=]?\s*$/i.test(before)) continue;
    if (/^\s*[./-]\s*\d{2,4}/.test(after)) continue;
    return formatTimeLabel(Number(match[1]), Number(match[2]));
  }

  const withUhr = /\b([01]?\d|2[0-3])(?:[:. ]([0-5]\d))?\s*uhr\b/.exec(lower);
  if (withUhr) return formatTimeLabel(Number(withUhr[1]), Number(withUhr[2] ?? 0));

  const quarterAfter = /\bviertel\s+nach\s+([a-z0-9äöüß]+)\b/i.exec(lower);
  if (quarterAfter) {
    const hour = parseHourToken(quarterAfter[1]);
    if (hour !== null) return formatTimeLabel(hour, 15);
  }

  const quarterBefore = /\bviertel\s+vor\s+([a-z0-9äöüß]+)\b/i.exec(lower);
  if (quarterBefore) {
    const hour = parseHourToken(quarterBefore[1]);
    if (hour !== null) return formatTimeLabel(hour - 1, 45);
  }

  const half = /\bhalb\s+([a-z0-9äöüß]+)\b/i.exec(lower);
  if (half) {
    const hour = parseHourToken(half[1]);
    if (hour !== null) return formatTimeLabel(hour - 1, 30);
  }

  const threeQuarter = /\bdreiviertel\s+([a-z0-9äöüß]+)\b/i.exec(lower);
  if (threeQuarter) {
    const hour = parseHourToken(threeQuarter[1]);
    if (hour !== null) return formatTimeLabel(hour - 1, 45);
  }

  const spoken = /\bum\s+([a-z0-9äöüß]+)(?:\s*uhr)?\b/i.exec(lower);
  if (spoken) {
    const hour = parseHourToken(spoken[1]);
    if (hour !== null) return formatTimeLabel(hour, 0);
  }

  return null;
};

const isLikelyTimeProperty = (property) => {
  if (!property?.id) return false;
  const idKey = normalizeKey(property.id);
  const nameKey = normalizeKey(property.name ?? '');
  return (
    idKey.includes('uhrzeit') ||
    idKey === 'zeit' ||
    idKey.includes('time') ||
    nameKey.includes('uhrzeit') ||
    nameKey === 'zeit' ||
    nameKey.includes('time')
  );
};

const isLikelySourceProperty = (property) => {
  if (!property?.id) return false;
  const idKey = normalizeKey(property.id);
  const nameKey = normalizeKey(property.name ?? '');
  return (
    idKey === 'source' ||
    idKey.includes('quelle') ||
    idKey.includes('kanal') ||
    idKey.includes('herkunft') ||
    idKey.includes('eingang') ||
    nameKey === 'source' ||
    nameKey.includes('quelle') ||
    nameKey.includes('kanal') ||
    nameKey.includes('herkunft') ||
    nameKey.includes('eingang')
  );
};

const parseSelectValue = (value, options) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return options[0] ?? '';
  const exact = options.find((option) => option.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;

  const normalizedTarget = normalizeKey(trimmed);
  const byNormalized = options.find((option) => normalizeKey(option) === normalizedTarget);
  if (byNormalized) return byNormalized;

  const byContains = options.find((option) => normalizeKey(option).includes(normalizedTarget));
  return byContains ?? options[0] ?? trimmed;
};

const getSelectOptionsForProperty = (property, columns) =>
  property.id === CARD_PROPERTY_IDS.status
    ? Object.keys(columns)
    : Array.isArray(property.options)
      ? property.options
      : [];

const applyMandatoryValueDefaults = (values, columns, titleSeedLines) => {
  const next = { ...values };

  if (!next[CARD_PROPERTY_IDS.title]) {
    next[CARD_PROPERTY_IDS.title] = titleSeedLines[0]
      ? titleSeedLines[0].slice(0, 140)
      : APP_DEFAULTS.newCardTitle;
  }

  const statuses = Object.keys(columns);
  const fallbackStatus = statuses.includes(APP_DEFAULTS.fallbackStatus) ? APP_DEFAULTS.fallbackStatus : statuses[0];
  if (!next[CARD_PROPERTY_IDS.status]) next[CARD_PROPERTY_IDS.status] = fallbackStatus;
  if (!statuses.includes(next[CARD_PROPERTY_IDS.status])) next[CARD_PROPERTY_IDS.status] = fallbackStatus;

  if (!(CARD_PROPERTY_IDS.date in next)) next[CARD_PROPERTY_IDS.date] = null;
  if (!(CARD_PROPERTY_IDS.address in next)) next[CARD_PROPERTY_IDS.address] = '';
  if (!(CARD_PROPERTY_IDS.location in next)) next[CARD_PROPERTY_IDS.location] = '';
  if (!(CARD_PROPERTY_IDS.phone in next)) next[CARD_PROPERTY_IDS.phone] = '';

  return next;
};

const calculateRuleConfidence = (stats, values) => {
  const structuredCount = Math.max(1, stats.structuredLines);
  const mappedRatio = stats.mappedLines / structuredCount;
  let score = stats.structuredLines === 0 ? 0.45 : 0.4 + mappedRatio * 0.4;
  if (stats.heuristicMatches) score += Math.min(0.2, stats.heuristicMatches * 0.05);
  if (values[CARD_PROPERTY_IDS.title]) score += 0.1;
  if (values[CARD_PROPERTY_IDS.status]) score += 0.05;
  if (values[CARD_PROPERTY_IDS.date]) score += 0.05;
  return Math.max(0, Math.min(0.95, Number(score.toFixed(2))));
};

const parseMetadataFromRaw = (raw) => {
  if (!isObject(raw)) return {};
  const metadata = {};
  if (typeof raw.comment === 'string') metadata.comment = raw.comment.trim();
  if (typeof raw.source === 'string') metadata.source = raw.source.trim();
  return metadata;
};

const toUnmappedArray = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean);
};

const findRawValueForProperty = (rawValues, property) => {
  if (!isObject(rawValues)) return undefined;
  if (property.id in rawValues) return rawValues[property.id];

  const targetKeys = [normalizeKey(property.id), normalizeKey(property.name)];
  for (const [key, value] of Object.entries(rawValues)) {
    const normalized = normalizeKey(key);
    if (targetKeys.includes(normalized)) return value;
  }
  return undefined;
};

const sanitizeValuesBySchema = (rawValues, baselineValues, database, columns, textLines) => {
  const values = {};
  for (const property of database.properties) {
    const candidate = findRawValueForProperty(rawValues, property);
    if (candidate === undefined) {
      if (property.id in baselineValues) values[property.id] = baselineValues[property.id];
      continue;
    }

    if (property.type === 'date') {
      values[property.id] = parseIsoDate(candidate) ?? null;
      continue;
    }

    if (property.type === 'select') {
      values[property.id] = parseSelectValue(candidate, getSelectOptionsForProperty(property, columns));
      continue;
    }

    if (isLikelyTimeProperty(property)) {
      const normalizedTime = normalizeTimeValue(candidate);
      values[property.id] = normalizedTime ?? String(candidate).trim();
      continue;
    }

    values[property.id] = String(candidate).trim();
  }

  return applyMandatoryValueDefaults({ ...baselineValues, ...values }, columns, textLines);
};

const parseConfidence = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
};

const toNormalizedCsvList = (rawValue) =>
  String(rawValue ?? '')
    .split(/[;,]/)
    .map((entry) => normalizeKey(entry))
    .filter(Boolean);

const parseAgentPriorityEntries = (rawValue) => {
  const map = new Map();
  const chunks = String(rawValue ?? '')
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    const [rawKey, rawScore] = chunk.split(':');
    const key = normalizeKey(rawKey);
    const score = Number(rawScore);
    if (!key || !Number.isFinite(score)) continue;
    map.set(key, score);
  }
  return map;
};

const getAgentCriticalFieldKeys = () => toNormalizedCsvList(AGENT_CRITICAL_FIELDS_RAW);

const getAgentPriorityScore = (property, index, customPriorityMap) => {
  const key = normalizeKey(property?.id ?? '');
  const nameKey = normalizeKey(property?.name ?? '');
  const defaultPriorityMap = new Map([
    ['date', 100],
    ['datum', 100],
    ['uhrzeit', 95],
    ['zeit', 95],
    ['time', 95],
    ['location', 90],
    ['ort', 90],
    ['address', 85],
    ['adresse', 85],
    ['source', 94],
    ['quelle', 94],
    ['kanal', 94],
    ['herkunft', 94],
    ['eingang', 94],
    ['title', 80],
    ['titel', 80],
    ['phone', 70],
    ['telefon', 70],
  ]);

  const lookup = (lookupKey) => {
    if (!lookupKey) return null;
    if (customPriorityMap.has(lookupKey)) return customPriorityMap.get(lookupKey);
    if (defaultPriorityMap.has(lookupKey)) return defaultPriorityMap.get(lookupKey);
    return null;
  };

  const explicit = lookup(key);
  if (explicit !== null) return explicit;
  const byName = lookup(nameKey);
  if (byName !== null) return byName;
  if (isLikelyTimeProperty(property)) {
    const timePriority = lookup('uhrzeit') ?? lookup('zeit') ?? lookup('time');
    if (timePriority !== null) return timePriority;
  }
  if (isLikelySourceProperty(property)) {
    const sourcePriority =
      lookup('source') ?? lookup('quelle') ?? lookup('kanal') ?? lookup('herkunft') ?? lookup('eingang');
    if (sourcePriority !== null) return sourcePriority;
  }

  const requiredBase = property?.required ? 50 : 10;
  return requiredBase - index * 0.001;
};

const isMissingValueForProperty = (property, value) => {
  if (value === null || value === undefined) return true;
  if (property?.type === 'date') return !(typeof value === 'string' && value.trim());
  if (property?.type === 'select') return !(typeof value === 'string' && value.trim());
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

const parseValueForProperty = (property, rawValue, columns) => {
  const text = trimTrailingPunctuation(rawValue);
  if (!text) return { ok: false, message: 'Leerer Wert.' };

  if (property.type === 'date') {
    const parsedDate = parseIsoDate(text) ?? extractIsoDateFromText(text);
    if (!parsedDate) {
      return { ok: false, message: 'Bitte Datum als TT.MM.JJJJ oder YYYY-MM-DD angeben.' };
    }
    return { ok: true, value: parsedDate };
  }

  if (property.type === 'select') {
    const options = getSelectOptionsForProperty(property, columns);
    return { ok: true, value: parseSelectValue(text, options) };
  }

  if (isLikelyTimeProperty(property)) {
    const normalized = normalizeTimeValue(text);
    if (!normalized) {
      return { ok: false, message: 'Bitte Uhrzeit als HH:mm, "15 Uhr", "halb drei" etc. angeben.' };
    }
    return { ok: true, value: normalized };
  }

  if (isLikelySourceProperty(property)) {
    return { ok: true, value: normalizeTelegramSource(text) };
  }

  return { ok: true, value: text };
};

const getMissingFollowupPropertyIds = (proposal, database) => {
  const criticalKeys = getAgentCriticalFieldKeys();
  const priorityMap = parseAgentPriorityEntries(AGENT_PROPERTY_PRIORITY_RAW);
  const values = proposal?.values ?? {};
  const rankable = database.properties
    .filter((property) => {
      const key = normalizeKey(property.id);
      const nameKey = normalizeKey(property.name ?? '');
      const isCriticalConfigured =
        criticalKeys.includes(key) ||
        criticalKeys.includes(nameKey) ||
        (isLikelyTimeProperty(property) &&
          (criticalKeys.includes('uhrzeit') || criticalKeys.includes('zeit') || criticalKeys.includes('time')));
      const shouldRequire = isCriticalConfigured || (AGENT_FOLLOWUP_INCLUDE_REQUIRED && Boolean(property.required));
      if (!shouldRequire) return false;
      if (property.id === CARD_PROPERTY_IDS.status) return false;
      if (
        property.id === CARD_PROPERTY_IDS.location &&
        !isMissingValueForProperty({ type: 'text' }, values[CARD_PROPERTY_IDS.address])
      ) {
        return false;
      }
      return isMissingValueForProperty(property, values[property.id]);
    })
    .map((property, index) => ({
      id: property.id,
      score: getAgentPriorityScore(property, index, priorityMap),
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.id);

  return rankable;
};

const makePropertyAliasMap = (database) => {
  const map = new Map();
  const addAlias = (alias, propertyId) => {
    const key = normalizeKey(alias);
    if (!key) return;
    if (!map.has(key)) map.set(key, propertyId);
  };

  for (const property of database.properties) {
    addAlias(property.id, property.id);
    addAlias(property.name, property.id);
  }

  addAlias('titel', CARD_PROPERTY_IDS.title);
  addAlias('title', CARD_PROPERTY_IDS.title);
  addAlias('kunde', CARD_PROPERTY_IDS.title);
  addAlias('auftrag', CARD_PROPERTY_IDS.title);
  addAlias('status', CARD_PROPERTY_IDS.status);
  addAlias('phase', CARD_PROPERTY_IDS.status);
  addAlias('terminstatus', CARD_PROPERTY_IDS.status);
  addAlias('datum', CARD_PROPERTY_IDS.date);
  addAlias('termin', CARD_PROPERTY_IDS.date);
  addAlias('date', CARD_PROPERTY_IDS.date);
  addAlias('uhrzeit', '_time');
  addAlias('zeit', '_time');
  addAlias('time', '_time');
  addAlias('adresse', CARD_PROPERTY_IDS.address);
  addAlias('address', CARD_PROPERTY_IDS.address);
  addAlias('ort', CARD_PROPERTY_IDS.location);
  addAlias('location', CARD_PROPERTY_IDS.location);
  addAlias('stadt', CARD_PROPERTY_IDS.location);
  addAlias('telefon', CARD_PROPERTY_IDS.phone);
  addAlias('phone', CARD_PROPERTY_IDS.phone);
  addAlias('tel', CARD_PROPERTY_IDS.phone);
  addAlias('kommentar', '_comment');
  addAlias('notiz', '_comment');
  addAlias('quelle', '_source');
  addAlias('kanal', '_source');
  addAlias('herkunft', '_source');
  addAlias('eingang', '_source');
  addAlias('anfragekanal', '_source');
  addAlias('source', '_source');

  return map;
};

const injectLineBreaksBeforeStructuredKeys = (text, database) => {
  const raw = String(text ?? '');
  if (!raw || (!raw.includes(':') && !raw.includes('='))) return raw;

  const aliases = new Set([
    'titel',
    'title',
    'kunde',
    'auftrag',
    'status',
    'phase',
    'terminstatus',
    'datum',
    'termin',
    'date',
    'uhrzeit',
    'zeit',
    'ort',
    'stadt',
    'location',
    'adresse',
    'anschrift',
    'telefon',
    'phone',
    'tel',
    'kommentar',
    'notiz',
    'quelle',
    'kanal',
    'herkunft',
    'eingang',
    'anfragekanal',
    'source',
  ]);

  for (const property of database?.properties ?? []) {
    if (property?.id) aliases.add(String(property.id));
    if (property?.name) aliases.add(String(property.name));
  }

  const escaped = Array.from(aliases)
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0 && entry.length <= 50)
    .map((entry) => escapeRegex(entry))
    .sort((a, b) => b.length - a.length);

  if (!escaped.length) return raw;
  const pattern = new RegExp(`\\s+(?=(?:${escaped.join('|')})\\s*[:=])`, 'gi');
  return raw.replace(pattern, '\n');
};

const normalizeSchemaInput = (databaseInput, columns) => {
  if (!isObject(databaseInput)) return null;

  const rawProperties = Array.isArray(databaseInput.properties) ? databaseInput.properties : null;
  if (!rawProperties) return null;

  const normalizedProperties = [];
  const seen = new Set();
  for (const raw of rawProperties) {
    if (!isObject(raw)) continue;
    const rawId = typeof raw.id === 'string' ? raw.id : typeof raw.name === 'string' ? raw.name : '';
    const id = slugify(rawId);
    if (!id || seen.has(id)) continue;

    const type = ['text', 'select', 'date'].includes(raw.type) ? raw.type : 'text';
    const name = String(raw.name ?? id).trim() || id;
    const options =
      type === 'select' && Array.isArray(raw.options)
        ? Array.from(new Set(raw.options.map((option) => String(option).trim()).filter(Boolean)))
        : undefined;

    normalizedProperties.push({
      id,
      name,
      type,
      required: Boolean(raw.required),
      system: Boolean(raw.system),
      options,
    });
    seen.add(id);
  }

  const statuses = Object.keys(columns);
  const statusOptions = statuses.length ? statuses : DEFAULT_STATUS_ORDER;
  for (const required of DEFAULT_DATABASE.properties) {
    const idx = normalizedProperties.findIndex((property) => property.id === required.id);
    const base = {
      ...required,
      options: required.id === CARD_PROPERTY_IDS.status ? [...statusOptions] : required.options?.slice(),
    };
    if (idx < 0) {
      normalizedProperties.push(base);
      continue;
    }

    normalizedProperties[idx] = {
      ...normalizedProperties[idx],
      id: required.id,
      name: normalizedProperties[idx].name || required.name,
      type: required.type,
      required: Boolean(required.required),
      system: true,
      options: required.id === CARD_PROPERTY_IDS.status ? [...statusOptions] : normalizedProperties[idx].options,
    };
  }

  const orderedIds = [
    ...DEFAULT_DATABASE.properties.map((property) => property.id),
    ...normalizedProperties
      .map((property) => property.id)
      .filter((id) => !DEFAULT_DATABASE.properties.some((property) => property.id === id)),
  ];

  return {
    id: String(databaseInput.id ?? DEFAULT_DATABASE.id).trim() || DEFAULT_DATABASE.id,
    name: String(databaseInput.name ?? DEFAULT_DATABASE.name).trim() || DEFAULT_DATABASE.name,
    properties: orderedIds.map((id) => normalizedProperties.find((property) => property.id === id)).filter(Boolean),
  };
};

const findTimePropertyId = (database) => {
  const candidates = Array.isArray(database?.properties) ? database.properties : [];
  for (const property of candidates) {
    if (!property?.id) continue;
    if (property.id === CARD_PROPERTY_IDS.date || property.id === CARD_PROPERTY_IDS.status) continue;
    if (isLikelyTimeProperty(property)) {
      return property.id;
    }
  }
  return null;
};

const findSourcePropertyId = (database) => {
  const candidates = Array.isArray(database?.properties) ? database.properties : [];
  for (const property of candidates) {
    if (!property?.id) continue;
    if (property.id === CARD_PROPERTY_IDS.status || property.id === CARD_PROPERTY_IDS.title) continue;
    if (isLikelySourceProperty(property)) return property.id;
  }
  return null;
};

const extractStructuredPairsFromLine = (line) => {
  const regex = /([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9 _/-]{0,40})\s*[:=]\s*/g;
  const matches = [];

  for (const match of line.matchAll(regex)) {
    const key = match[1]?.trim();
    const index = match.index;
    if (!key || typeof index !== 'number') continue;
    matches.push({
      key,
      valueStart: index + match[0].length,
      start: index,
    });
  }

  if (!matches.length) return [];

  return matches
    .map((entry, idx) => {
      const nextStart = idx + 1 < matches.length ? matches[idx + 1].start : line.length;
      const rawValue = line.slice(entry.valueStart, nextStart).replace(/^[,\s]+|[,\s]+$/g, '');
      return {
        key: entry.key,
        value: trimTrailingPunctuation(rawValue),
      };
    })
    .filter((pair) => pair.value.length > 0);
};

const extractIsoDateFromText = (text) => {
  const isoCandidate = /\b\d{4}-\d{2}-\d{2}\b/.exec(text)?.[0];
  if (isoCandidate) {
    const parsed = parseIsoDate(isoCandidate);
    if (parsed) return parsed;
  }

  const localCandidate = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.exec(text)?.[0];
  if (localCandidate) {
    const parsed = parseIsoDate(localCandidate);
    if (parsed) return parsed;
  }

  const relativeKeyword = /\b(heute|morgen|uebermorgen|übermorgen)\b/i.exec(String(text ?? ''))?.[1];
  if (relativeKeyword) {
    const parsed = parseIsoDate(relativeKeyword);
    if (parsed) return parsed;
  }

  return null;
};

const extractTimeLabelFromText = (text) => {
  const raw = String(text ?? '');
  const hasTimeSignal = /(uhr|halb|viertel|dreiviertel|:\d{2}|[0-2]?\d\.[0-5]\d)/i.test(raw);
  if (!hasTimeSignal) return null;
  return normalizeTimeValue(raw);
};

const extractSourceFromText = (text) => {
  const raw = String(text ?? '');
  const explicit = /\b(?:quelle|kanal|herkunft|eingang|anfragekanal)\s*[:=]?\s*([^\n,;]+)/i.exec(raw)?.[1];
  if (explicit) {
    return normalizeTelegramSource(explicit);
  }

  if (/\bwhatsapp\b/i.test(raw)) return 'WhatsApp';
  if (/\bsms\b/i.test(raw)) return 'SMS';
  if (/\b(?:messenger|massenger)\b/i.test(raw)) return 'Messenger';
  if (/\b(?:e-?mail|mail)\b/i.test(raw)) return 'E-Mail';
  if (/\b(?:per\s+telefon|telefonisch)\b/i.test(raw)) return 'Telefon';
  if (/\b(?:pers(?:o|ö)nlich|vor\s+ort)\b/i.test(raw)) return 'Persoenlich';
  if (/\bpost(?:weg)?\b/i.test(raw)) return 'Post';
  if (/\b(?:im\s+gespr(?:ä|ae)ch|gespr(?:ä|ae)ch)\b/i.test(raw)) return 'Im Gespräch';
  return null;
};

const extractPhoneFromText = (text) => {
  const match = /(\+?\d[\d\s/()\-]{5,}\d)/.exec(text);
  return match ? match[1].replace(/\s+/g, ' ').trim() : null;
};

const extractLocationFromText = (text) => {
  const explicit = /\b(?:ort|stadt|location)\s*[:=]?\s*([A-Za-zÄÖÜäöüß][^,;\n.]*)/i.exec(text);
  if (explicit) {
    const candidate = trimTrailingPunctuation(explicit[1]);
    if (candidate) return candidate.slice(0, 120);
  }

  const inCity = /\b(?:in|nach)\s+([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\-]{1,50})\b/i.exec(String(text ?? ''));
  if (!inCity?.[1]) return null;
  const candidate = trimTrailingPunctuation(inCity[1]);
  const normalized = normalizeKey(candidate);
  if (!normalized || ['der', 'die', 'das', 'dem', 'den'].includes(normalized)) return null;
  return candidate.slice(0, 120);
};

const extractAddressFromText = (text) => {
  const explicit = /\b(?:adresse|anschrift)\s*[:=]?\s*([^;\n]+)/i.exec(text);
  if (explicit?.[1]) {
    const candidate = trimTrailingPunctuation(explicit[1]).replace(
      /\s+\b(?:datum|termin|ort|stadt|location|telefon|phone|status|kommentar)\b.*$/i,
      '',
    );
    if (candidate) return candidate.slice(0, 180);
  }

  const compactStreetCandidate = (candidate) => {
    const tokens = String(candidate ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!tokens.length) return '';

    const suffixIndex = tokens.findIndex((token) => /(?:straße|strasse|gasse|weg|platz|allee|ring|ufer|kai)/i.test(token));
    if (suffixIndex < 0) return '';

    let start = Math.max(0, suffixIndex - 2);
    while (start < suffixIndex && /^(in|um|am|an|morgen|heute|uebermorgen|übermorgen|termin|ort)$/i.test(tokens[start])) {
      start += 1;
    }
    return tokens.slice(start).join(' ').trim();
  };

  const streetRegex =
    /([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9.'-]*(?:\s+[A-Za-zÄÖÜäöüß0-9.'-]+){0,6}\s+(?:straße|strasse|gasse|weg|platz|allee|ring|ufer|kai)(?:\s*\d+[a-zA-Z]?)?)/gi;
  const matches = Array.from(String(text ?? '').matchAll(streetRegex));
  if (!matches.length) return null;
  const best = matches[matches.length - 1]?.[1];
  if (!best) return null;
  const compact = compactStreetCandidate(best);
  if (!compact) return null;
  return trimTrailingPunctuation(compact).slice(0, 180);
};

const guessTitleFromText = (text) => {
  const normalized = String(text ?? '').trim();
  if (!normalized) return null;

  let scrubbed = normalized
    .replace(/[,;]?\s*\b([01]?\d|2[0-3])(?:[:. ]([0-5]\d))?\s*uhr\b/gi, '')
    .replace(/\b(?:datum|date|termin)\s*[:=]?\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/gi, '')
    .replace(/\b(?:datum|date|termin)\s*[:=]?\s*(?:heute|morgen|uebermorgen|übermorgen)\b/gi, '')
    .replace(/\b(?:heute|morgen|uebermorgen|übermorgen)\b/gi, '')
    .replace(/\bin\s+[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\-]{1,50}\b/gi, '')
    .replace(/\b(?:ort|stadt|location|adresse|anschrift|telefon|phone|tel|status)\s*[:=]?\s*[^\n,;]+/gi, '');

  const streetWordIndex = scrubbed.search(/\b(?:straße|strasse|gasse|weg|platz|allee|ring|ufer|kai)\b/i);
  if (streetWordIndex > 0) {
    const beforeStreet = scrubbed.slice(0, streetWordIndex).trim();
    const words = beforeStreet.split(/\s+/).filter(Boolean);
    scrubbed = words.length > 4 ? words.slice(0, words.length - 2).join(' ') : beforeStreet;
  }

  const collapsed = scrubbed.replace(/\s{2,}/g, ' ').replace(/^[,;.\-\s]+|[,;.\-\s]+$/g, '').trim();
  if (!collapsed) return null;

  return collapsed.slice(0, 140);
};

const findStatusFromText = (text, columns) => {
  const statuses = Object.keys(columns);
  if (!statuses.length) return null;
  const normalizedText = normalizeKey(text);
  if (!normalizedText) return null;

  for (const status of statuses) {
    if (normalizedText.includes(normalizeKey(status))) return status;
  }
  return null;
};

const parseFreeTextHints = (lines, titleLines, values, metadata, columns, database) => {
  const hints = {
    values: {},
    metadata: {},
    mapped: 0,
  };
  if (!lines.length) return hints;

  const mergedText = lines.join(' | ');
  const firstLine = titleLines[0] ?? '';

  if (!values[CARD_PROPERTY_IDS.title]) {
    const title = guessTitleFromText(firstLine);
    if (title) {
      hints.values[CARD_PROPERTY_IDS.title] = title;
      hints.mapped += 1;
    }
  }

  if (!values[CARD_PROPERTY_IDS.status]) {
    const status = findStatusFromText(mergedText, columns);
    if (status) {
      hints.values[CARD_PROPERTY_IDS.status] = status;
      hints.mapped += 1;
    }
  }

  if (!(CARD_PROPERTY_IDS.date in values)) {
    const isoDate = extractIsoDateFromText(mergedText);
    if (isoDate) {
      hints.values[CARD_PROPERTY_IDS.date] = isoDate;
      hints.mapped += 1;
    }
  }

  if (!(CARD_PROPERTY_IDS.phone in values)) {
    const phone = extractPhoneFromText(mergedText);
    if (phone) {
      hints.values[CARD_PROPERTY_IDS.phone] = phone;
      hints.mapped += 1;
    }
  }

  if (!(CARD_PROPERTY_IDS.location in values)) {
    const location = extractLocationFromText(mergedText);
    if (location) {
      hints.values[CARD_PROPERTY_IDS.location] = location;
      hints.mapped += 1;
    }
  }

  if (!(CARD_PROPERTY_IDS.address in values)) {
    const address = extractAddressFromText(mergedText);
    if (address) {
      hints.values[CARD_PROPERTY_IDS.address] = address;
      hints.mapped += 1;
    }
  }

  const timeLabel = extractTimeLabelFromText(mergedText);
  if (timeLabel) {
    const timePropertyId = findTimePropertyId(database);
    if (timePropertyId && !(timePropertyId in values)) {
      hints.values[timePropertyId] = timeLabel;
      hints.mapped += 1;
    } else {
      const timeHint = `Uhrzeit: ${timeLabel}`;
      if (!metadata.comment) {
        hints.metadata.comment = timeHint;
      } else if (!String(metadata.comment).includes(timeHint)) {
        hints.metadata.comment = `${timeHint} | ${metadata.comment}`;
      }
      hints.mapped += 1;
    }
  }

  if (!metadata.source) {
    const source = extractSourceFromText(mergedText);
    if (source) {
      hints.metadata.source = source;
      const sourcePropertyId = findSourcePropertyId(database);
      if (sourcePropertyId && !(sourcePropertyId in values)) {
        const sourceProperty = database.properties.find((property) => property.id === sourcePropertyId);
        if (sourceProperty?.type === 'select') {
          const options = getSelectOptionsForProperty(sourceProperty, columns);
          hints.values[sourcePropertyId] = parseSelectValue(source, options);
        } else {
          hints.values[sourcePropertyId] = source;
        }
      }
      hints.mapped += 1;
    }
  }

  return hints;
};

const parseMessageAgainstSchema = (text, database, columns) => {
  const normalizedText = injectLineBreaksBeforeStructuredKeys(String(text ?? '').trim(), database);
  const lines = normalizedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const aliases = makePropertyAliasMap(database);
  const values = {};
  const metadata = {};
  const unmapped = [];
  let structuredLines = 0;
  let mappedLines = 0;
  const freeTextLines = [];
  const hintLines = [];

  const applyStructuredPair = (rawKey, rawValue) => {
    structuredLines += 1;
    const key = normalizeKey(rawKey);
    const normalizedRawValue = trimTrailingPunctuation(rawValue);
    if (!normalizedRawValue) return;
    hintLines.push(normalizedRawValue);
    const target = aliases.get(key);
    if (!target) {
      unmapped.push(`${rawKey}: ${normalizedRawValue}`);
      return;
    }

    if (target === '_comment') {
      metadata.comment = normalizedRawValue;
      mappedLines += 1;
      return;
    }

    if (target === '_source') {
      const normalizedSource = normalizeTelegramSource(normalizedRawValue);
      metadata.source = normalizedSource;
      const sourcePropertyId = findSourcePropertyId(database);
      if (sourcePropertyId && !(sourcePropertyId in values)) {
        const sourceProperty = database.properties.find((property) => property.id === sourcePropertyId);
        if (sourceProperty?.type === 'select') {
          const options = getSelectOptionsForProperty(sourceProperty, columns);
          values[sourcePropertyId] = parseSelectValue(normalizedSource, options);
        } else {
          values[sourcePropertyId] = normalizedSource;
        }
      }
      mappedLines += 1;
      return;
    }

    if (target === '_time') {
      const normalizedTime = normalizeTimeValue(normalizedRawValue);
      if (!normalizedTime) {
        unmapped.push(`${rawKey}: ${normalizedRawValue}`);
        return;
      }
      const timePropertyId = findTimePropertyId(database);
      if (timePropertyId) {
        values[timePropertyId] = normalizedTime;
      } else {
        const timeHint = `Uhrzeit: ${normalizedTime}`;
        if (!metadata.comment) metadata.comment = timeHint;
        else if (!String(metadata.comment).includes(timeHint)) metadata.comment = `${timeHint} | ${metadata.comment}`;
      }
      mappedLines += 1;
      return;
    }

    const definition = database.properties.find((property) => property.id === target);
    if (!definition) return;
    mappedLines += 1;

    if (definition.type === 'date') {
      values[target] = parseIsoDate(normalizedRawValue) ?? extractIsoDateFromText(normalizedRawValue) ?? null;
      return;
    }

    if (definition.type === 'select') {
      const selectOptions =
        definition.id === CARD_PROPERTY_IDS.status
          ? Object.keys(columns)
          : Array.isArray(definition.options)
            ? definition.options
            : [];
      values[target] = parseSelectValue(normalizedRawValue, selectOptions);
      return;
    }

    if (isLikelySourceProperty(definition)) {
      values[target] = normalizeTelegramSource(normalizedRawValue);
      if (!metadata.source) metadata.source = values[target];
      return;
    }

    values[target] = normalizedRawValue;
  };

  for (const line of lines) {
    const structuredPairs = extractStructuredPairsFromLine(line);
    if (!structuredPairs.length) {
      unmapped.push(line);
      freeTextLines.push(line);
      hintLines.push(line);
      continue;
    }
    for (const pair of structuredPairs) {
      applyStructuredPair(pair.key, pair.value);
    }
  }
  const hints = parseFreeTextHints(hintLines, freeTextLines, values, metadata, columns, database);
  Object.assign(values, hints.values);
  Object.assign(metadata, hints.metadata);
  const titleSeedLines = freeTextLines.length ? freeTextLines : structuredLines > 0 ? [] : lines;
  const finalizedValues = applyMandatoryValueDefaults(values, columns, titleSeedLines);
  const stats = { structuredLines, mappedLines, totalLines: lines.length, heuristicMatches: hints.mapped };
  const confidence = calculateRuleConfidence(stats, finalizedValues);

  return {
    values: finalizedValues,
    metadata,
    unmapped,
    confidence,
    extractionMode: 'rule',
    reasoning: `Rule parser matched ${mappedLines}/${Math.max(structuredLines, 1)} strukturierte Zeilen, Heuristiken: ${hints.mapped}.`,
    stats,
    lines,
  };
};

const isLlmConfigured = () => LLM_ENABLED && Boolean(OPENAI_API_KEY);

const buildLlmSchemaDescriptor = (database, columns) =>
  database.properties.map((property) => ({
    id: property.id,
    name: property.name,
    type: property.type,
    required: Boolean(property.required),
    options: property.type === 'select' ? getSelectOptionsForProperty(property, columns) : undefined,
  }));

const buildLlmExtractionPrompt = (text, database, columns, baseline) => {
  const schema = buildLlmSchemaDescriptor(database, columns);
  return [
    'Aufgabe: Extrahiere Service-/Termin-Daten aus Telegram-Text.',
    'Antwort nur als JSON-Objekt im exakten Format:',
    '{',
    '  "values": { "<propertyId>": "<value|null>" },',
    '  "metadata": { "comment": "<optional>", "source": "<optional>" },',
    '  "unmapped": ["<line>", "..."],',
    '  "confidence": 0.0-1.0,',
    '  "reasoning": "<kurz>"',
    '}',
    '',
    'Wichtige Regeln:',
    '- date strikt als ISO YYYY-MM-DD oder null.',
    '- select nur aus erlaubten options.',
    '- Fuer Uhrzeit-Felder Format "HH:mm Uhr".',
    '- Keine Halluzinationen; unsichere Teile in unmapped.',
    '- Deutschsprachige Spracheingabe mitdenken:',
    '  "morgen", "uebermorgen", "heute", "um drei", "halb drei", "viertel nach zwei", "viertel vor drei".',
    '',
    `Schema: ${JSON.stringify(schema)}`,
    `Statusoptionen: ${JSON.stringify(Object.keys(columns))}`,
    `Baseline: ${JSON.stringify({ values: baseline.values, metadata: baseline.metadata, unmapped: baseline.unmapped })}`,
    `Text:\n${text}`,
  ].join('\n');
};

const buildLlmRepairPrompt = (text, database, columns, baseline, previous) => {
  const schema = buildLlmSchemaDescriptor(database, columns);
  return [
    'Aufgabe: Repariere die Extraktion und verbessere Feldabdeckung, ohne zu halluzinieren.',
    'Antwort nur als JSON-Objekt im gleichen Format.',
    'Verbessere insbesondere fehlende Pflichtfelder und Datums-/Zeit-Normalisierung.',
    '',
    `Schema: ${JSON.stringify(schema)}`,
    `Statusoptionen: ${JSON.stringify(Object.keys(columns))}`,
    `Baseline: ${JSON.stringify({ values: baseline.values, metadata: baseline.metadata, unmapped: baseline.unmapped })}`,
    `Vorherige LLM-Ausgabe: ${JSON.stringify(previous)}`,
    `Originaltext:\n${text}`,
  ].join('\n');
};

const isFilledValue = (value) => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
};

const countMissingRequiredFields = (values, database) =>
  database.properties.filter((property) => property.required && !isFilledValue(values[property.id])).length;

const scoreExtractionCandidate = (candidate, database) => {
  if (!candidate) return -1;
  const missingRequired = countMissingRequiredFields(candidate.values ?? {}, database);
  const filledCount = database.properties.filter((property) => isFilledValue(candidate.values?.[property.id])).length;
  const coverage = database.properties.length > 0 ? filledCount / database.properties.length : 0;
  return (candidate.confidence ?? 0) + coverage * 0.25 - missingRequired * 0.2;
};

const shouldRunRepairPass = (candidate, database) => {
  if (!candidate) return true;
  if (countMissingRequiredFields(candidate.values ?? {}, database) > 0) return true;
  return Number(candidate.confidence ?? 0) < LLM_REPAIR_MIN_CONFIDENCE;
};

const parseLlmCandidate = (rawContent, baseline, database, columns, extractionMode) => {
  const parsed = JSON.parse(rawContent);
  const metadata = parseMetadataFromRaw(parsed.metadata);
  const unmapped = toUnmappedArray(parsed.unmapped);
  const values = sanitizeValuesBySchema(parsed.values, baseline.values, database, columns, baseline.lines);
  const confidence = parseConfidence(parsed.confidence, Math.max(0.55, baseline.confidence));
  const reasoning =
    typeof parsed.reasoning === 'string' && parsed.reasoning.trim()
      ? parsed.reasoning.trim().slice(0, 280)
      : 'LLM-Extraktion ohne Begruendung.';

  return {
    values,
    metadata: { ...baseline.metadata, ...metadata },
    unmapped: Array.from(new Set([...baseline.unmapped, ...unmapped])),
    confidence,
    extractionMode,
    reasoning,
    stats: baseline.stats,
    lines: baseline.lines,
    raw: parsed,
  };
};

const llmChatJson = async (messages, signal) => {
  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    signal,
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  const rawContent = payload?.choices?.[0]?.message?.content;
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    throw new Error('LLM returned empty content.');
  }
  return rawContent;
};

const chooseByLlmStrategy = (baseline, llmCandidate) => {
  if (!llmCandidate) return null;
  if (LLM_STRATEGY === 'dominant') return llmCandidate;
  if (LLM_STRATEGY === 'hybrid') {
    if ((llmCandidate.confidence ?? 0) >= Math.max(0.3, (baseline?.confidence ?? 0) - 0.15)) return llmCandidate;
    return null;
  }

  if ((llmCandidate.confidence ?? 0) >= LLM_MIN_CONFIDENCE && (llmCandidate.confidence ?? 0) >= (baseline?.confidence ?? 0)) {
    return llmCandidate;
  }
  return null;
};

const callLlmExtraction = async (text, database, columns, baseline) => {
  if (!isLlmConfigured()) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const systemMessage = { role: 'system', content: 'Du bist ein extrem praeziser Datenextraktor fuer Service-Projekte.' };
    const firstRaw = await llmChatJson(
      [
        systemMessage,
        { role: 'user', content: buildLlmExtractionPrompt(text, database, columns, baseline) },
      ],
      controller.signal,
    );

    let best = parseLlmCandidate(firstRaw, baseline, database, columns, 'llm_primary');

    if (LLM_REPAIR_PASS) {
      let tries = 0;
      while (tries < LLM_REPAIR_MAX_TRIES && shouldRunRepairPass(best, database)) {
        tries += 1;
        const repairRaw = await llmChatJson(
          [
            systemMessage,
            { role: 'user', content: buildLlmRepairPrompt(text, database, columns, baseline, best.raw ?? {}) },
          ],
          controller.signal,
        );

        const repaired = parseLlmCandidate(repairRaw, baseline, database, columns, 'llm_repair');
        if (scoreExtractionCandidate(repaired, database) >= scoreExtractionCandidate(best, database)) {
          best = repaired;
        }
      }
    }

    const chosen = chooseByLlmStrategy(baseline, best);
    if (!chosen) return null;

    return {
      ...chosen,
      extractionMode: LLM_STRATEGY === 'dominant' ? 'llm_dominant' : chosen.extractionMode,
      reasoning: `${chosen.reasoning} | strategy=${LLM_STRATEGY}`,
    };
  } catch (error) {
    console.error('LLM extraction failed, fallback to rule parser:', error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const describeValues = (values) =>
  Object.entries(values)
    .map(([key, value]) => `${key}: ${value === null ? '-' : String(value)}`)
    .join('\n');

const normalizeTelegramSource = (value) => {
  const normalized = normalizeKey(value);
  if (!normalized) return APP_DEFAULTS.fallbackSource;
  if (normalized.includes('whatsapp')) return 'WhatsApp';
  if (normalized.includes('sms')) return 'SMS';
  if (normalized.includes('messenger') || normalized.includes('massenger')) return 'Messenger';
  if (normalized.includes('telefon') || normalized.includes('anruf') || normalized.includes('call')) return 'Telefon';
  if (normalized.includes('persoenlich') || normalized.includes('personlich') || normalized.includes('vorort'))
    return 'Persoenlich';
  if (normalized.includes('post')) return 'Post';
  if (normalized.includes('gesprach') || normalized.includes('gespraech') || normalized.includes('imgesprach'))
    return 'Im Gespräch';
  if (normalized.includes('mail') || normalized.includes('email')) return 'E-Mail';
  return 'E-Mail';
};

const buildTelegramMessageKey = (proposal) => {
  if (!proposal || proposal.chatId === undefined || proposal.messageId === undefined) return '';
  return `${proposal.chatId}:${proposal.messageId}`;
};

const getTimeLikeValueFromValues = (values) => {
  if (!isObject(values)) return '';
  for (const [key, value] of Object.entries(values)) {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) continue;
    if (!(normalizedKey.includes('uhrzeit') || normalizedKey === 'zeit' || normalizedKey.includes('time'))) continue;
    return normalizeKey(String(value ?? ''));
  }
  return '';
};

const buildTelegramSemanticKey = (chatId, values) => {
  const normalizedChatId = String(chatId ?? '');
  const normalizedTitle = normalizeKey(values?.[CARD_PROPERTY_IDS.title] ?? '');
  const normalizedDate = String(values?.[CARD_PROPERTY_IDS.date] ?? '');
  const normalizedAddress = normalizeKey(values?.[CARD_PROPERTY_IDS.address] ?? '');
  const normalizedLocation = normalizeKey(values?.[CARD_PROPERTY_IDS.location] ?? '');
  const normalizedPhone = normalizeKey(values?.[CARD_PROPERTY_IDS.phone] ?? '');
  const normalizedTime = getTimeLikeValueFromValues(values);
  const normalizedStatus = normalizeKey(values?.[CARD_PROPERTY_IDS.status] ?? '');

  const signalCount = [
    normalizedTitle,
    normalizedDate,
    normalizedAddress,
    normalizedLocation,
    normalizedPhone,
    normalizedTime,
  ].filter((value) => Boolean(value)).length;

  // Prevent false duplicate detection on low-information records from the same chat.
  if (signalCount < 2) return '';

  const parts = [
    normalizedChatId,
    normalizedTitle,
    normalizedDate,
    normalizedAddress,
    normalizedLocation,
    normalizedPhone,
    normalizedTime,
    normalizedStatus,
  ];
  const compact = parts.join('|');
  if (compact.replace(/\|/g, '').length > 0) return compact;
  return '';
};

const buildTelegramImportKey = (proposal) => {
  if (!proposal) return '';
  const parts = [
    String(proposal.chatId ?? ''),
    normalizeKey(proposal.values?.[CARD_PROPERTY_IDS.title] ?? ''),
    String(proposal.values?.[CARD_PROPERTY_IDS.date] ?? ''),
    normalizeKey(proposal.values?.[CARD_PROPERTY_IDS.address] ?? ''),
    normalizeKey(proposal.values?.[CARD_PROPERTY_IDS.location] ?? ''),
    normalizeKey(proposal.values?.[CARD_PROPERTY_IDS.phone] ?? ''),
    normalizeKey(proposal.values?.[CARD_PROPERTY_IDS.status] ?? ''),
  ];
  const key = parts.join('|');
  if (key.replace(/\|/g, '').length > 0) return key;
  return `${String(proposal.chatId ?? '')}|${normalizeKey(proposal.rawText ?? '')}`;
};

const findDuplicateCardForProposal = (proposal, board) => {
  const messageKey = buildTelegramMessageKey(proposal);
  const importKey = buildTelegramImportKey(proposal);
  const semanticKey = buildTelegramSemanticKey(proposal.chatId, proposal.values);

  for (const card of Object.values(board.cardsById ?? {})) {
    if (!card || card.hiddenAt) continue;
    const cardChatId = String(card.telegramMessageKey ?? '').split(':')[0];
    const cardSemanticKey = buildTelegramSemanticKey(cardChatId, card.values);
    if (messageKey && card.telegramMessageKey === messageKey) return card;
    if (importKey && card.telegramImportKey === importKey) return card;
    if (semanticKey && card.telegramSemanticKey === semanticKey) return card;
    if (semanticKey && cardSemanticKey === semanticKey) return card;
  }

  return null;
};

const createCardFromProposal = (proposal, board) => {
  const now = toNowIso();
  const id = randomId('card');
  const status = String(proposal.values[CARD_PROPERTY_IDS.status] ?? APP_DEFAULTS.fallbackStatus);
  const title = String(proposal.values[CARD_PROPERTY_IDS.title] ?? APP_DEFAULTS.newCardTitle).trim() || APP_DEFAULTS.newCardTitle;
  const address = String(proposal.values[CARD_PROPERTY_IDS.address] ?? '').trim();
  const location = String(proposal.values[CARD_PROPERTY_IDS.location] ?? '').trim();
  const phone = String(proposal.values[CARD_PROPERTY_IDS.phone] ?? '').trim();
  const date = proposal.values[CARD_PROPERTY_IDS.date] ?? null;
  const source = normalizeTelegramSource(proposal.metadata.source);

  const values = {
    ...proposal.values,
    [CARD_PROPERTY_IDS.title]: title,
    [CARD_PROPERTY_IDS.status]: status,
    [CARD_PROPERTY_IDS.address]: address,
    [CARD_PROPERTY_IDS.location]: location,
    [CARD_PROPERTY_IDS.phone]: phone,
    [CARD_PROPERTY_IDS.date]: date,
    [CARD_PROPERTY_IDS.sources]: [source],
  };

  const sourcePropertyId = findSourcePropertyId(board.database);
  if (sourcePropertyId && isMissingValueForProperty({ type: 'text' }, values[sourcePropertyId])) {
    const sourceProperty = board.database.properties.find((property) => property.id === sourcePropertyId);
    if (sourceProperty?.type === 'select') {
      const options = getSelectOptionsForProperty(sourceProperty, board.columns);
      values[sourcePropertyId] = parseSelectValue(source, options);
    } else {
      values[sourcePropertyId] = source;
    }
  }

  const comments = [];
  if (proposal.metadata.comment) {
    comments.push({
      id: randomId('c'),
      user: APP_DEFAULTS.actorName,
      text: String(proposal.metadata.comment).slice(0, 2000),
      createdAt: now,
    });
  }

  const card = {
    id,
    title,
    collapsed: false,
    status,
    sources: [source],
    address,
    location,
    phone,
    date,
    hiddenAt: null,
    values,
    comments,
    history: [],
    createdAt: now,
    updatedAt: now,
    telegramMessageKey: buildTelegramMessageKey(proposal),
    telegramImportKey: buildTelegramImportKey(proposal),
    telegramSemanticKey: buildTelegramSemanticKey(proposal.chatId, values),
  };

  if (!Array.isArray(board.columns[status])) board.columns[status] = [];
  board.columns[status].push(id);
  board.cardsById[id] = card;
  return card;
};

const toWorkspacePayload = (board) => ({
  formatVersion: 2,
  exportedAt: toNowIso(),
  board: {
    schemaVersion: 2,
    cardsById: board.cardsById,
    columns: board.columns,
    database: board.database,
  },
  database: board.database,
  ui: {
    dashboardLabel: APP_DEFAULTS.dashboardLabel,
    dashboardSubtitle: APP_DEFAULTS.dashboardSubtitle,
  },
});

const filterBoardSince = (board, sinceIso) => {
  if (!sinceIso) return board;
  const sinceMs = Date.parse(sinceIso);
  if (!Number.isFinite(sinceMs)) return board;

  const nextCardsById = {};
  for (const [cardId, card] of Object.entries(board.cardsById ?? {})) {
    const updatedMs = Date.parse(card?.updatedAt ?? card?.createdAt ?? '');
    if (!Number.isFinite(updatedMs)) continue;
    if (updatedMs <= sinceMs) continue;
    nextCardsById[cardId] = card;
  }

  const nextColumns = {};
  for (const [status, cardIds] of Object.entries(board.columns ?? {})) {
    nextColumns[status] = Array.isArray(cardIds) ? cardIds.filter((cardId) => Boolean(nextCardsById[cardId])) : [];
  }

  return {
    ...board,
    cardsById: nextCardsById,
    columns: nextColumns,
  };
};

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isGoogleConfigured = () => GOOGLE_ENABLED && Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN);

const normalizeGoogleSource = (value) => normalizeTelegramSource(value);

const isTerminiertStatus = (status) => normalizeKey(status) === normalizeKey('Terminiert');

const isLikelyTimeFieldKey = (key) => {
  const normalized = normalizeKey(key);
  return normalized.includes('uhrzeit') || normalized === 'zeit' || normalized.includes('time');
};

const parseTimeFromCard = (card) => {
  const values = card?.values ?? {};
  for (const [key, raw] of Object.entries(values)) {
    if (!isLikelyTimeFieldKey(key)) continue;
    const parsed = normalizeTimeValue(String(raw ?? ''));
    if (parsed) return parsed;
  }

  if (typeof card?.date === 'string') {
    const maybe = normalizeTimeValue(String(card?.date ?? ''));
    if (maybe) return maybe;
  }

  return null;
};

const parseHourMinute = (timeLabel) => {
  const match = /(\d{2}):(\d{2})/.exec(String(timeLabel ?? ''));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
};

const addMinutesToDateTime = (dateIso, timeLabel, durationMin) => {
  const hm = parseHourMinute(timeLabel);
  if (!hm) return null;
  const base = new Date(`${dateIso}T${String(hm.hours).padStart(2, '0')}:${String(hm.minutes).padStart(2, '0')}:00`);
  if (Number.isNaN(base.getTime())) return null;
  const end = new Date(base.getTime() + durationMin * 60_000);

  const toLocalIso = (value) =>
    `${value.getFullYear().toString().padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(
      value.getDate(),
    ).padStart(2, '0')}T${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:00`;

  return {
    startDateTime: toLocalIso(base),
    endDateTime: toLocalIso(end),
  };
};

const buildEventDescription = (card) => {
  const sources = Array.isArray(card?.sources) ? card.sources.filter(Boolean).join(', ') : '';
  const commentText = Array.isArray(card?.comments)
    ? card.comments
        .slice(-3)
        .map((comment) => String(comment?.text ?? '').trim())
        .filter(Boolean)
        .join('\n')
    : '';

  return [
    `Karte: ${String(card?.title ?? APP_DEFAULTS.newCardTitle)}`,
    sources ? `Quelle: ${sources}` : '',
    card?.address ? `Adresse: ${card.address}` : '',
    card?.location ? `Ort: ${card.location}` : '',
    card?.phone ? `Telefon: ${card.phone}` : '',
    commentText ? `Kommentare:\n${commentText}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};

const shouldSyncCardToGoogle = (card) => {
  if (!card || card.hiddenAt) return false;
  if (!isTerminiertStatus(card.status)) return false;
  return typeof card.date === 'string' && card.date.length > 0;
};

const GOOGLE_VALUE_IDS = {
  eventId: 'google_event_id',
  eventLink: 'google_event_link',
  syncStatus: 'google_sync_status',
  syncError: 'google_sync_error',
  syncedAt: 'google_synced_at',
  syncSignature: 'google_sync_signature',
  verifiedAt: 'google_verified_at',
  lastAction: 'google_last_action',
};

const withGoogleMetadata = (card, patch) => ({
  ...card,
  values: {
    ...(card?.values ?? {}),
    ...(patch ?? {}),
  },
  updatedAt: toNowIso(),
});

const getGoogleEventIdFromCard = (card) => {
  const candidate = card?.values?.[GOOGLE_VALUE_IDS.eventId];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : '';
};

const getGoogleSyncSignatureFromCard = (card) => {
  const candidate = card?.values?.[GOOGLE_VALUE_IDS.syncSignature];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : '';
};

const getGoogleVerifiedAtMsFromCard = (card) => {
  const candidate = card?.values?.[GOOGLE_VALUE_IDS.verifiedAt];
  if (typeof candidate !== 'string' || !candidate.trim()) return 0;
  const ms = Date.parse(candidate);
  return Number.isFinite(ms) ? ms : 0;
};

const getGoogleEventPrivateCardId = (event) => {
  const candidate = event?.extendedProperties?.private?.cardId;
  return typeof candidate === 'string' ? candidate.trim() : '';
};

const stableStringify = (value) => {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const buildGooglePayloadSignature = (payload) =>
  crypto.createHash('sha256').update(stableStringify(payload)).digest('hex').slice(0, 24);

class GoogleApiError extends Error {
  constructor({ method, path, status, detail }) {
    super(`Google API ${method} ${path} fehlgeschlagen (${status}): ${detail}`);
    this.name = 'GoogleApiError';
    this.method = method;
    this.path = path;
    this.status = status;
    this.detail = detail;
  }
}

const getGoogleApiStatus = (error) => {
  if (error && typeof error === 'object' && Number.isInteger(error.status)) return Number(error.status);
  if (!(error instanceof Error)) return null;
  const match = /\((\d{3})\)/.exec(error.message);
  return match ? Number(match[1]) : null;
};

const isGoogleNotFoundError = (error) => {
  const status = getGoogleApiStatus(error);
  return status === 404 || status === 410;
};

let googleAccessTokenCache = {
  token: '',
  expiresAtMs: 0,
};
let googleResolvedCalendarId = '';
let googleSyncJobPromise = null;

const getGoogleAccessToken = async () => {
  if (!isGoogleConfigured()) throw new Error('Google Calendar ist nicht konfiguriert.');

  const now = Date.now();
  if (googleAccessTokenCache.token && googleAccessTokenCache.expiresAtMs - 30_000 > now) {
    return googleAccessTokenCache.token;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google OAuth fehlgeschlagen (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  const accessToken = String(payload?.access_token ?? '');
  const expiresIn = Number(payload?.expires_in ?? 3000);
  if (!accessToken) throw new Error('Google OAuth liefert kein access_token.');

  googleAccessTokenCache = {
    token: accessToken,
    expiresAtMs: now + Math.max(60, expiresIn) * 1000,
  };
  return googleAccessTokenCache.token;
};

const googleApi = async (path, { method = 'GET', query, body, retries = 2 } = {}) => {
  const token = await getGoogleAccessToken();
  const search = query ? `?${new URLSearchParams(query).toString()}` : '';
  const url = `https://www.googleapis.com/calendar/v3${path}${search}`;

  let attempt = 0;
  let lastError = null;
  while (attempt <= retries) {
    attempt += 1;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.ok) {
      if (response.status === 204) return {};
      return response.json();
    }

    const detail = await response.text();
    lastError = new GoogleApiError({
      method,
      path,
      status: response.status,
      detail,
    });

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt > retries) break;

    const retryAfterRaw = response.headers.get('retry-after');
    const retryAfterSec = retryAfterRaw ? Number(retryAfterRaw) : 0;
    const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : attempt * 500;
    await sleep(waitMs);
  }

  throw (
    lastError ??
    new GoogleApiError({
      method,
      path,
      status: 500,
      detail: 'Unbekannter Fehler',
    })
  );
};

const findCalendarByName = async (summary) => {
  let pageToken = '';
  do {
    const payload = await googleApi('/users/me/calendarList', {
      query: pageToken ? { pageToken } : undefined,
    });
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const found = items.find((item) => String(item?.summary ?? '').trim() === summary.trim());
    if (found?.id) return found;
    pageToken = String(payload?.nextPageToken ?? '');
  } while (pageToken);
  return null;
};

const resolveGoogleCalendarId = async ({ createIfMissing = false } = {}) => {
  if (!isGoogleConfigured()) throw new Error('Google Calendar ist nicht konfiguriert.');
  if (GOOGLE_CALENDAR_ID) return GOOGLE_CALENDAR_ID;
  if (googleResolvedCalendarId) return googleResolvedCalendarId;

  const found = await findCalendarByName(GOOGLE_CALENDAR_NAME);
  if (found?.id) {
    googleResolvedCalendarId = String(found.id);
    return googleResolvedCalendarId;
  }

  if (!createIfMissing) {
    throw new Error(`Google Kalender "${GOOGLE_CALENDAR_NAME}" nicht gefunden.`);
  }

  const created = await googleApi('/calendars', {
    method: 'POST',
    body: {
      summary: GOOGLE_CALENDAR_NAME,
      timeZone: GOOGLE_TIMEZONE,
    },
  });
  const createdId = String(created?.id ?? '');
  if (!createdId) throw new Error('Google Kalender konnte nicht erstellt werden.');
  googleResolvedCalendarId = createdId;
  return createdId;
};

const getGoogleCalendarHealth = async () => {
  if (!GOOGLE_ENABLED) {
    return {
      enabled: false,
      configured: false,
      calendarConfigured: false,
      calendarId: '',
      accessRole: '',
      canWrite: false,
      sharedWith: [],
      error: '',
    };
  }

  if (!isGoogleConfigured()) {
    return {
      enabled: true,
      configured: false,
      calendarConfigured: false,
      calendarId: GOOGLE_CALENDAR_ID || '',
      accessRole: '',
      canWrite: false,
      sharedWith: GOOGLE_SHARED_WITH,
      error: 'Google Credentials unvollständig.',
    };
  }

  try {
    const calendarId = await resolveGoogleCalendarId({ createIfMissing: false });
    const calendarMeta = await googleApi(`/users/me/calendarList/${encodeURIComponent(calendarId)}`);
    const accessRole = String(calendarMeta?.accessRole ?? '');
    return {
      enabled: true,
      configured: true,
      calendarConfigured: true,
      calendarId,
      accessRole,
      canWrite: ['owner', 'writer'].includes(accessRole),
      sharedWith: GOOGLE_SHARED_WITH,
      error: '',
    };
  } catch (error) {
    return {
      enabled: true,
      configured: true,
      calendarConfigured: false,
      calendarId: GOOGLE_CALENDAR_ID || googleResolvedCalendarId || '',
      accessRole: '',
      canWrite: false,
      sharedWith: GOOGLE_SHARED_WITH,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const ensureGoogleCalendarSetup = async ({ sharedWith = GOOGLE_SHARED_WITH, role = GOOGLE_SHARE_ROLE } = {}) => {
  if (!isGoogleConfigured()) throw new Error('Google Calendar ist nicht konfiguriert.');
  const calendarId = await resolveGoogleCalendarId({ createIfMissing: true });

  for (const email of sharedWith) {
    const aclPayload = {
      role,
      scope: { type: 'user', value: email },
    };
    try {
      await googleApi(`/calendars/${encodeURIComponent(calendarId)}/acl`, {
        method: 'POST',
        body: aclPayload,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('(409)')) throw error;
      const aclId = encodeURIComponent(`user:${email}`);
      await googleApi(`/calendars/${encodeURIComponent(calendarId)}/acl/${aclId}`, {
        method: 'PATCH',
        body: { role },
      });
    }
  }

  const health = await getGoogleCalendarHealth();
  return {
    ...health,
    calendarId,
    sharedWith,
    role,
  };
};

const getEventById = async (calendarId, eventId) => {
  if (!eventId) return null;
  try {
    const payload = await googleApi(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    return payload ?? null;
  } catch (error) {
    if (isGoogleNotFoundError(error)) return null;
    throw error;
  }
};

const getEventsByCardId = async (calendarId, cardId, maxResults = 10) => {
  const payload = await googleApi(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    query: {
      privateExtendedProperty: `cardId=${cardId}`,
      showDeleted: 'false',
      singleEvents: 'true',
      maxResults: String(Math.max(1, Math.min(20, Number(maxResults) || 10))),
      orderBy: 'startTime',
    },
  });
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.filter((item) => typeof item?.id === 'string');
};

const getEventByCardId = async (calendarId, cardId) => {
  const items = await getEventsByCardId(calendarId, cardId, 1);
  return items[0] ?? null;
};

const deleteGoogleEventById = async (calendarId, eventId, { ignoreNotFound = true } = {}) => {
  if (!eventId) return false;
  try {
    await googleApi(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
    });
    return true;
  } catch (error) {
    if (ignoreNotFound && isGoogleNotFoundError(error)) return false;
    throw error;
  }
};

const cleanupDuplicateLinkedEvents = async (calendarId, events, keepEventId) => {
  if (!Array.isArray(events) || events.length <= 1) return 0;
  let removed = 0;
  for (const event of events) {
    const candidateId = typeof event?.id === 'string' ? event.id : '';
    if (!candidateId || candidateId === keepEventId) continue;
    const deleted = await deleteGoogleEventById(calendarId, candidateId, { ignoreNotFound: true });
    if (deleted) removed += 1;
  }
  return removed;
};

const buildGoogleEventPayload = (card) => {
  const date = typeof card?.date === 'string' ? card.date : null;
  if (!date) return null;
  const timeLabel = parseTimeFromCard(card) ?? '09:00 Uhr';
  const range = addMinutesToDateTime(date, timeLabel, GOOGLE_EVENT_DURATION_MIN);
  if (!range) return null;

  const locationParts = [card?.address, card?.location].filter((part) => typeof part === 'string' && part.trim().length > 0);
  const description = buildEventDescription(card);

  return {
    summary: String(card?.title ?? APP_DEFAULTS.newCardTitle).trim() || APP_DEFAULTS.newCardTitle,
    location: locationParts.join(', '),
    description,
    start: {
      dateTime: range.startDateTime,
      timeZone: GOOGLE_TIMEZONE,
    },
    end: {
      dateTime: range.endDateTime,
      timeZone: GOOGLE_TIMEZONE,
    },
    extendedProperties: {
      private: {
        cardId: String(card?.id ?? ''),
      },
    },
  };
};

const syncBoardToGoogleCalendar = async (boardInput, options = {}) => {
  if (!isGoogleConfigured()) throw new Error('Google Calendar ist nicht konfiguriert.');
  const forceResync = Boolean(options?.forceResync);

  const board = ensureStateShape({ board: boardInput }).board;
  const calendarId = await resolveGoogleCalendarId({ createIfMissing: true });
  const updates = [];
  const errors = [];
  const warnings = [];
  let created = 0;
  let updated = 0;
  let deleted = 0;
  let unchanged = 0;
  let relinked = 0;
  let recreated = 0;
  let deduplicated = 0;

  const cards = Object.values(board.cardsById ?? {});
  for (const card of cards) {
    const storedEventId = getGoogleEventIdFromCard(card);
    const storedSignature = getGoogleSyncSignatureFromCard(card);
    const storedVerifiedAtMs = getGoogleVerifiedAtMsFromCard(card);
    const nowMs = Date.now();
    const verifyDue = forceResync || !storedVerifiedAtMs || nowMs - storedVerifiedAtMs >= GOOGLE_SYNC_VERIFY_INTERVAL_MS;
    const syncEligible = shouldSyncCardToGoogle(card);

    if (!syncEligible) {
      try {
        let removedForCard = 0;
        const deletedByStoredId = await deleteGoogleEventById(calendarId, storedEventId, { ignoreNotFound: true });
        if (deletedByStoredId) removedForCard += 1;

        const linkedEvents = await getEventsByCardId(calendarId, card.id, 10);
        const removedDuplicates = await cleanupDuplicateLinkedEvents(calendarId, linkedEvents, '');
        removedForCard += removedDuplicates;
        deduplicated += removedDuplicates;

        if (!storedEventId && linkedEvents.length === 0) {
          continue;
        }

        deleted += removedForCard > 0 ? removedForCard : storedEventId ? 1 : 0;
        updates.push({
          cardId: card.id,
          action: removedForCard > 0 ? 'deleted' : 'detached',
          values: {
            [GOOGLE_VALUE_IDS.eventId]: '',
            [GOOGLE_VALUE_IDS.eventLink]: '',
            [GOOGLE_VALUE_IDS.syncStatus]: removedForCard > 0 ? 'deleted' : 'detached',
            [GOOGLE_VALUE_IDS.syncError]: '',
            [GOOGLE_VALUE_IDS.syncedAt]: toNowIso(),
            [GOOGLE_VALUE_IDS.syncSignature]: '',
            [GOOGLE_VALUE_IDS.verifiedAt]: toNowIso(),
            [GOOGLE_VALUE_IDS.lastAction]: removedForCard > 0 ? 'deleted' : 'detached',
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ cardId: card.id, message });
        updates.push({
          cardId: card.id,
          action: 'error',
          values: {
            [GOOGLE_VALUE_IDS.syncStatus]: 'error',
            [GOOGLE_VALUE_IDS.syncError]: message,
            [GOOGLE_VALUE_IDS.syncedAt]: toNowIso(),
            [GOOGLE_VALUE_IDS.lastAction]: 'delete_error',
          },
        });
      }
      continue;
    }

    const payload = buildGoogleEventPayload(card);
    if (!payload) {
      const message = 'Termin konnte nicht in Start/Ende umgerechnet werden.';
      errors.push({ cardId: card.id, message });
      updates.push({
        cardId: card.id,
        action: 'error',
        values: {
          [GOOGLE_VALUE_IDS.syncStatus]: 'error',
          [GOOGLE_VALUE_IDS.syncError]: message,
          [GOOGLE_VALUE_IDS.syncedAt]: toNowIso(),
          [GOOGLE_VALUE_IDS.lastAction]: 'payload_error',
        },
      });
      continue;
    }

    const payloadSignature = buildGooglePayloadSignature(payload);

    try {
      let event = null;
      let targetEventId = storedEventId;
      let linkedViaLookup = false;

      if (targetEventId && verifyDue) {
        const existingById = await getEventById(calendarId, targetEventId);
        if (!existingById) {
          warnings.push({
            cardId: card.id,
            message: `Google Event ${targetEventId} nicht gefunden. Relink/Recreate wird versucht.`,
          });
          targetEventId = '';
        } else {
          const ownerCardId = getGoogleEventPrivateCardId(existingById);
          if (ownerCardId && ownerCardId !== card.id) {
            warnings.push({
              cardId: card.id,
              message: `Google Event ${targetEventId} gehoert zu anderer Karte (${ownerCardId}). Neues Event wird erstellt.`,
            });
            targetEventId = '';
          } else {
            event = existingById;
          }
        }
      }

      if (!targetEventId) {
        const linkedEvents = await getEventsByCardId(calendarId, card.id, 10);
        if (linkedEvents.length > 0) {
          const primary = linkedEvents[0];
          targetEventId = String(primary?.id ?? '');
          event = primary;
          linkedViaLookup = Boolean(targetEventId);
          const removedDuplicates = await cleanupDuplicateLinkedEvents(calendarId, linkedEvents, targetEventId);
          deduplicated += removedDuplicates;
        }
      }

      if (!forceResync && targetEventId && storedSignature === payloadSignature) {
        unchanged += 1;
        updates.push({
          cardId: card.id,
          action: linkedViaLookup ? 'relinked' : 'unchanged',
          values: {
            [GOOGLE_VALUE_IDS.eventId]: targetEventId,
            [GOOGLE_VALUE_IDS.eventLink]: String(event?.htmlLink ?? card?.values?.[GOOGLE_VALUE_IDS.eventLink] ?? ''),
            [GOOGLE_VALUE_IDS.syncStatus]: 'ok',
            [GOOGLE_VALUE_IDS.syncError]: '',
            [GOOGLE_VALUE_IDS.syncedAt]: toNowIso(),
            [GOOGLE_VALUE_IDS.syncSignature]: payloadSignature,
            [GOOGLE_VALUE_IDS.verifiedAt]: toNowIso(),
            [GOOGLE_VALUE_IDS.lastAction]: linkedViaLookup ? 'relinked_unchanged' : 'unchanged',
          },
        });
        if (linkedViaLookup) relinked += 1;
        continue;
      }

      let action = 'updated';
      if (targetEventId) {
        event = await googleApi(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(targetEventId)}`, {
          method: 'PATCH',
          body: payload,
        });
        if (linkedViaLookup && storedEventId && storedEventId !== targetEventId) {
          action = 'relinked';
          relinked += 1;
        } else if (linkedViaLookup && !storedEventId) {
          action = 'relinked';
          relinked += 1;
        } else {
          updated += 1;
          action = 'updated';
        }
      } else {
        event = await googleApi(`/calendars/${encodeURIComponent(calendarId)}/events`, {
          method: 'POST',
          body: payload,
        });
        if (storedEventId) {
          action = 'recreated';
          recreated += 1;
        } else {
          action = 'created';
          created += 1;
        }
      }

      updates.push({
        cardId: card.id,
        action,
        values: {
          [GOOGLE_VALUE_IDS.eventId]: String(event?.id ?? ''),
          [GOOGLE_VALUE_IDS.eventLink]: String(event?.htmlLink ?? ''),
          [GOOGLE_VALUE_IDS.syncStatus]: 'ok',
          [GOOGLE_VALUE_IDS.syncError]: '',
          [GOOGLE_VALUE_IDS.syncedAt]: toNowIso(),
          [GOOGLE_VALUE_IDS.syncSignature]: payloadSignature,
          [GOOGLE_VALUE_IDS.verifiedAt]: toNowIso(),
          [GOOGLE_VALUE_IDS.lastAction]: action,
        },
      });
    } catch (error) {
      if (storedEventId && isGoogleNotFoundError(error)) {
        try {
          const recreatedEvent = await googleApi(`/calendars/${encodeURIComponent(calendarId)}/events`, {
            method: 'POST',
            body: payload,
          });
          recreated += 1;
          updates.push({
            cardId: card.id,
            action: 'recreated',
            values: {
              [GOOGLE_VALUE_IDS.eventId]: String(recreatedEvent?.id ?? ''),
              [GOOGLE_VALUE_IDS.eventLink]: String(recreatedEvent?.htmlLink ?? ''),
              [GOOGLE_VALUE_IDS.syncStatus]: 'ok',
              [GOOGLE_VALUE_IDS.syncError]: '',
              [GOOGLE_VALUE_IDS.syncedAt]: toNowIso(),
              [GOOGLE_VALUE_IDS.syncSignature]: payloadSignature,
              [GOOGLE_VALUE_IDS.verifiedAt]: toNowIso(),
              [GOOGLE_VALUE_IDS.lastAction]: 'recreated',
            },
          });
          warnings.push({
            cardId: card.id,
            message: `Event ${storedEventId} nicht mehr vorhanden, automatisch neu erstellt.`,
          });
          continue;
        } catch (recreateError) {
          const recreateMessage = recreateError instanceof Error ? recreateError.message : String(recreateError);
          errors.push({ cardId: card.id, message: recreateMessage });
          updates.push({
            cardId: card.id,
            action: 'error',
            values: {
              [GOOGLE_VALUE_IDS.syncStatus]: 'error',
              [GOOGLE_VALUE_IDS.syncError]: recreateMessage,
              [GOOGLE_VALUE_IDS.syncedAt]: toNowIso(),
              [GOOGLE_VALUE_IDS.lastAction]: 'recreate_error',
            },
          });
          continue;
        }
      }

      const message = error instanceof Error ? error.message : String(error);
      errors.push({ cardId: card.id, message });
      updates.push({
        cardId: card.id,
        action: 'error',
        values: {
          [GOOGLE_VALUE_IDS.syncStatus]: 'error',
          [GOOGLE_VALUE_IDS.syncError]: message,
          [GOOGLE_VALUE_IDS.syncedAt]: toNowIso(),
          [GOOGLE_VALUE_IDS.lastAction]: 'sync_error',
        },
      });
    }
  }

  return {
    calendarId,
    mode: forceResync ? 'resync' : 'sync',
    created,
    updated,
    deleted,
    unchanged,
    relinked,
    recreated,
    deduplicated,
    totalCards: cards.length,
    syncedCards: updates.filter((entry) =>
      ['created', 'updated', 'relinked', 'recreated', 'unchanged'].includes(String(entry.action)),
    ).length,
    errors,
    warnings,
    updates,
  };
};

const applyGoogleSyncUpdatesToBoard = (board, updates) => {
  if (!board || !isObject(board.cardsById) || !Array.isArray(updates)) return 0;
  let applied = 0;
  const now = toNowIso();

  for (const entry of updates) {
    if (!entry || typeof entry !== 'object') continue;
    const cardId = typeof entry.cardId === 'string' ? entry.cardId : '';
    if (!cardId) continue;
    const card = board.cardsById[cardId];
    if (!card || typeof card !== 'object') continue;
    const valuesPatch = entry.values && typeof entry.values === 'object' ? entry.values : null;
    if (!valuesPatch) continue;

    board.cardsById[cardId] = {
      ...card,
      values: {
        ...(card.values ?? {}),
        ...valuesPatch,
      },
      updatedAt: now,
    };
    applied += 1;
  }

  return applied;
};

const buildGoogleSyncStateFromResult = (syncResult, { modeOverride = '' } = {}) => ({
  lastRunAt: toNowIso(),
  lastMode: modeOverride || syncResult.mode || 'sync',
  ok: Array.isArray(syncResult.errors) ? syncResult.errors.length === 0 : true,
  summary: `created=${syncResult.created ?? 0}, updated=${syncResult.updated ?? 0}, deleted=${syncResult.deleted ?? 0}, unchanged=${syncResult.unchanged ?? 0}, relinked=${syncResult.relinked ?? 0}, recreated=${syncResult.recreated ?? 0}, deduplicated=${syncResult.deduplicated ?? 0}`,
  error: Array.isArray(syncResult.errors) && syncResult.errors[0]?.message ? syncResult.errors[0].message : '',
  counts: {
    created: Number(syncResult.created ?? 0),
    updated: Number(syncResult.updated ?? 0),
    deleted: Number(syncResult.deleted ?? 0),
    unchanged: Number(syncResult.unchanged ?? 0),
    relinked: Number(syncResult.relinked ?? 0),
    recreated: Number(syncResult.recreated ?? 0),
    deduplicated: Number(syncResult.deduplicated ?? 0),
    errors: Array.isArray(syncResult.errors) ? syncResult.errors.length : 0,
  },
});

const runGoogleSyncJob = async ({
  boardInput,
  forceResync = false,
  persistBoardUpdates = false,
  modeLabel = '',
  actor = 'system',
} = {}) => {
  if (googleSyncJobPromise) return googleSyncJobPromise;

  googleSyncJobPromise = (async () => {
    try {
      const board = boardInput ?? state.board;
      const syncResult = await syncBoardToGoogleCalendar(board, { forceResync });
      if (persistBoardUpdates && board === state.board) {
        applyGoogleSyncUpdatesToBoard(state.board, syncResult.updates);
      }

      state.googleSync = buildGoogleSyncStateFromResult(syncResult, { modeOverride: modeLabel });
      addAudit('google_sync_completed', {
        actor,
        mode: modeLabel || syncResult.mode || (forceResync ? 'resync' : 'sync'),
        created: syncResult.created,
        updated: syncResult.updated,
        deleted: syncResult.deleted,
        unchanged: syncResult.unchanged,
        relinked: syncResult.relinked,
        recreated: syncResult.recreated,
        deduplicated: syncResult.deduplicated,
        errors: Array.isArray(syncResult.errors) ? syncResult.errors.length : 0,
      });
      await persistState();
      return syncResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.googleSync = {
        ...createDefaultGoogleSyncState(),
        lastRunAt: toNowIso(),
        lastMode: modeLabel || (forceResync ? 'resync' : 'sync'),
        ok: false,
        summary: '',
        error: message,
      };
      addAudit('google_sync_failed', {
        actor,
        mode: modeLabel || (forceResync ? 'resync' : 'sync'),
        message,
      });
      await persistState();
      throw error;
    } finally {
      googleSyncJobPromise = null;
    }
  })();

  return googleSyncJobPromise;
};

const maybeRunDailyGoogleResync = async () => {
  if (!GOOGLE_DAILY_RESYNC_ENABLED) return;
  if (!GOOGLE_ENABLED || !isGoogleConfigured()) return;
  if (googleSyncJobPromise) return;

  const lastRunMs = Date.parse(String(state.googleSync?.lastRunAt ?? ''));
  if (Number.isFinite(lastRunMs) && Date.now() - lastRunMs < GOOGLE_DAILY_RESYNC_INTERVAL_MS) return;

  try {
    await runGoogleSyncJob({
      boardInput: state.board,
      forceResync: true,
      persistBoardUpdates: true,
      modeLabel: 'daily_resync',
      actor: 'scheduler',
    });
  } catch (error) {
    console.error('Daily Google resync failed:', error);
  }
};

const maybeRunDailyBackup = async () => {
  if (!BACKUP_ENABLED || !BACKUP_DAILY_ENABLED) return;

  const now = new Date();
  const currentHour = now.getUTCHours();
  if (currentHour !== BACKUP_DAILY_HOUR_UTC) return;

  const dateKey = now.toISOString().slice(0, 10);
  const lastDone = String(state.maintenance?.lastDailyBackupDate ?? '');
  if (lastDone === dateKey) return;

  try {
    await createStateBackup({
      reason: 'daily-auto',
    });
    state.maintenance = {
      ...(state.maintenance ?? {}),
      lastDailyBackupDate: dateKey,
    };
    await persistState();
  } catch (error) {
    console.error('Daily backup failed:', error);
    await sendSecurityAlert('Daily backup failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

const toIsoFromLocalDateAndTime = (date, hh, mm) =>
  `${date.getFullYear().toString().padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;

const getGoogleSlotSuggestions = async ({
  timezone = GOOGLE_TIMEZONE,
  workdayStart = '07:00',
  workdayEnd = '17:30',
  durationMin = GOOGLE_EVENT_DURATION_MIN,
  top = 3,
  businessDays = [1, 2, 3, 4, 5],
  windowDays = GOOGLE_SLOT_WINDOW_DAYS,
  fromDate = null,
} = {}) => {
  if (!isGoogleConfigured()) throw new Error('Google Calendar ist nicht konfiguriert.');
  const calendarId = await resolveGoogleCalendarId({ createIfMissing: true });

  const now = new Date();
  const baseDate = fromDate ? new Date(`${fromDate}T00:00:00`) : now;
  const rangeStart = new Date(baseDate);
  const rangeEnd = new Date(baseDate);
  rangeEnd.setDate(rangeEnd.getDate() + windowDays);

  const freebusy = await googleApi('/freeBusy', {
    method: 'POST',
    body: {
      timeMin: rangeStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
      timeZone: timezone,
      items: [{ id: calendarId }],
    },
  });

  const busy = Array.isArray(freebusy?.calendars?.[calendarId]?.busy) ? freebusy.calendars[calendarId].busy : [];
  const busyRanges = busy
    .map((entry) => ({
      start: new Date(String(entry?.start ?? '')),
      end: new Date(String(entry?.end ?? '')),
    }))
    .filter((entry) => !Number.isNaN(entry.start.getTime()) && !Number.isNaN(entry.end.getTime()));

  const startHm = parseHourMinute(workdayStart) ?? { hours: 7, minutes: 0 };
  const endHm = parseHourMinute(workdayEnd) ?? { hours: 17, minutes: 30 };
  const suggestions = [];

  const stepMin = 30;
  for (let dayOffset = 0; dayOffset <= windowDays; dayOffset += 1) {
    const day = new Date(baseDate);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + dayOffset);
    const weekday = day.getDay();
    if (!businessDays.includes(weekday)) continue;

    const dayStartMinutes = startHm.hours * 60 + startHm.minutes;
    const dayEndMinutes = endHm.hours * 60 + endHm.minutes;
    for (let currentMin = dayStartMinutes; currentMin + durationMin <= dayEndMinutes; currentMin += stepMin) {
      const hh = Math.floor(currentMin / 60);
      const mm = currentMin % 60;
      const start = new Date(toIsoFromLocalDateAndTime(day, hh, mm));
      const end = new Date(start.getTime() + durationMin * 60_000);
      if (start < now) continue;

      const conflicts = busyRanges.some((busyRange) => start < busyRange.end && end > busyRange.start);
      if (conflicts) continue;

      const label = `${toIsoLocalDate(day)} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      suggestions.push({
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        date: toIsoLocalDate(day),
        timeLabel: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} Uhr`,
        label,
      });
      if (suggestions.length >= top) {
        return { calendarId, suggestions };
      }
    }
  }

  return { calendarId, suggestions };
};

const tgApi = async (method, payload) => {
  if (!BOT_TOKEN) return null;

  let attempt = 0;
  let lastError = null;
  while (attempt < 3) {
    attempt += 1;
    try {
      const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) return response.json();

      const text = await response.text();
      const retryAfterRaw = response.headers.get('retry-after');
      const retryAfterSec = retryAfterRaw ? Number(retryAfterRaw) : 0;
      const retryable = response.status === 429 || response.status >= 500;
      lastError = new Error(`Telegram API ${method} failed (${response.status}): ${text}`);

      if (!retryable || attempt >= 3) break;
      const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : attempt * 500;
      await sleep(waitMs);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= 3) break;
      await sleep(attempt * 500);
    }
  }

  throw lastError ?? new Error(`Telegram API ${method} failed.`);
};

const getTelegramWebhookInfo = async () => {
  if (!BOT_TOKEN) return { configured: false, url: '', pendingUpdateCount: 0, ok: false };
  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    if (!response.ok) {
      return {
        configured: true,
        url: '',
        pendingUpdateCount: 0,
        ok: false,
        error: `HTTP ${response.status}`,
      };
    }
    const payload = await response.json();
    const result = payload?.result ?? {};
    return {
      configured: true,
      url: String(result?.url ?? ''),
      pendingUpdateCount: Number(result?.pending_update_count ?? 0),
      lastErrorMessage: String(result?.last_error_message ?? ''),
      ok: Boolean(payload?.ok),
    };
  } catch (error) {
    return {
      configured: true,
      url: '',
      pendingUpdateCount: 0,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const ensureDataDir = async () => {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
};

const ensureBackupDir = async () => {
  await ensureDataDir();
  if (!existsSync(BACKUP_DIR)) {
    await mkdir(BACKUP_DIR, { recursive: true });
  }
};

const getSafeBackupFileName = (value) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (normalized.includes('..') || normalized.includes('/') || normalized.includes('\\')) return '';
  if (!normalized.endsWith('.json')) return '';
  return normalized;
};

const buildBackupFileName = (reason = 'manual') => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const normalizedReason = slugify(reason) || 'manual';
  return `state-${stamp}-${normalizedReason}.json`;
};

const listBackups = async () => {
  await ensureBackupDir();
  const entries = await readdir(BACKUP_DIR);
  const details = [];
  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(BACKUP_DIR, file);
    try {
      const info = await stat(filePath);
      details.push({
        file,
        bytes: info.size,
        modifiedAt: info.mtime.toISOString(),
      });
    } catch {
      // ignore broken entry
    }
  }

  details.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
  return details.slice(0, MAX_BACKUP_FILES);
};

const pruneBackups = async ({ retentionDays = BACKUP_RETENTION_DAYS } = {}) => {
  await ensureBackupDir();
  const maxAgeMs = Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - maxAgeMs;
  const backups = await listBackups();
  let removed = 0;

  for (const backup of backups) {
    const modifiedMs = Date.parse(backup.modifiedAt);
    if (!Number.isFinite(modifiedMs) || modifiedMs >= cutoff) continue;
    const filePath = path.join(BACKUP_DIR, backup.file);
    try {
      await rm(filePath, { force: true });
      removed += 1;
    } catch {
      // ignore remove errors
    }
  }

  return removed;
};

const createStateBackup = async ({ reason = 'manual', sourcePath = STATE_PATH } = {}) => {
  if (!BACKUP_ENABLED) {
    return {
      skipped: true,
      reason: 'disabled',
      file: '',
    };
  }

  await ensureBackupDir();
  const file = buildBackupFileName(reason);
  const targetPath = path.join(BACKUP_DIR, file);

  if (existsSync(sourcePath)) {
    await copyFile(sourcePath, targetPath);
  } else {
    await writeFile(targetPath, JSON.stringify(state, null, 2), 'utf8');
  }

  const now = toNowIso();
  state.maintenance = {
    ...(state.maintenance ?? {}),
    lastBackupAt: now,
    lastBackupFile: file,
    lastDailyBackupDate: reason.startsWith('daily') ? now.slice(0, 10) : state.maintenance?.lastDailyBackupDate ?? '',
  };
  addAudit('backup_created', {
    actor: 'system',
    reason,
    file,
  });
  await persistState();
  await pruneBackups();
  return {
    skipped: false,
    reason,
    file,
  };
};

const restoreStateFromBackupFile = async ({ fileName, actor = 'system' } = {}) => {
  const safeFile = getSafeBackupFileName(fileName);
  if (!safeFile) throw new Error('Invalid backup file name.');

  await ensureBackupDir();
  const sourcePath = path.join(BACKUP_DIR, safeFile);
  if (!existsSync(sourcePath)) throw new Error('Backup file not found.');

  const raw = await readFile(sourcePath, 'utf8');
  const parsed = JSON.parse(raw);
  const normalized = ensureStateShape(parsed);
  state = normalized;
  state.maintenance = {
    ...(state.maintenance ?? {}),
    lastRestoreAt: toNowIso(),
    lastRestoreFile: safeFile,
  };
  addAudit('backup_restored', {
    actor,
    file: safeFile,
  });
  await persistState();
  return state;
};

const loadRuntimeConfig = async () => {
  await ensureDataDir();
  if (!existsSync(RUNTIME_CONFIG_PATH)) return;

  try {
    const raw = await readFile(RUNTIME_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    applyRuntimeConfig(parsed);
  } catch (error) {
    console.error('Failed to load runtime config. Using env defaults:', error);
  }
};

const persistRuntimeConfig = async () => {
  await ensureDataDir();
  await writeFile(RUNTIME_CONFIG_PATH, JSON.stringify(buildRuntimeConfigPayload({ includeSecrets: true }), null, 2), 'utf8');
};

const loadState = async () => {
  await ensureDataDir();
  if (!existsSync(STATE_PATH)) return createDefaultState();

  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return ensureStateShape(parsed);
  } catch (error) {
    console.error('Failed to load state, fallback to defaults:', error);
    return createDefaultState();
  }
};

let state = await loadState();
await loadRuntimeConfig();

const persistState = async () => {
  await ensureDataDir();
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
};

const addAudit = (type, payload) => {
  const event = {
    id: randomId('audit'),
    type,
    at: toNowIso(),
    ...payload,
  };
  state.audit.unshift(event);
  if (state.audit.length > 500) state.audit = state.audit.slice(0, 500);
};

const isImportBlockedByGuardrail = (confidence) => Number(confidence ?? 0) < IMPORT_GUARDRAIL_CONFIDENCE;

const buildProposalKeyboard = (proposalId, confidence) => {
  if (isImportBlockedByGuardrail(confidence)) {
    return {
      inline_keyboard: [
        [
          { text: 'Nachbearbeiten', callback_data: `tg:edit:${proposalId}` },
          { text: 'Verwerfen', callback_data: `tg:no:${proposalId}` },
        ],
      ],
    };
  }

  return {
    inline_keyboard: [
      [
        { text: 'Importieren', callback_data: `tg:ok:${proposalId}` },
        { text: 'Verwerfen', callback_data: `tg:no:${proposalId}` },
      ],
    ],
  };
};

const renderEditTemplate = (proposal, database) => {
  const lines = database.properties.map((property) => {
    const value = proposal.values?.[property.id];
    const rendered = value === null || value === undefined ? '' : Array.isArray(value) ? value.join(', ') : String(value);
    return `${property.name}: ${rendered}`;
  });

  if (proposal.metadata?.comment) lines.push(`Kommentar: ${proposal.metadata.comment}`);
  if (proposal.metadata?.source) lines.push(`Quelle: ${proposal.metadata.source}`);

  return lines.join('\n');
};

const renderProposalText = (proposal) => {
  const warningLine = proposal.unmapped.length ? `\nNicht zugeordnet: ${proposal.unmapped.join(' | ')}` : '';
  const confidencePct = Math.round((proposal.confidence ?? 0) * 100);
  const usedLlm = String(proposal.extractionMode ?? '').startsWith('llm');
  const confidenceLine = `Extraktion: ${usedLlm ? 'LLM' : 'Rule'} | Confidence: ${confidencePct}%`;
  const lowConfidenceLine =
    proposal.confidence < LLM_MIN_CONFIDENCE
      ? `Achtung: niedrige Sicherheit (< ${Math.round(LLM_MIN_CONFIDENCE * 100)}%). Bitte vor Import pruefen.`
      : '';
  const guardrailLine = isImportBlockedByGuardrail(proposal.confidence)
    ? `Guardrail aktiv: Unter ${Math.round(IMPORT_GUARDRAIL_CONFIDENCE * 100)}% ist direkter Import gesperrt.`
    : '';
  return [
    'Neue Vorlage erkannt.',
    confidenceLine,
    proposal.reasoning ? `Hinweis: ${proposal.reasoning}` : '',
    lowConfidenceLine,
    guardrailLine,
    '',
    describeValues(proposal.values),
    warningLine,
    '',
    `Proposal-ID: ${proposal.id}`,
    'Importieren?',
  ]
    .filter(Boolean)
    .join('\n');
};

const getConversationKey = (chatId) => String(chatId ?? '');

const sendProposalPreview = async (proposal) => {
  if (!proposal?.chatId) return;
  const keyboard = buildProposalKeyboard(proposal.id, proposal.confidence);
  const sent = await tgApi('sendMessage', {
    chat_id: proposal.chatId,
    text: renderProposalText(proposal),
    reply_markup: keyboard,
  });

  if (sent?.ok && sent?.result?.message_id && state.pending[proposal.id]) {
    state.pending[proposal.id].previewMessageId = sent.result.message_id;
    await persistState();
  }
};

const renderFollowupQuestion = (property, remaining, slotHints = []) => {
  const base = `Bitte ${property.name} angeben.`;
  if (property.type === 'date') {
    const hintsBlock = slotHints.length ? `\nVorschlaege:\n${slotHints.map((hint, idx) => `${idx + 1}. ${hint}`).join('\n')}` : '';
    return `${base}\nFormat: TT.MM.JJJJ oder YYYY-MM-DD (auch "morgen", "heute").${hintsBlock}\nOffen: ${remaining}`;
  }
  if (isLikelyTimeProperty(property)) {
    const hintsBlock = slotHints.length ? `\nVorschlaege:\n${slotHints.map((hint, idx) => `${idx + 1}. ${hint}`).join('\n')}` : '';
    return `${base}\nFormat: 15:00, 15 Uhr, halb drei, viertel nach zwei.${hintsBlock}\nOffen: ${remaining}`;
  }
  if (property.type === 'select' && Array.isArray(property.options) && property.options.length > 0) {
    return `${base}\nOptionen: ${property.options.join(' | ')}\nOffen: ${remaining}`;
  }
  return `${base}\nOffen: ${remaining}`;
};

const getFollowupSlotHints = async (property, proposal) => {
  if (!(property?.type === 'date' || isLikelyTimeProperty(property))) return [];
  if (!isGoogleConfigured()) return [];

  try {
    const rawFromDate = proposal?.values?.[CARD_PROPERTY_IDS.date];
    const fromDate = typeof rawFromDate === 'string' && rawFromDate ? rawFromDate : null;
    const slotResult = await getGoogleSlotSuggestions({
      timezone: GOOGLE_TIMEZONE,
      workdayStart: '07:00',
      workdayEnd: '17:30',
      durationMin: GOOGLE_EVENT_DURATION_MIN,
      top: 3,
      businessDays: [1, 2, 3, 4, 5],
      windowDays: GOOGLE_SLOT_WINDOW_DAYS,
      fromDate,
    });

    const suggestions = Array.isArray(slotResult?.suggestions) ? slotResult.suggestions : [];
    return suggestions.slice(0, 3).map((entry) => `${entry.date} ${entry.timeLabel}`);
  } catch {
    return [];
  }
};

const askNextFollowupQuestion = async (chatId) => {
  const conversation = state.conversations?.[getConversationKey(chatId)];
  if (!conversation) return false;
  const proposal = state.pending?.[conversation.proposalId];
  if (!proposal) {
    delete state.conversations[getConversationKey(chatId)];
    await persistState();
    return false;
  }

  const nextPropertyId = conversation.missingPropertyIds?.[0];
  if (!nextPropertyId) {
    delete state.conversations[getConversationKey(chatId)];
    await persistState();
    await sendProposalPreview(proposal);
    return true;
  }

  const property = state.board.database.properties.find((entry) => entry.id === nextPropertyId);
  if (!property) {
    conversation.missingPropertyIds = getMissingFollowupPropertyIds(proposal, state.board.database);
    conversation.updatedAt = toNowIso();
    await persistState();
    return askNextFollowupQuestion(chatId);
  }

  conversation.lastAskedPropertyId = property.id;
  conversation.updatedAt = toNowIso();
  await persistState();
  const slotHints = await getFollowupSlotHints(property, proposal);

  await tgApi('sendMessage', {
    chat_id: chatId,
    text: renderFollowupQuestion(property, conversation.missingPropertyIds.length, slotHints),
  });
  return true;
};

const maybeStartFollowupConversation = async (proposal) => {
  if (!AGENT_ENABLED) return false;
  const missingPropertyIds = getMissingFollowupPropertyIds(proposal, state.board.database);
  if (!missingPropertyIds.length) return false;

  const chatId = proposal.chatId;
  state.conversations[getConversationKey(chatId)] = {
    proposalId: proposal.id,
    startedAt: toNowIso(),
    updatedAt: toNowIso(),
    missingPropertyIds,
    lastAskedPropertyId: null,
  };
  addAudit('telegram_agent_followup_started', {
    actor: proposal.from?.id ? `telegram:${proposal.from.id}` : 'telegram:unknown',
    chatId,
    proposalId: proposal.id,
    missingPropertyIds,
  });
  await persistState();
  await askNextFollowupQuestion(chatId);
  return true;
};

const handleFollowupAnswer = async (message, text) => {
  const chatId = message?.chat?.id;
  if (!chatId) return false;
  const conversation = state.conversations?.[getConversationKey(chatId)];
  if (!conversation) return false;

  const proposal = state.pending?.[conversation.proposalId];
  if (!proposal) {
    delete state.conversations[getConversationKey(chatId)];
    await persistState();
    return false;
  }

  const targetPropertyId = conversation.missingPropertyIds?.[0];
  if (!targetPropertyId) {
    delete state.conversations[getConversationKey(chatId)];
    await persistState();
    await sendProposalPreview(proposal);
    return true;
  }

  const property = state.board.database.properties.find((entry) => entry.id === targetPropertyId);
  if (!property) {
    conversation.missingPropertyIds = getMissingFollowupPropertyIds(proposal, state.board.database);
    conversation.updatedAt = toNowIso();
    await persistState();
    await askNextFollowupQuestion(chatId);
    return true;
  }

  const parsed = parseValueForProperty(property, text, state.board.columns);
  if (!parsed.ok) {
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: parsed.message ?? `Wert fuer ${property.name} konnte nicht gelesen werden. Bitte erneut angeben.`,
    });
    await askNextFollowupQuestion(chatId);
    return true;
  }

  proposal.values[property.id] = parsed.value;
  if (property.id === CARD_PROPERTY_IDS.title) {
    proposal.values[CARD_PROPERTY_IDS.title] = String(parsed.value ?? '').trim() || APP_DEFAULTS.newCardTitle;
  }

  if (property.type === 'date') {
    const timePropertyId = findTimePropertyId(state.board.database);
    if (timePropertyId && isMissingValueForProperty({ type: 'text' }, proposal.values[timePropertyId])) {
      const maybeTime = normalizeTimeValue(text);
      if (maybeTime) proposal.values[timePropertyId] = maybeTime;
    }
  }

  if (isLikelyTimeProperty(property)) {
    const maybeDate = parseIsoDate(text) ?? extractIsoDateFromText(text);
    if (maybeDate && isMissingValueForProperty({ type: 'date' }, proposal.values[CARD_PROPERTY_IDS.date])) {
      proposal.values[CARD_PROPERTY_IDS.date] = maybeDate;
    }
  }

  conversation.missingPropertyIds = getMissingFollowupPropertyIds(proposal, state.board.database);
  conversation.updatedAt = toNowIso();
  addAudit('telegram_agent_followup_answered', {
    actor: message.from?.id ? `telegram:${message.from.id}` : 'telegram:unknown',
    chatId,
    proposalId: proposal.id,
    propertyId: property.id,
  });

  if (!conversation.missingPropertyIds.length) {
    delete state.conversations[getConversationKey(chatId)];
    addAudit('telegram_agent_followup_completed', {
      actor: message.from?.id ? `telegram:${message.from.id}` : 'telegram:unknown',
      chatId,
      proposalId: proposal.id,
    });
    await persistState();
    await sendProposalPreview(proposal);
    return true;
  }

  await persistState();
  await askNextFollowupQuestion(chatId);
  return true;
};

const renderTelegramTemplate = (database, columns) => {
  const statuses = Object.keys(columns);
  const defaultStatus = statuses.includes(APP_DEFAULTS.fallbackStatus) ? APP_DEFAULTS.fallbackStatus : statuses[0] ?? '';
  const fields = Array.isArray(database?.properties)
    ? database.properties
        .map((property) => String(property?.name ?? '').trim())
        .filter(Boolean)
        .filter((name) => normalizeKey(name) !== 'status')
    : ['Titel', 'Datum', 'Ort', 'Adresse', 'Telefon'];

  const lines = ['Vorlage fuer neue Anfrage:', ''];
  for (const field of fields) lines.push(`${field}:`);
  lines.push('Quelle:');
  lines.push('Kommentar:');
  lines.push(`Status: ${defaultStatus}`);
  lines.push('');
  lines.push('Du kannst auch Freitext senden, z. B.:');
  lines.push('Termin: morgen 15 Uhr, Ort: Lienz, Adresse: Peter Weber Gasse, Datum: 19.02.2026');
  return lines.join('\n');
};

const renderTelegramHelp = () =>
  [
    'Verfuegbare Kommandos:',
    '/neu - Vorlage zum Ausfuellen',
    '/beispiel - Beispieltexte',
    '/abbrechen - Rueckfragen beenden',
    '/hilfe - Diese Hilfe',
    '',
    'Tipp: Spracheingabe ist okay. Nutze moeglichst Schluesselwoerter wie',
    'Titel, Datum, Uhrzeit, Ort, Adresse, Telefon, Quelle, Kommentar, Status.',
  ].join('\n');

const renderTelegramExamples = (columns) => {
  const statuses = Object.keys(columns);
  const defaultStatus = statuses.includes(APP_DEFAULTS.fallbackStatus) ? APP_DEFAULTS.fallbackStatus : statuses[0] ?? '';

  return [
    'Beispiele:',
    '',
    `1) Strukturierte Vorlage`,
    `Titel: Fensterbank Montage`,
    `Datum: 19.02.2026`,
    `Uhrzeit: 15:00`,
    `Ort: Lienz`,
    `Adresse: Peter Weber Gasse`,
    `Telefon: +43 660 1234567`,
    `Quelle: WhatsApp`,
    `Status: ${defaultStatus}`,
    '',
    `2) Freitext`,
    `Termin: morgen 15 Uhr, Ort: Lienz, Adresse: Peter Weber Gasse, Datum: 19.02.2026`,
  ].join('\n');
};

const parseTelegramCommand = (text) => {
  const match = /^\/([a-z0-9_]+)(?:@[\w_]+)?(?:\s+(.*))?$/i.exec(String(text ?? '').trim());
  if (!match) return null;
  return {
    name: match[1].toLowerCase(),
    args: match[2] ?? '',
  };
};

const buildProcessedMessageKey = (message) => {
  if (!message?.chat?.id) return '';
  if (!Number.isInteger(message.message_id)) return '';
  return `${message.chat.id}:${message.message_id}`;
};

const hasProcessedMessageKey = (key) => {
  if (!key) return false;
  const keys = Array.isArray(state.processedMessageKeys) ? state.processedMessageKeys : [];
  return keys.includes(key);
};

const rememberProcessedMessageKey = (key) => {
  if (!key) return;
  const keys = Array.isArray(state.processedMessageKeys) ? state.processedMessageKeys : [];
  if (keys.includes(key)) return;
  state.processedMessageKeys = [...keys, key].slice(-MAX_PROCESSED_MESSAGE_KEYS);
};

const handleTelegramCommand = async (message, text) => {
  if (!message?.chat?.id) return false;
  const parsed = parseTelegramCommand(text);
  if (!parsed) return false;

  const command = parsed.name;
  const chatKey = getConversationKey(message.chat.id);
  const conversation = state.conversations?.[chatKey];
  let replyText = '';

  if (['abbrechen', 'cancel', 'stop'].includes(command)) {
    if (!conversation) {
      replyText = 'Kein aktiver Rueckfrage-Flow vorhanden.';
    } else {
      const proposal = state.pending?.[conversation.proposalId];
      delete state.conversations[chatKey];
      addAudit('telegram_agent_followup_cancelled', {
        actor: `telegram:${message.from?.id ?? 'unknown'}`,
        chatId: message.chat.id,
        proposalId: conversation.proposalId,
      });
      await persistState();
      if (proposal) {
        await sendProposalPreview(proposal);
        replyText = 'Rueckfragen beendet. Vorschau wurde erneut gesendet.';
      } else {
        replyText = 'Rueckfragen beendet.';
      }
    }
  } else if (['start', 'hilfe', 'help'].includes(command)) {
    replyText = renderTelegramHelp();
  } else if (['neu', 'new'].includes(command)) {
    replyText = renderTelegramTemplate(state.board.database, state.board.columns);
  } else if (['beispiel', 'example'].includes(command)) {
    replyText = renderTelegramExamples(state.board.columns);
  } else {
    replyText = `Unbekanntes Kommando: /${command}\nNutze /hilfe fuer die verfuegbaren Kommandos.`;
  }

  addAudit('telegram_command_received', {
    actor: `telegram:${message.from?.id ?? 'unknown'}`,
    chatId: message.chat.id,
    messageId: message.message_id,
    command,
  });
  await persistState();

  await tgApi('sendMessage', {
    chat_id: message.chat.id,
    text: replyText,
  });
  return true;
};

const handleMessageUpdate = async (message) => {
  if (!message?.chat?.id) return;
  if (!Number.isInteger(message.message_id)) return;
  const messageDedupKey = buildProcessedMessageKey(message);
  if (messageDedupKey && hasProcessedMessageKey(messageDedupKey)) return;
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (!text) return;

  if (text.startsWith('/')) {
    const handled = await handleTelegramCommand(message, text);
    if (handled) {
      rememberProcessedMessageKey(messageDedupKey);
      await persistState();
      return;
    }
  }

  const handledAsFollowup = await handleFollowupAnswer(message, text);
  if (handledAsFollowup) {
    rememberProcessedMessageKey(messageDedupKey);
    await persistState();
    return;
  }

  const existingPending = Object.values(state.pending).find(
    (proposal) => proposal.chatId === message.chat.id && proposal.messageId === message.message_id,
  );
  if (existingPending) {
    rememberProcessedMessageKey(messageDedupKey);
    await persistState();
    return;
  }

  const parsed = parseMessageAgainstSchema(text, state.board.database, state.board.columns);
  const llmParsed = await callLlmExtraction(text, state.board.database, state.board.columns, parsed);
  const extracted = llmParsed ?? parsed;
  const proposalId = randomId('proposal');

  const proposal = {
    id: proposalId,
    createdAt: toNowIso(),
    chatId: message.chat.id,
    messageId: message.message_id,
    from: message.from
      ? {
          id: message.from.id,
          username: message.from.username ?? null,
          firstName: message.from.first_name ?? null,
        }
      : null,
    rawText: text,
    values: extracted.values,
    metadata: extracted.metadata,
    unmapped: extracted.unmapped,
    confidence: extracted.confidence,
    extractionMode: extracted.extractionMode,
    reasoning: extracted.reasoning,
    previewMessageId: null,
  };

  state.pending[proposalId] = proposal;
  rememberProcessedMessageKey(messageDedupKey);
  addAudit('telegram_proposal_created', {
    actor: `telegram:${message.from?.id ?? 'unknown'}`,
    proposalId,
    chatId: message.chat.id,
    messageId: message.message_id,
    extractionMode: proposal.extractionMode,
    confidence: proposal.confidence,
  });
  await persistState();

  const followupStarted = await maybeStartFollowupConversation(proposal);
  if (followupStarted) return;

  await sendProposalPreview(proposal);
};

const handleCallbackQuery = async (query) => {
  const callbackId = query?.id;
  const data = typeof query?.data === 'string' ? query.data : '';
  const chatId = query?.message?.chat?.id;
  const messageId = query?.message?.message_id;
  const actor = query?.from?.id ? `telegram:${query.from.id}` : 'telegram:unknown';

  if (!callbackId || !data) return;
  const match = /^tg:(ok|no|edit):([a-z0-9_]+)$/i.exec(data);
  if (!match) {
    await tgApi('answerCallbackQuery', { callback_query_id: callbackId, text: 'Ungueltige Aktion.' });
    return;
  }

  const action = match[1];
  const proposalId = match[2];
  const proposal = state.pending[proposalId];
  if (!proposal) {
    await tgApi('answerCallbackQuery', { callback_query_id: callbackId, text: 'Proposal nicht gefunden.' });
    return;
  }

  if (action === 'edit') {
    const template = renderEditTemplate(proposal, state.board.database);
    delete state.pending[proposalId];
    addAudit('telegram_proposal_edit_requested', {
      actor,
      proposalId,
      chatId: proposal.chatId,
      extractionMode: proposal.extractionMode,
      confidence: proposal.confidence,
    });
    await persistState();

    if (chatId && messageId) {
      await tgApi('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `Proposal ${proposalId} zur Nachbearbeitung markiert.\nBitte korrigierte Vorlage neu senden:\n\n${template}`,
      });
    }
    await tgApi('answerCallbackQuery', {
      callback_query_id: callbackId,
      text: 'Bitte Vorlage korrigieren und neu senden.',
    });
    return;
  }

  if (action === 'no') {
    delete state.pending[proposalId];
    addAudit('telegram_proposal_rejected', {
      actor,
      proposalId,
      chatId: proposal.chatId,
      extractionMode: proposal.extractionMode,
      confidence: proposal.confidence,
    });
    await persistState();

    if (chatId && messageId) {
      await tgApi('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `Proposal ${proposalId} wurde verworfen.`,
      });
    }
    await tgApi('answerCallbackQuery', { callback_query_id: callbackId, text: 'Verworfen.' });
    return;
  }

  const activeConversation = Object.values(state.conversations ?? {}).find(
    (conversation) => conversation?.proposalId === proposalId && Array.isArray(conversation?.missingPropertyIds),
  );
  if (activeConversation && activeConversation.missingPropertyIds.length > 0) {
    await tgApi('answerCallbackQuery', {
      callback_query_id: callbackId,
      text: 'Bitte zuerst Rueckfragen abschliessen.',
    });
    if (proposal.chatId) {
      await askNextFollowupQuestion(proposal.chatId);
    }
    return;
  }

  if (isImportBlockedByGuardrail(proposal.confidence)) {
    await tgApi('answerCallbackQuery', {
      callback_query_id: callbackId,
      text: `Import gesperrt unter ${Math.round(IMPORT_GUARDRAIL_CONFIDENCE * 100)}%. Bitte Nachbearbeiten.`,
    });
    return;
  }

  const duplicate = findDuplicateCardForProposal(proposal, state.board);
  if (duplicate) {
    delete state.pending[proposalId];
    addAudit('telegram_import_deduplicated', {
      actor,
      proposalId,
      cardId: duplicate.id,
      chatId: proposal.chatId,
      extractionMode: proposal.extractionMode,
      confidence: proposal.confidence,
    });
    await persistState();

    if (chatId && messageId) {
      await tgApi('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `Bereits vorhanden als Karte ${duplicate.id}\nTitel: ${duplicate.title}\nStatus: ${duplicate.status}`,
      });
    }
    await tgApi('answerCallbackQuery', { callback_query_id: callbackId, text: 'Bereits importiert.' });
    return;
  }

  const card = createCardFromProposal(proposal, state.board);
  delete state.pending[proposalId];
  addAudit('telegram_import_confirmed', {
    actor,
    proposalId,
    cardId: card.id,
    chatId: proposal.chatId,
    extractionMode: proposal.extractionMode,
    confidence: proposal.confidence,
  });
  await persistState();

  let autoGoogleSyncNote = '';
  if (AUTO_GOOGLE_SYNC_ON_TELEGRAM_IMPORT && GOOGLE_ENABLED && isGoogleConfigured()) {
    try {
      const syncResult = await runGoogleSyncJob({
        boardInput: state.board,
        forceResync: false,
        persistBoardUpdates: true,
        modeLabel: 'auto_import_sync',
        actor: `telegram:${query?.from?.id ?? 'unknown'}`,
      });
      const cardUpdate = Array.isArray(syncResult.updates)
        ? syncResult.updates.find((entry) => String(entry?.cardId ?? '') === card.id)
        : null;
      if (cardUpdate && String(cardUpdate.action) === 'error') {
        autoGoogleSyncNote = '\nGoogle Sync: Fehler (siehe Diagnose).';
      } else if (cardUpdate) {
        autoGoogleSyncNote = `\nGoogle Sync: ${String(cardUpdate.action)}.`;
      } else {
        autoGoogleSyncNote = '\nGoogle Sync: ausgefuehrt.';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addAudit('telegram_auto_google_sync_failed', {
        actor,
        cardId: card.id,
        message,
      });
      await persistState();
      autoGoogleSyncNote = '\nGoogle Sync: Fehler.';
    }
  }

  if (chatId && messageId) {
    await tgApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `Importiert als Karte ${card.id}\nTitel: ${card.title}\nStatus: ${card.status}${autoGoogleSyncNote}`,
    });
  }
  await tgApi('answerCallbackQuery', { callback_query_id: callbackId, text: 'Importiert.' });
};

const handleTelegramWebhook = async (req, res) => {
  if (WEBHOOK_SECRET) {
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (header !== WEBHOOK_SECRET) {
      sendJson(res, 401, { ok: false, error: 'Invalid webhook secret.' });
      return;
    }
  }

  let payload;
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (error) {
    sendJson(res, 400, { ok: false, error: `Invalid JSON: ${String(error)}` });
    return;
  }

  const updateId = Number.isInteger(payload.update_id) ? payload.update_id : null;
  const knownUpdates = new Set(Array.isArray(state.processedUpdateIds) ? state.processedUpdateIds : []);
  if (updateId !== null && (knownUpdates.has(updateId) || updateId <= state.lastUpdateId)) {
    sendJson(res, 200, { ok: true, dedup: true });
    return;
  }

  try {
    if (payload.message || payload.channel_post) {
      await handleMessageUpdate(payload.message ?? payload.channel_post);
    } else if (payload.callback_query) {
      await handleCallbackQuery(payload.callback_query);
    } else {
      addAudit('telegram_webhook_ignored', {
        actor: 'system',
        reason: 'unsupported_update_type',
        keys: Object.keys(payload ?? {}),
      });
      await persistState();
    }

    if (updateId !== null) {
      state.lastUpdateId = Math.max(state.lastUpdateId ?? -1, updateId);
      const nextProcessed = [...knownUpdates, updateId];
      state.processedUpdateIds = nextProcessed.slice(-MAX_PROCESSED_UPDATE_IDS);
      await persistState();
    }

    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('Webhook processing failed:', error);
    addAudit('telegram_webhook_error', {
      actor: 'system',
      message: error instanceof Error ? error.message : String(error),
    });
    await persistState();
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

const handleBoardSchemaUpdate = async (req, res, actor = 'client') => {
  let payload;
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (error) {
    sendJson(res, 400, { ok: false, error: `Invalid JSON: ${String(error)}` });
    return;
  }

  const candidate = isObject(payload) && isObject(payload.database) ? payload.database : payload;
  const normalized = normalizeSchemaInput(candidate, state.board.columns);
  if (!normalized) {
    sendJson(res, 400, { ok: false, error: 'Invalid database schema payload.' });
    return;
  }

  const currentSerialized = JSON.stringify(state.board.database ?? {});
  const nextSerialized = JSON.stringify(normalized);
  if (currentSerialized === nextSerialized) {
    sendJson(res, 200, { ok: true, database: state.board.database, unchanged: true });
    return;
  }

  state.board.database = normalized;
  addAudit('board_schema_updated', {
    actor,
    propertyCount: normalized.properties.length,
  });
  await persistState();
  sendJson(res, 200, { ok: true, database: normalized });
};

const handleGoogleCalendarSetup = async (req, res, actor = 'client') => {
  let payload = {};
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (error) {
    sendJson(res, 400, { ok: false, error: `Invalid JSON: ${String(error)}` });
    return;
  }

  try {
    const sharedWith = Array.isArray(payload?.sharedWith)
      ? payload.sharedWith.map((entry) => String(entry).trim()).filter(Boolean)
      : GOOGLE_SHARED_WITH;
    const role = ['owner', 'writer', 'reader', 'freeBusyReader'].includes(String(payload?.role ?? GOOGLE_SHARE_ROLE))
      ? String(payload?.role ?? GOOGLE_SHARE_ROLE)
      : GOOGLE_SHARE_ROLE;
    const result = await ensureGoogleCalendarSetup({ sharedWith, role });
    addAudit('google_calendar_setup', {
      actor,
      calendarId: result.calendar?.id ?? GOOGLE_CALENDAR_ID,
      sharedWith: result.sharedWith ?? [],
      role,
    });
    await persistState();
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

const handleGoogleSync = async (req, res, actor = 'client') => {
  let payload = {};
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (error) {
    sendJson(res, 400, { ok: false, error: `Invalid JSON: ${String(error)}` });
    return;
  }

  const boardCandidate = isObject(payload) && isObject(payload.board) ? payload.board : payload;
  if (!isObject(boardCandidate) || !isObject(boardCandidate.cardsById) || !isObject(boardCandidate.columns)) {
    sendJson(res, 400, { ok: false, error: 'Invalid board payload for Google sync.' });
    return;
  }

  const forceResync = Boolean(
    payload?.forceResync ?? (isObject(payload?.options) ? payload.options.forceResync : false),
  );

  try {
    const syncResult = await runGoogleSyncJob({
      boardInput: boardCandidate,
      forceResync,
      persistBoardUpdates: false,
      modeLabel: forceResync ? 'resync' : 'sync',
      actor,
    });
    sendJson(res, 200, { ok: true, ...syncResult });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

const handleGoogleSlots = async (req, res, actor = 'client') => {
  let payload = {};
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (error) {
    sendJson(res, 400, { ok: false, error: `Invalid JSON: ${String(error)}` });
    return;
  }

  try {
    const durationMin = Math.max(15, Math.min(8 * 60, Number(payload?.durationMin ?? GOOGLE_EVENT_DURATION_MIN)));
    const top = Math.max(1, Math.min(10, Number(payload?.top ?? 3)));
    const businessDays = Array.isArray(payload?.businessDays)
      ? payload.businessDays.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6)
      : [1, 2, 3, 4, 5];

    const slotResult = await getGoogleSlotSuggestions({
      timezone: typeof payload?.timezone === 'string' ? payload.timezone : GOOGLE_TIMEZONE,
      workdayStart: typeof payload?.workdayStart === 'string' ? payload.workdayStart : '07:00',
      workdayEnd: typeof payload?.workdayEnd === 'string' ? payload.workdayEnd : '17:30',
      durationMin,
      top,
      businessDays: businessDays.length ? businessDays : [1, 2, 3, 4, 5],
      windowDays: Math.max(3, Math.min(31, Number(payload?.windowDays ?? GOOGLE_SLOT_WINDOW_DAYS))),
      fromDate: typeof payload?.fromDate === 'string' ? payload.fromDate : null,
    });

    addAudit('google_slots_requested', {
      actor,
      suggested: slotResult?.top ?? 0,
      durationMin,
    });
    await persistState();

    sendJson(res, 200, { ok: true, ...slotResult });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

const handleListBackups = async (_req, res) => {
  try {
    const backups = await listBackups();
    sendJson(res, 200, {
      ok: true,
      backups,
      maintenance: state.maintenance ?? {},
      retentionDays: BACKUP_RETENTION_DAYS,
      backupEnabled: BACKUP_ENABLED,
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

const handleRunBackup = async (req, res, role = 'owner') => {
  let payload = {};
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (error) {
    sendJson(res, 400, { ok: false, error: `Invalid JSON: ${String(error)}` });
    return;
  }

  const reason = isObject(payload) ? String(payload.reason ?? 'manual').trim() || 'manual' : 'manual';

  try {
    const result = await createStateBackup({
      reason,
    });
    addAudit('backup_run_requested', {
      actor: role,
      reason,
      file: result.file,
    });
    await persistState();
    sendJson(res, 200, {
      ok: true,
      result,
      maintenance: state.maintenance ?? {},
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

const handleRestoreBackup = async (req, res, role = 'owner') => {
  let payload = {};
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (error) {
    sendJson(res, 400, { ok: false, error: `Invalid JSON: ${String(error)}` });
    return;
  }

  const fileName = isObject(payload) ? String(payload.fileName ?? '').trim() : '';
  if (!fileName) {
    sendJson(res, 400, { ok: false, error: 'fileName is required.' });
    return;
  }

  try {
    await restoreStateFromBackupFile({
      fileName,
      actor: role,
    });
    sendJson(res, 200, {
      ok: true,
      maintenance: state.maintenance ?? {},
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

const handleGetPresetTelemetry = (_req, res) => {
  sendJson(res, 200, {
    ok: true,
    telemetry: buildPresetTelemetryReport(state.presetTelemetry, { includeEvents: false }),
  });
};

const handleExportPresetTelemetry = (_req, res) => {
  sendJson(res, 200, {
    ok: true,
    exportedAt: toNowIso(),
    telemetry: buildPresetTelemetryReport(state.presetTelemetry, { includeEvents: true }),
  });
};

const handleRecordPresetTelemetryEvent = async (req, res, actor = 'client') => {
  let payload = {};
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (error) {
    sendJson(res, 400, { ok: false, error: `Invalid JSON: ${String(error)}` });
    return;
  }

  if (!isObject(payload)) {
    sendJson(res, 400, { ok: false, error: 'Invalid telemetry payload.' });
    return;
  }

  const channel = String(payload.channel ?? '').trim().toLowerCase();
  const action = String(payload.action ?? '').trim().toLowerCase();
  const presetId = String(payload.presetId ?? '').trim() || 'custom';

  try {
    registerPresetTelemetryEvent({ channel, action, presetId });
    addAudit('preset_telemetry_event', {
      actor,
      channel,
      action,
      presetId,
    });
    await persistState();
    sendJson(res, 200, {
      ok: true,
      telemetry: buildPresetTelemetryReport(state.presetTelemetry, { includeEvents: false }),
    });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

const handleResetPresetTelemetry = async (_req, res, actor = 'client') => {
  state.presetTelemetry = createDefaultPresetTelemetryState();
  addAudit('preset_telemetry_reset', {
    actor,
  });
  await persistState();
  sendJson(res, 200, {
    ok: true,
    telemetry: buildPresetTelemetryReport(state.presetTelemetry, { includeEvents: false }),
  });
};

const handleGetRuntimeConfig = (_req, res) => {
  sendJson(res, 200, {
    ok: true,
    config: buildRuntimeConfigPayload({ includeSecrets: false }),
  });
};

const handleUpdateRuntimeConfig = async (req, res, actor = 'client') => {
  let payload = {};
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (error) {
    sendJson(res, 400, { ok: false, error: `Invalid JSON: ${String(error)}` });
    return;
  }

  if (!isObject(payload)) {
    sendJson(res, 400, { ok: false, error: 'Invalid config payload.' });
    return;
  }

  const candidate = isObject(payload.config) ? payload.config : payload;
  applyRuntimeConfig(candidate);
  addAudit('runtime_config_updated', {
    actor,
    llmEnabled: LLM_ENABLED,
    googleEnabled: GOOGLE_ENABLED,
    agentEnabled: AGENT_ENABLED,
    authEnabled: SECURITY_AUTH_ENABLED,
    backupEnabled: BACKUP_ENABLED,
  });
  await persistState();
  await persistRuntimeConfig();

  const health = await buildHealthPayload();
  sendJson(res, 200, {
    ok: true,
    config: buildRuntimeConfigPayload({ includeSecrets: false }),
    health,
  });
};

const buildHealthAlerts = ({ telegramWebhook, llmConfigured, googleHealth, googleSync }) => {
  const alerts = [];
  const add = (severity, code, message) => {
    alerts.push({
      severity,
      code,
      message,
    });
  };

  if (!BOT_TOKEN) add('warn', 'telegram_bot_missing', 'Telegram Bot Token fehlt.');
  if (!telegramWebhook.configured) add('warn', 'telegram_webhook_missing', 'Telegram Webhook ist nicht gesetzt.');
  if (telegramWebhook.configured && !telegramWebhook.ok) add('warn', 'telegram_webhook_unhealthy', 'Telegram Webhook meldet Fehler.');

  if (LLM_ENABLED && !llmConfigured) add('warn', 'llm_not_configured', 'LLM ist aktiv, aber nicht voll konfiguriert.');

  if (GOOGLE_ENABLED && !googleHealth.configured) add('warn', 'google_not_configured', 'Google Sync ist aktiv, aber nicht konfiguriert.');
  if (GOOGLE_ENABLED && googleHealth.configured && !googleHealth.canWrite) {
    add('warn', 'google_no_write_access', 'Google Kalender ist verbunden, aber ohne Schreibzugriff.');
  }

  if (googleSync?.ok === false) {
    add('critical', 'google_sync_failed', `Letzter Google-Sync ist fehlgeschlagen: ${googleSync?.error ?? '-'}`);
  }

  if (Number(Object.keys(state.pending ?? {}).length) > 25) {
    add('warn', 'telegram_pending_high', 'Viele offene Telegram-Proposals.');
  }

  if (SECURITY_AUTH_ENABLED && SECURITY_OWNER_KEYS.length === 0) {
    add('critical', 'security_owner_key_missing', 'Auth ist aktiv, aber keine Owner-Keys gesetzt.');
  }

  if (BACKUP_ENABLED && BACKUP_DAILY_ENABLED) {
    const lastBackupAt = String(state.maintenance?.lastBackupAt ?? '');
    if (!lastBackupAt) {
      add('warn', 'backup_missing', 'Backups sind aktiv, aber es wurde noch kein Backup erstellt.');
    } else {
      const ageMs = Date.now() - Date.parse(lastBackupAt);
      if (Number.isFinite(ageMs) && ageMs > 36 * 60 * 60 * 1000) {
        add('warn', 'backup_stale', 'Letztes Backup ist aelter als 36 Stunden.');
      }
    }
  }

  return alerts;
};

const buildHealthPayload = async () => {
  const [telegramWebhook, googleHealth] = await Promise.all([getTelegramWebhookInfo(), getGoogleCalendarHealth()]);
  const llmConfigured = isLlmConfigured();
  const processedUpdateCount = Array.isArray(state.processedUpdateIds) ? state.processedUpdateIds.length : 0;
  const processedMessageCount = Array.isArray(state.processedMessageKeys) ? state.processedMessageKeys.length : 0;
  const googleSync = state.googleSync && typeof state.googleSync === 'object' ? state.googleSync : createDefaultGoogleSyncState();
  const presetTelemetry = buildPresetTelemetryReport(state.presetTelemetry, { includeEvents: false });
  const alerts = buildHealthAlerts({ telegramWebhook, llmConfigured, googleHealth, googleSync });
  const rateLimitStats = {
    enabled: SECURITY_RATE_LIMIT_ENABLED,
    windowMs: SECURITY_RATE_LIMIT_WINDOW_MS,
    max: SECURITY_RATE_LIMIT_MAX,
    webhookMax: SECURITY_RATE_LIMIT_WEBHOOK_MAX,
    activeBuckets: rateLimitBuckets.size,
  };

  return {
    ok: true,
    service: 'telegram-mvp',
    serverTime: toNowIso(),
    botConfigured: Boolean(BOT_TOKEN),
    telegramWebhookConfigured: telegramWebhook.configured,
    telegramWebhookUrl: telegramWebhook.url ?? '',
    telegramWebhookPendingUpdateCount: Number(telegramWebhook.pendingUpdateCount ?? 0),
    telegramWebhookOk: Boolean(telegramWebhook.ok),
    telegramProcessedUpdateCount: processedUpdateCount,
    telegramProcessedMessageCount: processedMessageCount,
    llmEnabled: LLM_ENABLED,
    llmConfigured,
    llmModel: OPENAI_MODEL,
    llmStrategy: LLM_STRATEGY,
    llmRepairPass: LLM_REPAIR_PASS,
    llmRepairMinConfidence: LLM_REPAIR_MIN_CONFIDENCE,
    agentEnabled: AGENT_ENABLED,
    agentCriticalFields: getAgentCriticalFieldKeys(),
    agentFollowupIncludeRequired: AGENT_FOLLOWUP_INCLUDE_REQUIRED,
    agentPropertyPriority: AGENT_PROPERTY_PRIORITY_RAW,
    importGuardrailConfidence: IMPORT_GUARDRAIL_CONFIDENCE,
    pendingProposals: Object.keys(state.pending).length,
    openConversations: Object.keys(state.conversations ?? {}).length,
    googleEnabled: googleHealth.enabled,
    googleConfigured: googleHealth.configured,
    googleCalendarConfigured: googleHealth.calendarConfigured,
    googleCalendarId: googleHealth.calendarId,
    googleCalendarCanWrite: googleHealth.canWrite,
    googleCalendarAccessRole: googleHealth.accessRole,
    googleSync,
    automation: {
      autoGoogleSyncOnTelegramImport: AUTO_GOOGLE_SYNC_ON_TELEGRAM_IMPORT,
      dailyGoogleResyncEnabled: GOOGLE_DAILY_RESYNC_ENABLED,
    },
    dispatch: {
      enabled: DISPATCH_ENABLED,
      minScore: DISPATCH_MIN_SCORE,
      maxDailySlots: DISPATCH_MAX_DAILY_SLOTS,
      requiredFields: DISPATCH_REQUIRED_FIELDS_RAW,
      scoreWeights: DISPATCH_SCORE_WEIGHTS_RAW,
    },
    telegram: {
      botConfigured: Boolean(BOT_TOKEN),
      webhook: telegramWebhook,
      processedUpdateCount,
      processedMessageCount,
    },
    llm: {
      enabled: LLM_ENABLED,
      configured: llmConfigured,
      model: OPENAI_MODEL,
      strategy: LLM_STRATEGY,
      repairPass: LLM_REPAIR_PASS,
      repairMinConfidence: LLM_REPAIR_MIN_CONFIDENCE,
    },
    google: {
      ...googleHealth,
      sync: googleSync,
    },
    security: {
      authEnabled: SECURITY_AUTH_ENABLED,
      corsOrigins: SECURITY_CORS_ORIGINS,
      rateLimit: rateLimitStats,
    },
    backup: {
      enabled: BACKUP_ENABLED,
      dailyEnabled: BACKUP_DAILY_ENABLED,
      dailyHourUtc: BACKUP_DAILY_HOUR_UTC,
      retentionDays: BACKUP_RETENTION_DAYS,
      lastBackupAt: String(state.maintenance?.lastBackupAt ?? ''),
      lastBackupFile: String(state.maintenance?.lastBackupFile ?? ''),
      lastDailyBackupDate: String(state.maintenance?.lastDailyBackupDate ?? ''),
      lastRestoreAt: String(state.maintenance?.lastRestoreAt ?? ''),
      lastRestoreFile: String(state.maintenance?.lastRestoreFile ?? ''),
    },
    alerts,
    presetTelemetry,
  };
};

const server = http.createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `localhost:${PORT}`}`);
  const origin = String(req.headers.origin ?? '').trim();
  const allowedOrigin = getAllowedOrigin(origin);

  applyCorsHeaders(req, res);

  if (origin && !allowedOrigin) {
    sendJson(res, 403, { ok: false, error: 'CORS origin denied.' });
    return;
  }

  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const rateLimit = checkRateLimit(req, url);
  if (rateLimit.limited) {
    res.setHeader('Retry-After', String(rateLimit.retryAfterSec));
    sendJson(res, 429, { ok: false, error: 'Rate limit exceeded.', retryAfterSec: rateLimit.retryAfterSec });
    void sendSecurityAlert('Rate limit exceeded', {
      ip: getClientIp(req),
      path: url.pathname,
      method,
      retryAfterSec: rateLimit.retryAfterSec,
    });
    return;
  }

  const requireApiRole = (requiredRole) => {
    const role = requireRole(req, res, requiredRole);
    if (!role) {
      void sendSecurityAlert('Unauthorized API access', {
        ip: getClientIp(req),
        path: url.pathname,
        method,
        requiredRole,
      });
      return null;
    }
    return role;
  };

  if (method === 'GET' && url.pathname === '/api/config') {
    const role = requireApiRole('owner');
    if (!role) return;
    handleGetRuntimeConfig(req, res);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/config') {
    const role = requireApiRole('owner');
    if (!role) return;
    await handleUpdateRuntimeConfig(req, res, `api:${role}`);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/health') {
    const payload = await buildHealthPayload();
    sendJson(res, 200, payload);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/google/health') {
    const role = requireApiRole('readonly');
    if (!role) return;
    const health = await getGoogleCalendarHealth();
    sendJson(res, 200, { ok: true, ...health });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/telemetry/presets') {
    const role = requireApiRole('readonly');
    if (!role) return;
    handleGetPresetTelemetry(req, res);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/telemetry/presets/export') {
    const role = requireApiRole('owner');
    if (!role) return;
    handleExportPresetTelemetry(req, res);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/telemetry/presets/event') {
    const role = requireApiRole('dispatcher');
    if (!role) return;
    await handleRecordPresetTelemetryEvent(req, res, `api:${role}`);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/telemetry/presets/reset') {
    const role = requireApiRole('owner');
    if (!role) return;
    await handleResetPresetTelemetry(req, res, `api:${role}`);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/google/setup') {
    const role = requireApiRole('owner');
    if (!role) return;
    await handleGoogleCalendarSetup(req, res, `api:${role}`);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/google/sync') {
    const role = requireApiRole('dispatcher');
    if (!role) return;
    await handleGoogleSync(req, res, `api:${role}`);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/google/slots') {
    const role = requireApiRole('dispatcher');
    if (!role) return;
    await handleGoogleSlots(req, res, `api:${role}`);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/backups') {
    const role = requireApiRole('owner');
    if (!role) return;
    await handleListBackups(req, res);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/backups/run') {
    const role = requireApiRole('owner');
    if (!role) return;
    await handleRunBackup(req, res, `api:${role}`);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/backups/restore') {
    const role = requireApiRole('owner');
    if (!role) return;
    await handleRestoreBackup(req, res, `api:${role}`);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/board/state') {
    const role = requireApiRole('readonly');
    if (!role) return;
    const since = url.searchParams.get('since');
    sendJson(res, 200, toWorkspacePayload(filterBoardSince(state.board, since)));
    return;
  }

  if (method === 'POST' && url.pathname === '/api/board/schema') {
    const role = requireApiRole('owner');
    if (!role) return;
    await handleBoardSchemaUpdate(req, res, `api:${role}`);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/board/audit') {
    const role = requireApiRole('dispatcher');
    if (!role) return;
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 50)));
    sendJson(res, 200, { ok: true, items: state.audit.slice(0, limit) });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/telegram/pending') {
    const role = requireApiRole('dispatcher');
    if (!role) return;
    sendJson(res, 200, { ok: true, items: Object.values(state.pending) });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/telegram/conversations') {
    const role = requireApiRole('dispatcher');
    if (!role) return;
    sendJson(res, 200, { ok: true, items: Object.values(state.conversations ?? {}) });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/telegram/webhook') {
    await handleTelegramWebhook(req, res);
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Telegram MVP server listening on http://${HOST}:${PORT}`);
  console.log(`Import guardrail threshold: ${Math.round(IMPORT_GUARDRAIL_CONFIDENCE * 100)}%`);
  console.log(
    `LLM strategy: ${LLM_STRATEGY} | repairPass=${LLM_REPAIR_PASS} | repairMinConfidence=${Math.round(
      LLM_REPAIR_MIN_CONFIDENCE * 100,
    )}%`,
  );
  if (!BOT_TOKEN) {
    console.warn('TELEGRAM_BOT_TOKEN is not set. Webhook will parse requests but cannot reply in Telegram.');
  }
  if (LLM_ENABLED && !OPENAI_API_KEY) {
    console.warn('LLM_ENABLED is true but OPENAI_API_KEY is missing. Falling back to rule parser.');
  }
  console.log(
    `Automation: autoGoogleSyncOnTelegramImport=${AUTO_GOOGLE_SYNC_ON_TELEGRAM_IMPORT} | dailyGoogleResyncEnabled=${GOOGLE_DAILY_RESYNC_ENABLED}`,
  );
  if (SECURITY_AUTH_ENABLED) {
    console.log(
      `Security: authEnabled=true | ownerKeys=${SECURITY_OWNER_KEYS.length} | dispatcherKeys=${SECURITY_DISPATCHER_KEYS.length} | readonlyKeys=${SECURITY_READONLY_KEYS.length}`,
    );
  }
  console.log(
    `Backups: enabled=${BACKUP_ENABLED} | dailyEnabled=${BACKUP_DAILY_ENABLED} | dailyHourUtc=${BACKUP_DAILY_HOUR_UTC} | retentionDays=${BACKUP_RETENTION_DAYS}`,
  );
  setInterval(() => {
    cleanupRateLimitBuckets();
    void maybeRunDailyBackup();
    void maybeRunDailyGoogleResync();
  }, GOOGLE_DAILY_RESYNC_CHECK_INTERVAL_MS);
  void maybeRunDailyBackup();
  void maybeRunDailyGoogleResync();
});
