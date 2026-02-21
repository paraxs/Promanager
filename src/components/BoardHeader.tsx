import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArchiveRestore,
  CalendarCheck2,
  Download,
  FileText,
  LayoutGrid,
  MoreHorizontal,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { APP_CONFIG } from '../config/appConfig';
import { DEFAULT_DATABASE_SCHEMA, RUNTIME_PROPERTY_TYPES } from '../config/database';
import { DispatchCenter } from './DispatchCenter';
import { OperationsRadar } from './OperationsRadar';
import { useBoardStore } from '../store/boardStore';
import { type BoardViewMode, type CardQuickFilter, useUiStore } from '../store/uiStore';
import { STATUS_ORDER, type CardRecordValue, type PropertyDefinition } from '../types/board';
import { cardMatchesUiFilters } from '../utils/cardFilters';
import { getBusinessDaysLabel } from '../utils/scheduling';
import { cx } from '../utils/cx';

const UI_SETTINGS_EVENT = 'promanager-ui-settings-updated';
const TELEGRAM_SYNC_CURSOR_KEY = 'promanager-telegram-sync-cursor';
const API_KEY_STORAGE_KEY = 'promanager-api-key';

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const formatIsoDateForDisplay = (value: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[3]}.${match[2]}.${match[1]}`;
};

const loadUiSettingsFromStorage = () => {
  const defaultLabel = APP_CONFIG.board.dashboardLabel;
  const defaultSubtitle = APP_CONFIG.board.subtitle;

  try {
    const savedLabel = localStorage.getItem(APP_CONFIG.persistence.dashboardLabelStorageKey)?.trim();
    const savedSubtitle = localStorage.getItem(APP_CONFIG.persistence.dashboardSubtitleStorageKey)?.trim();

    return {
      dashboardLabel: savedLabel || defaultLabel,
      dashboardSubtitle: savedSubtitle || defaultSubtitle,
    };
  } catch {
    return {
      dashboardLabel: defaultLabel,
      dashboardSubtitle: defaultSubtitle,
    };
  }
};

const saveUiSettingsToStorage = (dashboardLabel: string, dashboardSubtitle: string): void => {
  try {
    localStorage.setItem(APP_CONFIG.persistence.dashboardLabelStorageKey, dashboardLabel);
    localStorage.setItem(APP_CONFIG.persistence.dashboardSubtitleStorageKey, dashboardSubtitle);
  } catch {
    // Ignore storage issues.
  }

  window.dispatchEvent(new CustomEvent(UI_SETTINGS_EVENT));
};

const readTelegramSyncCursor = (): string | null => {
  try {
    const raw = localStorage.getItem(TELEGRAM_SYNC_CURSOR_KEY)?.trim();
    if (!raw) return null;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
};

const writeTelegramSyncCursor = (iso: string): void => {
  try {
    localStorage.setItem(TELEGRAM_SYNC_CURSOR_KEY, iso);
  } catch {
    // Ignore storage issues.
  }
};

const clearTelegramSyncCursor = (): void => {
  try {
    localStorage.removeItem(TELEGRAM_SYNC_CURSOR_KEY);
  } catch {
    // Ignore storage issues.
  }
};

const readApiKeyFromStorage = (): string => {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
};

const writeApiKeyToStorage = (apiKey: string): void => {
  try {
    if (apiKey.trim()) {
      localStorage.setItem(API_KEY_STORAGE_KEY, apiKey.trim());
    } else {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
  } catch {
    // Ignore storage issues.
  }
};

const buildApiAuthHeaders = (): Record<string, string> => {
  const apiKey = readApiKeyFromStorage();
  if (!apiKey) return {};
  return {
    'x-promanager-api-key': apiKey,
  };
};

const createEmptyPresetTelemetry = (): PresetTelemetry => ({
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
  weeklyDispatchRanking: {
    since: '',
    totalDecisions: 0,
    bestPresetId: null,
    items: [],
  },
  eventsCount: 0,
});

const syncDatabaseSchemaToServer = async (database: unknown): Promise<void> => {
  const response = await fetch('/api/board/schema', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ database }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Schema-Sync fehlgeschlagen (${response.status}): ${detail}`);
  }
};

type DiagnosticsSnapshot = {
  ok: boolean;
  service?: string;
  serverTime?: string;
  pendingProposals?: number;
  openConversations?: number;
  telegramProcessedUpdateCount?: number;
  telegramProcessedMessageCount?: number;
  telegram?: {
    botConfigured?: boolean;
    processedUpdateCount?: number;
    processedMessageCount?: number;
    webhook?: {
      configured?: boolean;
      ok?: boolean;
      url?: string;
      pendingUpdateCount?: number;
      lastErrorMessage?: string;
      error?: string;
    };
  };
  llm?: {
    enabled?: boolean;
    configured?: boolean;
    model?: string;
    strategy?: string;
  };
  google?: {
    enabled?: boolean;
    configured?: boolean;
    calendarConfigured?: boolean;
    calendarId?: string;
    accessRole?: string;
    canWrite?: boolean;
    error?: string;
    sharedWith?: string[];
    sync?: {
      lastRunAt?: string;
      lastMode?: string;
      ok?: boolean | null;
      summary?: string;
      error?: string;
      counts?: {
        created?: number;
        updated?: number;
        deleted?: number;
        unchanged?: number;
        relinked?: number;
        recreated?: number;
        deduplicated?: number;
        errors?: number;
      };
    };
  };
  automation?: {
    autoGoogleSyncOnTelegramImport?: boolean;
    dailyGoogleResyncEnabled?: boolean;
  };
  security?: {
    authEnabled?: boolean;
    corsOrigins?: string[];
    rateLimit?: {
      enabled?: boolean;
      windowMs?: number;
      max?: number;
      webhookMax?: number;
      activeBuckets?: number;
    };
  };
  backup?: {
    enabled?: boolean;
    dailyEnabled?: boolean;
    dailyHourUtc?: number;
    retentionDays?: number;
    lastBackupAt?: string;
    lastBackupFile?: string;
    lastDailyBackupDate?: string;
    lastRestoreAt?: string;
    lastRestoreFile?: string;
  };
  alerts?: Array<{
    severity?: 'critical' | 'warn' | 'info';
    code?: string;
    message?: string;
  }>;
  presetTelemetry?: PresetTelemetry;
};

type RuntimeConfigSnapshot = {
  llm: {
    enabled: boolean;
    model: string;
    strategy: 'dominant' | 'hybrid' | 'fallback';
    minConfidence: number;
    repairPass: boolean;
    repairMinConfidence: number;
    repairMaxTries: number;
    timeoutMs: number;
    baseUrl: string;
    hasApiKey: boolean;
  };
  google: {
    enabled: boolean;
    hasClientId: boolean;
    hasClientSecret: boolean;
    hasRefreshToken: boolean;
    calendarId: string;
    calendarName: string;
    timezone: string;
    eventDurationMin: number;
    slotWindowDays: number;
    shareRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
    sharedWith: string[];
  };
  agent: {
    enabled: boolean;
    requiredFields: string;
    criticalFields: string;
    propertyPriority: string;
    followupIncludeRequired: boolean;
  };
  automation: {
    autoGoogleSyncOnTelegramImport?: boolean;
    dailyGoogleResyncEnabled?: boolean;
  };
  dispatch: {
    enabled?: boolean;
    minScore?: number;
    maxDailySlots?: number;
    requiredFields?: string;
    scoreWeights?: string;
  };
  guardrail: {
    importConfidence: number;
  };
  security?: {
    authEnabled?: boolean;
    ownerKeyCount?: number;
    dispatcherKeyCount?: number;
    readonlyKeyCount?: number;
    corsOrigins?: string[];
    rateLimitEnabled?: boolean;
    rateLimitWindowMs?: number;
    rateLimitMax?: number;
    rateLimitWebhookMax?: number;
  };
  backup?: {
    enabled?: boolean;
    retentionDays?: number;
    dailyEnabled?: boolean;
    dailyHourUtc?: number;
  };
};

type RuntimeConfigForm = {
  llmEnabled: boolean;
  llmModel: string;
  llmStrategy: 'dominant' | 'hybrid' | 'fallback';
  llmMinConfidence: string;
  llmRepairPass: boolean;
  llmRepairMinConfidence: string;
  llmRepairMaxTries: string;
  llmTimeoutMs: string;
  llmBaseUrl: string;
  llmApiKey: string;
  googleEnabled: boolean;
  googleClientId: string;
  googleClientSecret: string;
  googleRefreshToken: string;
  googleCalendarId: string;
  googleCalendarName: string;
  googleTimezone: string;
  googleEventDurationMin: string;
  googleSlotWindowDays: string;
  googleShareRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
  googleSharedWith: string;
  agentEnabled: boolean;
  agentRequiredFields: string;
  agentCriticalFields: string;
  agentPropertyPriority: string;
  agentFollowupIncludeRequired: boolean;
  autoGoogleSyncOnTelegramImport: boolean;
  dailyGoogleResyncEnabled: boolean;
  dispatchEnabled: boolean;
  dispatchMinScore: string;
  dispatchMaxDailySlots: string;
  dispatchRequiredFields: string;
  dispatchScoreWeights: string;
  guardrailImportConfidence: string;
  securityAuthEnabled: boolean;
  securityOwnerKeys: string;
  securityDispatcherKeys: string;
  securityReadonlyKeys: string;
  securityCorsOrigins: string;
  securityRateLimitEnabled: boolean;
  securityRateLimitWindowMs: string;
  securityRateLimitMax: string;
  securityRateLimitWebhookMax: string;
  backupEnabled: boolean;
  backupRetentionDays: string;
  backupDailyEnabled: boolean;
  backupDailyHourUtc: string;
};

type RuntimeConfigApiPayload = {
  config: {
    llm: Record<string, unknown>;
    google: Record<string, unknown>;
    agent: Record<string, unknown>;
    automation: Record<string, unknown>;
    dispatch: Record<string, unknown>;
    guardrail: Record<string, unknown>;
    security: Record<string, unknown>;
    backup: Record<string, unknown>;
  };
};

type DispatchOutcome = 'approved' | 'dismissed';

type DispatchPreset = {
  id: 'konservativ' | 'ausgeglichen' | 'aggressiv';
  label: string;
  description: string;
  patch: Pick<
    RuntimeConfigForm,
    'dispatchEnabled' | 'dispatchMinScore' | 'dispatchMaxDailySlots' | 'dispatchRequiredFields' | 'dispatchScoreWeights'
  >;
};

type AgentPreset = {
  id: 'fokus' | 'ausgeglichen' | 'voice';
  label: string;
  description: string;
  patch: Pick<
    RuntimeConfigForm,
    'agentEnabled' | 'agentRequiredFields' | 'agentCriticalFields' | 'agentPropertyPriority' | 'agentFollowupIncludeRequired'
  >;
};

type PresetTelemetry = {
  updatedAt: string;
  dispatch: {
    appliedByPreset: Record<string, number>;
    approvedByPreset: Record<string, number>;
    dismissedByPreset: Record<string, number>;
    lastAppliedPresetId: string | null;
  };
  agent: {
    appliedByPreset: Record<string, number>;
    lastAppliedPresetId: string | null;
  };
  weeklyDispatchRanking: {
    since: string;
    totalDecisions: number;
    bestPresetId: string | null;
    items: Array<{
      presetId: string;
      approved: number;
      dismissed: number;
      totalDecisions: number;
      approvalRate: number;
    }>;
  };
  eventsCount: number;
};

const createDefaultRuntimeConfigForm = (): RuntimeConfigForm => ({
  llmEnabled: false,
  llmModel: 'gpt-4.1-mini',
  llmStrategy: 'dominant',
  llmMinConfidence: '0.70',
  llmRepairPass: true,
  llmRepairMinConfidence: '0.82',
  llmRepairMaxTries: '2',
  llmTimeoutMs: '12000',
  llmBaseUrl: 'https://api.openai.com/v1',
  llmApiKey: '',
  googleEnabled: false,
  googleClientId: '',
  googleClientSecret: '',
  googleRefreshToken: '',
  googleCalendarId: '',
  googleCalendarName: 'Projekte Firma 2026',
  googleTimezone: 'Europe/Vienna',
  googleEventDurationMin: '90',
  googleSlotWindowDays: '14',
  googleShareRole: 'writer',
  googleSharedWith: '',
  agentEnabled: true,
  agentRequiredFields: 'date,address,uhrzeit,source',
  agentCriticalFields: 'date,address,uhrzeit,source',
  agentPropertyPriority: 'date:100,uhrzeit:97,source:94,address:90,location:78,title:80',
  agentFollowupIncludeRequired: false,
  autoGoogleSyncOnTelegramImport: false,
  dailyGoogleResyncEnabled: false,
  dispatchEnabled: true,
  dispatchMinScore: '55',
  dispatchMaxDailySlots: '3',
  dispatchRequiredFields: 'date,address,source',
  dispatchScoreWeights:
    'eingang:80,warteschlange:65,termin_ohne_datum:85,ueberfaellig:95,missing_date:18,missing_address:12,missing_phone:8,missing_source:6,no_comment:6,age_per_day:2,age_max:24',
  guardrailImportConfidence: '0.65',
  securityAuthEnabled: false,
  securityOwnerKeys: '',
  securityDispatcherKeys: '',
  securityReadonlyKeys: '',
  securityCorsOrigins: '*',
  securityRateLimitEnabled: true,
  securityRateLimitWindowMs: '60000',
  securityRateLimitMax: '300',
  securityRateLimitWebhookMax: '200',
  backupEnabled: true,
  backupRetentionDays: '21',
  backupDailyEnabled: true,
  backupDailyHourUtc: '2',
});

const DISPATCH_PRESETS: DispatchPreset[] = [
  {
    id: 'konservativ',
    label: 'Konservativ',
    description: 'Hoehere Schwellwerte, weniger Tages-Slots, strengere Pflichtfelder.',
    patch: {
      dispatchEnabled: true,
      dispatchMinScore: '80',
      dispatchMaxDailySlots: '2',
      dispatchRequiredFields: 'date,address,phone,source',
      dispatchScoreWeights:
        'eingang:65,warteschlange:50,termin_ohne_datum:80,ueberfaellig:100,missing_date:30,missing_address:24,missing_phone:20,missing_source:16,no_comment:12,age_per_day:3,age_max:30',
    },
  },
  {
    id: 'ausgeglichen',
    label: 'Ausgeglichen',
    description: 'Standardprofil fuer den Alltag.',
    patch: {
      dispatchEnabled: true,
      dispatchMinScore: '55',
      dispatchMaxDailySlots: '3',
      dispatchRequiredFields: 'date,address,source',
      dispatchScoreWeights:
        'eingang:80,warteschlange:65,termin_ohne_datum:85,ueberfaellig:95,missing_date:18,missing_address:12,missing_phone:8,missing_source:6,no_comment:6,age_per_day:2,age_max:24',
    },
  },
  {
    id: 'aggressiv',
    label: 'Aggressiv',
    description: 'Niedriger Schwellwert, mehr Tages-Slots, schnellere Terminierung.',
    patch: {
      dispatchEnabled: true,
      dispatchMinScore: '40',
      dispatchMaxDailySlots: '6',
      dispatchRequiredFields: 'date,address,source',
      dispatchScoreWeights:
        'eingang:95,warteschlange:80,termin_ohne_datum:95,ueberfaellig:110,missing_date:12,missing_address:8,missing_phone:5,missing_source:5,no_comment:4,age_per_day:1,age_max:15',
    },
  },
];

const AGENT_PRESETS: AgentPreset[] = [
  {
    id: 'fokus',
    label: 'Fokus (kritisch)',
    description: 'Nur Kernfelder als kritische Rueckfragen, strikter Prioritaetsfokus.',
    patch: {
      agentEnabled: true,
      agentRequiredFields: 'date,address,uhrzeit,source',
      agentCriticalFields: 'date,address,uhrzeit,source',
      agentPropertyPriority: 'date:100,uhrzeit:97,source:95,address:92,phone:80,location:70,title:65',
      agentFollowupIncludeRequired: false,
    },
  },
  {
    id: 'ausgeglichen',
    label: 'Ausgeglichen',
    description: 'Solides Standardprofil fuer Alltag und stabile Rueckfragen.',
    patch: {
      agentEnabled: true,
      agentRequiredFields: 'date,address,uhrzeit,source',
      agentCriticalFields: 'date,address,uhrzeit,source',
      agentPropertyPriority: 'date:100,uhrzeit:97,source:94,address:90,location:78,title:80',
      agentFollowupIncludeRequired: false,
    },
  },
  {
    id: 'voice',
    label: 'Voice-First',
    description: 'Optimiert fuer freie Spracheingaben, fragt wichtige Felder priorisiert nach.',
    patch: {
      agentEnabled: true,
      agentRequiredFields: 'date,address,source',
      agentCriticalFields: 'date,source,address,uhrzeit',
      agentPropertyPriority: 'date:100,source:98,address:94,uhrzeit:92,phone:84,location:82,title:70',
      agentFollowupIncludeRequired: true,
    },
  },
];

const toRuntimeConfigForm = (config: RuntimeConfigSnapshot, fallback?: RuntimeConfigForm): RuntimeConfigForm => ({
  llmEnabled: Boolean(config.llm?.enabled),
  llmModel: config.llm?.model ?? 'gpt-4.1-mini',
  llmStrategy: (config.llm?.strategy ?? 'dominant') as RuntimeConfigForm['llmStrategy'],
  llmMinConfidence: String(config.llm?.minConfidence ?? 0.7),
  llmRepairPass: Boolean(config.llm?.repairPass),
  llmRepairMinConfidence: String(config.llm?.repairMinConfidence ?? 0.82),
  llmRepairMaxTries: String(config.llm?.repairMaxTries ?? 2),
  llmTimeoutMs: String(config.llm?.timeoutMs ?? 12000),
  llmBaseUrl: config.llm?.baseUrl ?? 'https://api.openai.com/v1',
  llmApiKey: '',
  googleEnabled: Boolean(config.google?.enabled),
  googleClientId: '',
  googleClientSecret: '',
  googleRefreshToken: '',
  googleCalendarId: config.google?.calendarId ?? '',
  googleCalendarName: config.google?.calendarName ?? 'Projekte Firma 2026',
  googleTimezone: config.google?.timezone ?? 'Europe/Vienna',
  googleEventDurationMin: String(config.google?.eventDurationMin ?? 90),
  googleSlotWindowDays: String(config.google?.slotWindowDays ?? 14),
  googleShareRole: (config.google?.shareRole ?? 'writer') as RuntimeConfigForm['googleShareRole'],
  googleSharedWith: Array.isArray(config.google?.sharedWith) ? config.google.sharedWith.join(', ') : '',
  agentEnabled: Boolean(config.agent?.enabled),
  agentRequiredFields: config.agent?.requiredFields ?? '',
  agentCriticalFields: config.agent?.criticalFields ?? '',
  agentPropertyPriority: config.agent?.propertyPriority ?? '',
  agentFollowupIncludeRequired: Boolean(config.agent?.followupIncludeRequired),
  autoGoogleSyncOnTelegramImport:
    config.automation?.autoGoogleSyncOnTelegramImport ?? fallback?.autoGoogleSyncOnTelegramImport ?? false,
  dailyGoogleResyncEnabled: config.automation?.dailyGoogleResyncEnabled ?? fallback?.dailyGoogleResyncEnabled ?? false,
  dispatchEnabled: config.dispatch?.enabled ?? fallback?.dispatchEnabled ?? true,
  dispatchMinScore: String(config.dispatch?.minScore ?? fallback?.dispatchMinScore ?? 55),
  dispatchMaxDailySlots: String(config.dispatch?.maxDailySlots ?? fallback?.dispatchMaxDailySlots ?? 3),
  dispatchRequiredFields: config.dispatch?.requiredFields ?? fallback?.dispatchRequiredFields ?? 'date,address,source',
  dispatchScoreWeights:
    config.dispatch?.scoreWeights ??
    fallback?.dispatchScoreWeights ??
    'eingang:80,warteschlange:65,termin_ohne_datum:85,ueberfaellig:95,missing_date:18,missing_address:12,missing_phone:8,missing_source:6,no_comment:6,age_per_day:2,age_max:24',
  guardrailImportConfidence: String(config.guardrail?.importConfidence ?? 0.65),
  securityAuthEnabled: Boolean(config.security?.authEnabled ?? fallback?.securityAuthEnabled ?? false),
  securityOwnerKeys: fallback?.securityOwnerKeys ?? '',
  securityDispatcherKeys: fallback?.securityDispatcherKeys ?? '',
  securityReadonlyKeys: fallback?.securityReadonlyKeys ?? '',
  securityCorsOrigins: Array.isArray(config.security?.corsOrigins)
    ? config.security?.corsOrigins.join(', ')
    : fallback?.securityCorsOrigins ?? '*',
  securityRateLimitEnabled: config.security?.rateLimitEnabled ?? fallback?.securityRateLimitEnabled ?? true,
  securityRateLimitWindowMs: String(config.security?.rateLimitWindowMs ?? fallback?.securityRateLimitWindowMs ?? 60000),
  securityRateLimitMax: String(config.security?.rateLimitMax ?? fallback?.securityRateLimitMax ?? 300),
  securityRateLimitWebhookMax: String(
    config.security?.rateLimitWebhookMax ?? fallback?.securityRateLimitWebhookMax ?? 200,
  ),
  backupEnabled: config.backup?.enabled ?? fallback?.backupEnabled ?? true,
  backupRetentionDays: String(config.backup?.retentionDays ?? fallback?.backupRetentionDays ?? 21),
  backupDailyEnabled: config.backup?.dailyEnabled ?? fallback?.backupDailyEnabled ?? true,
  backupDailyHourUtc: String(config.backup?.dailyHourUtc ?? fallback?.backupDailyHourUtc ?? 2),
});

const parseJsonSafely = (text: string): unknown => {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  const raw = await response.text();
  const parsed = parseJsonSafely(raw);
  if (parsed && typeof parsed === 'object') {
    const error =
      typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : typeof (parsed as { message?: unknown }).message === 'string'
          ? (parsed as { message: string }).message
          : '';
    if (error) return `${fallback} (${response.status}): ${error}`;
  }
  if (raw.trim()) return `${fallback} (${response.status}): ${raw}`;
  return `${fallback} (${response.status})`;
};

const postJson = async <T,>(url: string, payload: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildApiAuthHeaders() },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Anfrage fehlgeschlagen'));
  }

  const raw = await response.text();
  const parsed = parseJsonSafely(raw);
  if (!parsed) {
    throw new Error(`Leere Antwort von ${url}.`);
  }
  return parsed as T;
};

const getJson = async <T,>(url: string, fallbackError = 'Abruf fehlgeschlagen'): Promise<T> => {
  const response = await fetch(url, {
    headers: buildApiAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, fallbackError));
  }

  const raw = await response.text();
  const parsed = parseJsonSafely(raw);
  if (!parsed) {
    throw new Error(`Leere Antwort von ${url}.`);
  }
  return parsed as T;
};

const QUICK_FILTER_OPTIONS: Array<{ id: CardQuickFilter; label: string }> = [
  { id: 'all', label: 'Alle' },
  { id: 'overdue', label: 'Ueberfaellig' },
  { id: 'today_tomorrow', label: 'Heute/Morgen' },
  { id: 'missing_core', label: 'Fehlende Basisdaten' },
];

const VIEW_MODE_OPTIONS: Array<{ id: BoardViewMode; label: string; icon: typeof LayoutGrid }> = [
  { id: 'cards', label: 'Kartenansicht', icon: LayoutGrid },
  { id: 'table', label: 'Tabellenansicht', icon: Table2 },
];

const transliterateForSlug = (value: string): string =>
  value
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .replaceAll('Ä', 'ae')
    .replaceAll('Ö', 'oe')
    .replaceAll('Ü', 'ue');

const slugify = (value: string): string =>
  transliterateForSlug(value)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

const parseOptionsInput = (value: string | null): string[] | undefined => {
  if (!value) return undefined;
  const normalized = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!normalized.length) return undefined;
  return Array.from(new Set(normalized));
};

const isLikelySourceProperty = (property: PropertyDefinition): boolean => {
  const id = property.id.toLowerCase();
  const name = property.name.toLowerCase();
  return (
    id === 'source' ||
    id.includes('quelle') ||
    id.includes('kanal') ||
    id.includes('herkunft') ||
    id.includes('eingang') ||
    name === 'source' ||
    name.includes('quelle') ||
    name.includes('kanal') ||
    name.includes('herkunft') ||
    name.includes('eingang')
  );
};

const promptPropertyDraft = (existing?: PropertyDefinition) => {
  const name = window.prompt('Feldname', existing?.name ?? '');
  if (!name) return null;

  const typePrompt = window.prompt(
    `Feldtyp (${RUNTIME_PROPERTY_TYPES.join('/')})`,
    existing?.type ?? RUNTIME_PROPERTY_TYPES[0],
  );
  if (!typePrompt) return null;
  const type = typePrompt.trim().toLowerCase();
  if (!(RUNTIME_PROPERTY_TYPES as readonly string[]).includes(type)) {
    alert(`Ungueltiger Typ. Erlaubt: ${RUNTIME_PROPERTY_TYPES.join(', ')}`);
    return null;
  }

  let options: string[] | undefined;
  if (type === 'select') {
    const optionsInput = window.prompt(
      'Optionen (durch Komma trennen)',
      existing?.options?.join(', ') ?? '',
    );
    options = parseOptionsInput(optionsInput);
  }

  const id = existing?.id ?? slugify(name);
  if (!id) {
    alert('Feld-ID konnte nicht erzeugt werden.');
    return null;
  }

  return {
    id,
    name: name.trim(),
    type: type as Extract<PropertyDefinition['type'], 'text' | 'select' | 'date'>,
    options,
  };
};

const printHtmlViaIframe = (html: string): void => {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.setAttribute('aria-hidden', 'true');
  document.body.appendChild(frame);

  const cleanup = () => {
    window.setTimeout(() => {
      frame.remove();
    }, 250);
  };

  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) {
      cleanup();
      return;
    }

    win.focus();
    win.print();
    win.onafterprint = cleanup;
  };

  const doc = frame.contentDocument;
  if (!doc) {
    cleanup();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();
};

export function BoardHeader() {
  const exportState = useBoardStore((s) => s.exportState);
  const importState = useBoardStore((s) => s.importState);
  const importTelegramState = useBoardStore((s) => s.importTelegramState);
  const dedupeBoard = useBoardStore((s) => s.dedupeBoard);
  const cardsById = useBoardStore((s) => s.cardsById);
  const columns = useBoardStore((s) => s.columns);
  const database = useBoardStore((s) => s.database);
  const updateCardValue = useBoardStore((s) => s.updateCardValue);
  const addPropertyDefinition = useBoardStore((s) => s.addPropertyDefinition);
  const updatePropertyDefinition = useBoardStore((s) => s.updatePropertyDefinition);
  const removePropertyDefinition = useBoardStore((s) => s.removePropertyDefinition);
  const addGlobalSource = useBoardStore((s) => s.addGlobalSource);
  const renameGlobalSource = useBoardStore((s) => s.renameGlobalSource);
  const removeGlobalSource = useBoardStore((s) => s.removeGlobalSource);
  const restoreCard = useBoardStore((s) => s.restoreCard);
  const archiveCompletedCards = useBoardStore((s) => s.archiveCompletedCards);
  const deleteCard = useBoardStore((s) => s.deleteCard);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const quickFilter = useUiStore((s) => s.quickFilter);
  const viewMode = useUiStore((s) => s.viewMode);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const setQuickFilter = useUiStore((s) => s.setQuickFilter);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const clearUiFilters = useUiStore((s) => s.clearFilters);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const lastSchemaSyncSignatureRef = useRef('');
  const schemaSyncTimerRef = useRef<number | null>(null);

  const [dashboardLabel, setDashboardLabel] = useState<string>(APP_CONFIG.board.dashboardLabel);
  const [dashboardSubtitle, setDashboardSubtitle] = useState<string>(APP_CONFIG.board.subtitle);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [isPropertyEditorOpen, setIsPropertyEditorOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isRadarOpen, setIsRadarOpen] = useState(false);
  const [isDispatchOpen, setIsDispatchOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState('');
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigSnapshot | null>(null);
  const [runtimeConfigForm, setRuntimeConfigForm] = useState<RuntimeConfigForm>(createDefaultRuntimeConfigForm());
  const [runtimeConfigLoading, setRuntimeConfigLoading] = useState(false);
  const [runtimeConfigSaving, setRuntimeConfigSaving] = useState(false);
  const [runtimeConfigError, setRuntimeConfigError] = useState('');
  const [apiSessionKeyInput, setApiSessionKeyInput] = useState<string>(() => readApiKeyFromStorage());
  const [googleSyncBusy, setGoogleSyncBusy] = useState(false);
  const [googleSetupBusy, setGoogleSetupBusy] = useState(false);
  const [presetTelemetry, setPresetTelemetry] = useState<PresetTelemetry>(() => createEmptyPresetTelemetry());

  const businessDaysLabel = getBusinessDaysLabel();
  const scheduleLabel = `${APP_CONFIG.scheduling.workdayStart}-${APP_CONFIG.scheduling.workdayEnd} Uhr`;
  const serverOnline = Boolean(diagnostics?.ok);
  const webhookReady = Boolean(diagnostics?.telegram?.webhook?.ok && diagnostics?.telegram?.webhook?.url);
  const llmReady = diagnostics?.llm?.enabled ? Boolean(diagnostics?.llm?.configured) : null;
  const calendarReady = diagnostics?.google?.enabled
    ? Boolean(diagnostics?.google?.configured && diagnostics?.google?.calendarConfigured && diagnostics?.google?.canWrite)
    : null;

  const archivedCards = useMemo(
    () =>
      Object.values(cardsById)
        .filter((card) => !!card.hiddenAt)
        .sort((a, b) => (b.hiddenAt ?? '').localeCompare(a.hiddenAt ?? '')),
    [cardsById],
  );

  const openCards = useMemo(
    () => Object.values(cardsById).filter((card) => !card.hiddenAt),
    [cardsById],
  );

  const filteredCardCount = useMemo(
    () => openCards.filter((card) => cardMatchesUiFilters(card, searchQuery, quickFilter)).length,
    [openCards, searchQuery, quickFilter],
  );

  const managedSources = useMemo(() => {
    const values = new Set<string>(APP_CONFIG.workflow.sources);

    for (const property of database.properties ?? []) {
      if (property.type !== 'select' || !isLikelySourceProperty(property)) continue;
      for (const option of property.options ?? []) {
        const trimmed = option.trim();
        if (trimmed) values.add(trimmed);
      }
    }

    for (const card of Object.values(cardsById)) {
      for (const source of card.sources ?? []) {
        if (typeof source !== 'string') continue;
        const trimmed = source.trim();
        if (trimmed) values.add(trimmed);
      }
    }

    return Array.from(values).sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
  }, [cardsById, database.properties]);

  const schemaSyncSignature = useMemo(() => JSON.stringify(database), [database]);

  useEffect(() => {
    const syncFromStorage = () => {
      const settings = loadUiSettingsFromStorage();
      setDashboardLabel(settings.dashboardLabel);
      setDashboardSubtitle(settings.dashboardSubtitle);
    };

    syncFromStorage();
    window.addEventListener(UI_SETTINGS_EVENT, syncFromStorage);

    return () => window.removeEventListener(UI_SETTINGS_EVENT, syncFromStorage);
  }, []);

  useEffect(() => {
    if (lastSchemaSyncSignatureRef.current === schemaSyncSignature) return;

    if (schemaSyncTimerRef.current !== null) {
      window.clearTimeout(schemaSyncTimerRef.current);
    }

    schemaSyncTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          await syncDatabaseSchemaToServer(database);
          lastSchemaSyncSignatureRef.current = schemaSyncSignature;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Schema-Sync fehlgeschlagen.';
          console.warn(message);
        }
      })();
    }, 300);

    return () => {
      if (schemaSyncTimerRef.current !== null) {
        window.clearTimeout(schemaSyncTimerRef.current);
        schemaSyncTimerRef.current = null;
      }
    };
  }, [database, schemaSyncSignature]);

  const refreshDiagnostics = useCallback(async (silent = false) => {
    if (!silent) setDiagnosticsLoading(true);
    setDiagnosticsError('');
    try {
      const payload = await getJson<DiagnosticsSnapshot>('/api/health', 'Diagnose-Abruf fehlgeschlagen');
      setDiagnostics(payload);
      if (payload.presetTelemetry) {
        setPresetTelemetry(payload.presetTelemetry);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Diagnose-Abruf fehlgeschlagen.';
      setDiagnosticsError(message);
    } finally {
      if (!silent) setDiagnosticsLoading(false);
    }
  }, []);

  const refreshRuntimeConfig = useCallback(async (silent = false) => {
    if (!silent) setRuntimeConfigLoading(true);
    setRuntimeConfigError('');
    try {
      const payload = await getJson<{ ok: boolean; config: RuntimeConfigSnapshot }>(
        '/api/config',
        'Konfiguration konnte nicht geladen werden',
      );
      setRuntimeConfig(payload.config);
      setRuntimeConfigForm((prev) => toRuntimeConfigForm(payload.config, prev));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Konfiguration konnte nicht geladen werden.';
      setRuntimeConfigError(message);
    } finally {
      if (!silent) setRuntimeConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDiagnostics(true);
    void refreshRuntimeConfig(true);
    const interval = window.setInterval(() => {
      void refreshDiagnostics(true);
    }, 45_000);
    return () => window.clearInterval(interval);
  }, [refreshDiagnostics, refreshRuntimeConfig]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.open) return;
      if (!(event.target instanceof Node)) return;
      if (menuRef.current.contains(event.target)) return;
      menuRef.current.open = false;
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!menuRef.current?.open) return;
      menuRef.current.open = false;
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const closeMenu = () => {
    if (menuRef.current) menuRef.current.open = false;
  };

  const handleEditDashboardLabel = () => {
    const nextLabel = window.prompt('Dashboard-Titel', dashboardLabel)?.trim();
    if (!nextLabel) return;

    const nextSubtitleRaw = window.prompt('Dashboard-Untertitel', dashboardSubtitle);
    const nextSubtitle = (nextSubtitleRaw ?? dashboardSubtitle).trim() || APP_CONFIG.board.subtitle;

    setDashboardLabel(nextLabel);
    setDashboardSubtitle(nextSubtitle);
    saveUiSettingsToStorage(nextLabel, nextSubtitle);
  };

  const handleAddProperty = () => {
    const draft = promptPropertyDraft();
    if (!draft) return;
    addPropertyDefinition(draft);
  };

  const handleEditProperty = (property: PropertyDefinition) => {
    const draft = promptPropertyDraft(property);
    if (!draft) return;
    updatePropertyDefinition(draft);
  };

  const handleDeleteProperty = (property: PropertyDefinition) => {
    if (property.system || property.required) return;
    const ok = window.confirm(`Feld "${property.name}" loeschen?`);
    if (!ok) return;
    removePropertyDefinition(property.id);
  };

  const handleAddSource = () => {
    const input = window.prompt('Neue Quelle (z. B. Signal, Fax, Portal):', '');
    if (!input) return;
    const source = input.trim();
    if (!source) return;
    addGlobalSource(source);
  };

  const handleRemoveSource = (source: string) => {
    const ok = window.confirm(
      `Quelle "${source}" entfernen?\nSie wird aus allen Karten entfernt (Fallback auf ${APP_CONFIG.defaults.fallbackSource}, wenn noetig).`,
    );
    if (!ok) return;
    removeGlobalSource(source);
  };

  const handleRenameSource = (source: string) => {
    const input = window.prompt(`Quelle umbenennen: ${source}`, source);
    if (input === null) return;
    const nextSource = input.trim();
    if (!nextSource) return;
    renameGlobalSource(source, nextSource);
  };

  const handleArchiveCompleted = () => {
    const archived = archiveCompletedCards();
    if (archived > 0) {
      alert(`${archived} erledigte Karte(n) archiviert.`);
    } else {
      alert('Keine erledigten Karten zum Archivieren gefunden.');
    }
  };

  const applyGoogleSyncUpdates = (updates: unknown): number => {
    if (!Array.isArray(updates)) return 0;
    let applied = 0;

    for (const entry of updates) {
      if (!entry || typeof entry !== 'object') continue;
      const cardId = typeof (entry as { cardId?: unknown }).cardId === 'string' ? (entry as { cardId: string }).cardId : '';
      if (!cardId) continue;

      const values = (entry as { values?: unknown }).values;
      if (!values || typeof values !== 'object') continue;

      for (const [propertyId, propertyValue] of Object.entries(values as Record<string, unknown>)) {
        updateCardValue(cardId, propertyId, propertyValue as CardRecordValue);
        applied += 1;
      }
    }

    return applied;
  };

  const handleTelegramSync = async () => {
    try {
      const removedBeforeSync = dedupeBoard();
      await syncDatabaseSchemaToServer(database);
      const nowIso = new Date().toISOString();
      const cursor = readTelegramSyncCursor();
      const hasLocalCards = Object.keys(cardsById).length > 0;

      if (!cursor && hasLocalCards) {
        writeTelegramSyncCursor(nowIso);
        if (removedBeforeSync > 0) {
          alert(
            `Telegram Sync initialisiert. ${removedBeforeSync} lokale Dublette(n) bereinigt. Ab jetzt werden nur neue Telegram-Importe synchronisiert.`,
          );
        } else {
          alert('Telegram Sync initialisiert. Ab jetzt werden nur neue Telegram-Importe synchronisiert.');
        }
        return;
      }

      const query = cursor ? `?since=${encodeURIComponent(cursor)}` : '';
      const response = await fetch(`/api/board/state${query}`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Telegram-Sync fehlgeschlagen'));
      }

      const payload = await response.text();
      const added = importTelegramState(payload);
      writeTelegramSyncCursor(nowIso);

      if (added > 0 && removedBeforeSync > 0) {
        alert(`${added} Telegram-Karte(n) synchronisiert. ${removedBeforeSync} Dublette(n) bereinigt.`);
      } else if (added > 0) {
        alert(`${added} Telegram-Karte(n) synchronisiert.`);
      } else if (removedBeforeSync > 0) {
        alert(`Keine neuen Telegram-Karten gefunden. ${removedBeforeSync} Dublette(n) bereinigt.`);
      } else {
        alert('Keine neuen Telegram-Karten gefunden.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Telegram-Sync fehlgeschlagen.';
      alert(message);
    }
  };

  const handleGoogleSetup = async () => {
    setGoogleSetupBusy(true);
    try {
      const payload = await postJson<{
        ok: boolean;
        calendarId?: string;
        accessRole?: string;
        canWrite?: boolean;
        role?: string;
        sharedWith?: string[];
      }>('/api/google/setup', {});

      await refreshDiagnostics(true);
      const sharedTo = Array.isArray(payload.sharedWith) ? payload.sharedWith.length : 0;
      const role = payload.accessRole ?? payload.role ?? '-';
      alert(
        `Google Kalender bereit.\nKalender-ID: ${payload.calendarId ?? '-'}\nRolle: ${role}\nSchreibzugriff: ${
          payload.canWrite ? 'Ja' : 'Nein'
        }\nFreigaben: ${sharedTo}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google-Setup fehlgeschlagen.';
      alert(message);
    } finally {
      setGoogleSetupBusy(false);
    }
  };

  const handleGoogleSync = async (forceResync = false) => {
    setGoogleSyncBusy(true);
    try {
      await syncDatabaseSchemaToServer(database);
      const payload = await postJson<{
        ok: boolean;
        mode?: 'sync' | 'resync';
        created?: number;
        updated?: number;
        deleted?: number;
        unchanged?: number;
        relinked?: number;
        recreated?: number;
        deduplicated?: number;
        errors?: Array<{ cardId?: string; message?: string }>;
        warnings?: Array<{ cardId?: string; message?: string }>;
        updates?: unknown[];
      }>('/api/google/sync', {
        board: {
          cardsById,
          columns,
          database,
        },
        forceResync,
      });

      const appliedValueUpdates = applyGoogleSyncUpdates(payload.updates);
      await refreshDiagnostics(true);

      const errors = Array.isArray(payload.errors) ? payload.errors : [];
      const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
      const firstError = errors[0]?.message;
      const firstWarning = warnings[0]?.message;
      const summary = [
        `Google ${payload.mode === 'resync' ? 'Resync' : 'Sync'} abgeschlossen.`,
        `Neu: ${payload.created ?? 0}, Aktualisiert: ${payload.updated ?? 0}, Entfernt: ${payload.deleted ?? 0}`,
        `Unveraendert: ${payload.unchanged ?? 0}, Relinked: ${payload.relinked ?? 0}, Recreated: ${payload.recreated ?? 0}`,
        `Bereinigte Dubletten: ${payload.deduplicated ?? 0}`,
        `Wert-Updates lokal angewendet: ${appliedValueUpdates}`,
        `Warnungen: ${warnings.length}`,
        `Fehler: ${errors.length}`,
        firstWarning ? `Erste Warnung: ${firstWarning}` : '',
        firstError ? `Erster Fehler: ${firstError}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      alert(summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google-Sync fehlgeschlagen.';
      alert(message);
    } finally {
      setGoogleSyncBusy(false);
    }
  };

  const updateRuntimeConfigField = <K extends keyof RuntimeConfigForm>(key: K, value: RuntimeConfigForm[K]) => {
    setRuntimeConfigForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveApiSessionKey = () => {
    writeApiKeyToStorage(apiSessionKeyInput);
    setApiSessionKeyInput(readApiKeyFromStorage());
    alert(apiSessionKeyInput.trim() ? 'API Session Key gespeichert.' : 'API Session Key entfernt.');
  };

  const buildRuntimeConfigPayload = (form: RuntimeConfigForm): RuntimeConfigApiPayload => {
    const securityCorsOrigins = form.securityCorsOrigins
      .split(/[;,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    const payload: RuntimeConfigApiPayload = {
      config: {
        llm: {
          enabled: form.llmEnabled,
          model: form.llmModel.trim(),
          strategy: form.llmStrategy,
          minConfidence: Number(form.llmMinConfidence),
          repairPass: form.llmRepairPass,
          repairMinConfidence: Number(form.llmRepairMinConfidence),
          repairMaxTries: Number(form.llmRepairMaxTries),
          timeoutMs: Number(form.llmTimeoutMs),
          baseUrl: form.llmBaseUrl.trim(),
        },
        google: {
          enabled: form.googleEnabled,
          calendarId: form.googleCalendarId.trim(),
          calendarName: form.googleCalendarName.trim(),
          timezone: form.googleTimezone.trim(),
          eventDurationMin: Number(form.googleEventDurationMin),
          slotWindowDays: Number(form.googleSlotWindowDays),
          shareRole: form.googleShareRole,
          sharedWith: form.googleSharedWith
            .split(/[;,]/)
            .map((entry) => entry.trim())
            .filter(Boolean),
        },
        agent: {
          enabled: form.agentEnabled,
          requiredFields: form.agentRequiredFields.trim(),
          criticalFields: form.agentCriticalFields.trim(),
          propertyPriority: form.agentPropertyPriority.trim(),
          followupIncludeRequired: form.agentFollowupIncludeRequired,
        },
        automation: {
          autoGoogleSyncOnTelegramImport: form.autoGoogleSyncOnTelegramImport,
          dailyGoogleResyncEnabled: form.dailyGoogleResyncEnabled,
        },
        dispatch: {
          enabled: form.dispatchEnabled,
          minScore: Number(form.dispatchMinScore),
          maxDailySlots: Number(form.dispatchMaxDailySlots),
          requiredFields: form.dispatchRequiredFields.trim(),
          scoreWeights: form.dispatchScoreWeights.trim(),
        },
        guardrail: {
          importConfidence: Number(form.guardrailImportConfidence),
        },
        security: {
          authEnabled: form.securityAuthEnabled,
          corsOrigins: securityCorsOrigins.length ? securityCorsOrigins : ['*'],
          rateLimitEnabled: form.securityRateLimitEnabled,
          rateLimitWindowMs: Number(form.securityRateLimitWindowMs),
          rateLimitMax: Number(form.securityRateLimitMax),
          rateLimitWebhookMax: Number(form.securityRateLimitWebhookMax),
        },
        backup: {
          enabled: form.backupEnabled,
          retentionDays: Number(form.backupRetentionDays),
          dailyEnabled: form.backupDailyEnabled,
          dailyHourUtc: Number(form.backupDailyHourUtc),
        },
      },
    };

    if (form.llmApiKey.trim()) {
      payload.config.llm.apiKey = form.llmApiKey.trim();
    }
    if (form.googleClientId.trim()) {
      payload.config.google.clientId = form.googleClientId.trim();
    }
    if (form.googleClientSecret.trim()) {
      payload.config.google.clientSecret = form.googleClientSecret.trim();
    }
    if (form.googleRefreshToken.trim()) {
      payload.config.google.refreshToken = form.googleRefreshToken.trim();
    }
    if (form.securityOwnerKeys.trim()) {
      payload.config.security.ownerKeys = form.securityOwnerKeys
        .split(/[;,]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
    if (form.securityDispatcherKeys.trim()) {
      payload.config.security.dispatcherKeys = form.securityDispatcherKeys
        .split(/[;,]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
    if (form.securityReadonlyKeys.trim()) {
      payload.config.security.readonlyKeys = form.securityReadonlyKeys
        .split(/[;,]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
    }

    return payload;
  };

  const handleSaveRuntimeConfig = async (
    nextForm?: RuntimeConfigForm,
    successMessage = 'Technik-Konfiguration gespeichert.',
  ): Promise<boolean> => {
    setRuntimeConfigSaving(true);
    setRuntimeConfigError('');

    try {
      const form = nextForm ?? runtimeConfigForm;
      const payload = buildRuntimeConfigPayload(form);

      const result = await postJson<{
        ok: boolean;
        config: RuntimeConfigSnapshot;
        health?: DiagnosticsSnapshot;
      }>('/api/config', payload);

      setRuntimeConfig(result.config);
      setRuntimeConfigForm({
        ...toRuntimeConfigForm(result.config, form),
        llmApiKey: '',
        googleClientId: '',
        googleClientSecret: '',
        googleRefreshToken: '',
        securityOwnerKeys: '',
        securityDispatcherKeys: '',
        securityReadonlyKeys: '',
      });

      if (!result.config.automation) {
        alert(
          'Hinweis: Server liefert noch keine Automation-Felder. Bitte `npm run server:dev` neu starten und erneut speichern.',
        );
      }

      if (result.health) {
        setDiagnostics(result.health);
      } else {
        await refreshDiagnostics(true);
      }

      alert(successMessage);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Konfiguration speichern fehlgeschlagen.';
      setRuntimeConfigError(message);
      alert(message);
      return false;
    } finally {
      setRuntimeConfigSaving(false);
    }
  };

  const postPresetTelemetryEvent = useCallback(
    async (channel: 'dispatch' | 'agent', action: 'applied' | 'approved' | 'dismissed', presetId: string) => {
      try {
        const result = await postJson<{ ok: boolean; telemetry?: PresetTelemetry }>('/api/telemetry/presets/event', {
          channel,
          action,
          presetId,
        });
        if (result.telemetry) {
          setPresetTelemetry(result.telemetry);
        } else {
          await refreshDiagnostics(true);
        }
      } catch (error) {
        console.warn('Preset telemetry event failed:', error);
      }
    },
    [refreshDiagnostics],
  );

  const handleResetPresetTelemetry = async () => {
    const ok = window.confirm('Preset-Telemetrie wirklich zuruecksetzen?');
    if (!ok) return;
    try {
      const result = await postJson<{ ok: boolean; telemetry?: PresetTelemetry }>(
        '/api/telemetry/presets/reset',
        {},
      );
      setPresetTelemetry(result.telemetry ?? createEmptyPresetTelemetry());
      await refreshDiagnostics(true);
      alert('Preset-Telemetrie wurde zurueckgesetzt.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Preset-Telemetrie konnte nicht zurueckgesetzt werden.';
      alert(message);
    }
  };

  const handleExportPresetTelemetry = async () => {
    try {
      const payload = await getJson<{ ok: boolean; exportedAt?: string; telemetry?: unknown }>(
        '/api/telemetry/presets/export',
        'Preset-Telemetrie Export fehlgeschlagen',
      );
      const exportedAt = payload.exportedAt ?? new Date().toISOString();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `preset-telemetrie-${exportedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Preset-Telemetrie Export fehlgeschlagen.';
      alert(message);
    }
  };

  const handleRunServerBackup = async () => {
    try {
      await postJson<{ ok: boolean; maintenance?: DiagnosticsSnapshot['backup'] }>('/api/backups/run', {
        reason: 'manual-ui',
      });
      await refreshDiagnostics(true);
      alert('Server-Backup erfolgreich erstellt.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Server-Backup fehlgeschlagen.';
      alert(message);
    }
  };

  const isDispatchPresetActive = (preset: DispatchPreset): boolean =>
    runtimeConfigForm.dispatchEnabled === preset.patch.dispatchEnabled &&
    runtimeConfigForm.dispatchMinScore.trim() === preset.patch.dispatchMinScore &&
    runtimeConfigForm.dispatchMaxDailySlots.trim() === preset.patch.dispatchMaxDailySlots &&
    runtimeConfigForm.dispatchRequiredFields.trim() === preset.patch.dispatchRequiredFields &&
    runtimeConfigForm.dispatchScoreWeights.trim() === preset.patch.dispatchScoreWeights;

  const isAgentPresetActive = (preset: AgentPreset): boolean =>
    runtimeConfigForm.agentEnabled === preset.patch.agentEnabled &&
    runtimeConfigForm.agentRequiredFields.trim() === preset.patch.agentRequiredFields &&
    runtimeConfigForm.agentCriticalFields.trim() === preset.patch.agentCriticalFields &&
    runtimeConfigForm.agentPropertyPriority.trim() === preset.patch.agentPropertyPriority &&
    runtimeConfigForm.agentFollowupIncludeRequired === preset.patch.agentFollowupIncludeRequired;

  const handleApplyDispatchPreset = async (preset: DispatchPreset) => {
    const nextForm: RuntimeConfigForm = {
      ...runtimeConfigForm,
      ...preset.patch,
    };
    setRuntimeConfigForm(nextForm);
    const ok = await handleSaveRuntimeConfig(nextForm, `Dispatch-Preset "${preset.label}" uebernommen und gespeichert.`);
    if (!ok) return;
    await postPresetTelemetryEvent('dispatch', 'applied', preset.id);
  };

  const handleApplyAgentPreset = async (preset: AgentPreset) => {
    const nextForm: RuntimeConfigForm = {
      ...runtimeConfigForm,
      ...preset.patch,
    };
    setRuntimeConfigForm(nextForm);
    const ok = await handleSaveRuntimeConfig(nextForm, `Agent-Preset "${preset.label}" uebernommen und gespeichert.`);
    if (!ok) return;
    await postPresetTelemetryEvent('agent', 'applied', preset.id);
  };

  const resolveCurrentDispatchPresetKey = (): string => {
    const activePreset = DISPATCH_PRESETS.find((preset) => isDispatchPresetActive(preset));
    if (activePreset) return activePreset.id;
    return presetTelemetry.dispatch.lastAppliedPresetId ?? 'custom';
  };

  const handleDispatchProposalOutcome = (outcome: DispatchOutcome) => {
    const presetKey = resolveCurrentDispatchPresetKey();
    void postPresetTelemetryEvent('dispatch', outcome === 'approved' ? 'approved' : 'dismissed', presetKey);
  };

  const dispatchTelemetryRows = useMemo(() => {
    const keys = new Set<string>([
      ...DISPATCH_PRESETS.map((preset) => preset.id),
      ...Object.keys(presetTelemetry.dispatch.appliedByPreset),
      ...Object.keys(presetTelemetry.dispatch.approvedByPreset),
      ...Object.keys(presetTelemetry.dispatch.dismissedByPreset),
    ]);
    return Array.from(keys)
      .map((key) => {
        const applied = presetTelemetry.dispatch.appliedByPreset[key] ?? 0;
        const approved = presetTelemetry.dispatch.approvedByPreset[key] ?? 0;
        const dismissed = presetTelemetry.dispatch.dismissedByPreset[key] ?? 0;
        const totalDecisions = approved + dismissed;
        const approvalRate = totalDecisions > 0 ? Math.round((approved / totalDecisions) * 100) : 0;
        const label = DISPATCH_PRESETS.find((preset) => preset.id === key)?.label ?? (key === 'custom' ? 'Custom' : key);
        return { key, label, applied, approved, dismissed, totalDecisions, approvalRate };
      })
      .sort((a, b) => b.totalDecisions - a.totalDecisions || b.applied - a.applied || a.label.localeCompare(b.label, 'de'));
  }, [presetTelemetry.dispatch.appliedByPreset, presetTelemetry.dispatch.approvedByPreset, presetTelemetry.dispatch.dismissedByPreset]);

  const agentTelemetryRows = useMemo(() => {
    const keys = new Set<string>([
      ...AGENT_PRESETS.map((preset) => preset.id),
      ...Object.keys(presetTelemetry.agent.appliedByPreset),
    ]);
    return Array.from(keys)
      .map((key) => ({
        key,
        label: AGENT_PRESETS.find((preset) => preset.id === key)?.label ?? key,
        applied: presetTelemetry.agent.appliedByPreset[key] ?? 0,
      }))
      .sort((a, b) => b.applied - a.applied || a.label.localeCompare(b.label, 'de'));
  }, [presetTelemetry.agent.appliedByPreset]);

  const weeklyDispatchRankingRows = useMemo(
    () =>
      (presetTelemetry.weeklyDispatchRanking.items ?? [])
        .map((item) => ({
          ...item,
          label: DISPATCH_PRESETS.find((preset) => preset.id === item.presetId)?.label ?? item.presetId,
        }))
        .sort(
          (a, b) =>
            b.approvalRate - a.approvalRate ||
            b.totalDecisions - a.totalDecisions ||
            a.label.localeCompare(b.label, 'de'),
        ),
    [presetTelemetry.weeklyDispatchRanking.items],
  );

  const handleExportJson = () => {
    const data = exportState();
    const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `kanban-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();

    URL.revokeObjectURL(url);
  };

  const handlePdfExport = () => {
    const uiSettings = loadUiSettingsFromStorage();

    const statusSections = STATUS_ORDER.map((status) => {
      const ids = columns[status] ?? [];
      const cards = ids
        .map((id) => cardsById[id])
        .filter((card): card is NonNullable<(typeof cardsById)[string]> => !!card && !card.hiddenAt);

      const cardHtml = cards.length
        ? cards
            .map((card) => {
              const commentsHtml = card.comments.length
                ? `<ul>${[...card.comments]
                    .reverse()
                    .map(
                      (comment) =>
                        `<li><strong>${escapeHtml(comment.user)}</strong> (${new Date(comment.createdAt).toLocaleString('de-AT')}): ${escapeHtml(comment.text)}</li>`,
                    )
                    .join('')}</ul>`
                : '<p class="muted">Keine Kommentare</p>';

              const historyHtml = card.history.length
                ? `<ul>${[...card.history]
                    .reverse()
                    .map(
                      (entry) =>
                        `<li>${escapeHtml(entry.from)} -> ${escapeHtml(entry.to)} (${new Date(entry.movedAt).toLocaleString('de-AT')}, ${escapeHtml(entry.movedBy)})</li>`,
                    )
                    .join('')}</ul>`
                : '<p class="muted">Kein Status-Verlauf</p>';

              return `
                <article class="card">
                  <h3>${escapeHtml(card.title)}</h3>
                  <table>
                    <tr><th>Status</th><td>${escapeHtml(card.status)}</td></tr>
                    <tr><th>Quelle</th><td>${escapeHtml(card.sources.join(', ') || '-')}</td></tr>
                    <tr><th>Datum</th><td>${escapeHtml(card.date ? formatIsoDateForDisplay(card.date) : '-')}</td></tr>
                    <tr><th>Adresse</th><td>${escapeHtml(card.address ?? '-')}</td></tr>
                    <tr><th>Ort</th><td>${escapeHtml(card.location ?? '-')}</td></tr>
                    <tr><th>Telefon</th><td>${escapeHtml(card.phone ?? '-')}</td></tr>
                  </table>
                  <h4>Kommentare</h4>
                  ${commentsHtml}
                  <h4>Status-Verlauf</h4>
                  ${historyHtml}
                </article>
              `;
            })
            .join('')
        : '<p class="muted">Keine Karten in dieser Spalte.</p>';

      return `
        <section>
          <h2>${escapeHtml(status)}</h2>
          ${cardHtml}
        </section>
      `;
    }).join('');

    const archivedHtml = archivedCards.length
      ? `<section><h2>Archiv</h2>${archivedCards
          .map(
            (card) =>
              `<p><strong>${escapeHtml(card.title)}</strong> - archiviert am ${escapeHtml(
                card.hiddenAt ? new Date(card.hiddenAt).toLocaleString('de-AT') : '-',
              )}</p>`,
          )
          .join('')}</section>`
      : '';

    const html = `
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(uiSettings.dashboardLabel)} - PDF Export</title>
  <style>
    @page { size: A4; margin: 12mm; }
    body { font-family: Arial, sans-serif; color: #0f172a; font-size: 11pt; line-height: 1.35; }
    h1 { margin: 0 0 2mm 0; font-size: 18pt; }
    .subtitle { margin: 0 0 6mm 0; color: #475569; font-size: 10pt; }
    h2 { margin: 6mm 0 3mm; font-size: 13pt; border-bottom: 1px solid #cbd5e1; padding-bottom: 1mm; }
    h3 { margin: 0 0 2mm 0; font-size: 11pt; }
    h4 { margin: 3mm 0 1.5mm 0; font-size: 10pt; color: #1e293b; }
    .card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 3mm; margin-bottom: 3mm; page-break-inside: avoid; }
    .muted { color: #64748b; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 2mm; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 1.2mm 1.5mm; text-align: left; vertical-align: top; }
    th { width: 28mm; color: #475569; font-weight: 600; }
    ul { margin: 0; padding-left: 5mm; }
    li { margin-bottom: 1mm; }
  </style>
</head>
<body>
  <h1>${escapeHtml(uiSettings.dashboardLabel)}</h1>
  <p class="subtitle">${escapeHtml(uiSettings.dashboardSubtitle)} | Export: ${escapeHtml(new Date().toLocaleString('de-AT'))}</p>
  ${statusSections}
  ${archivedHtml}
</body>
</html>`;

    const popup = window.open('about:blank', '_blank');
    if (popup) {
      popup.document.open();
      popup.document.write(html);
      popup.document.close();
      popup.focus();

      setTimeout(() => {
        popup.print();
      }, 250);
      return;
    }

    // Popup blocked: fallback without new window.
    printHtmlViaIframe(html);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      importState(text);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Import fehlgeschlagen.';
      alert(msg);
    } finally {
      event.target.value = '';
    }
  };

  const handleResetTelegramSync = () => {
    clearTelegramSyncCursor();
    alert('Telegram Sync-Cursor wurde zurueckgesetzt.');
  };

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-4xl">{dashboardLabel}</h1>
            <p className="mt-1 text-xs text-gray-500 sm:text-sm">{dashboardSubtitle}</p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
              <span className="rounded-full border border-gray-200 bg-white px-2 py-1">Arbeitstage: {businessDaysLabel}</span>
              <span className="rounded-full border border-gray-200 bg-white px-2 py-1">Arbeitszeit: {scheduleLabel}</span>
              <span className="rounded-full border border-gray-200 bg-white px-2 py-1">
                Reminder: {APP_CONFIG.scheduling.reminderHoursBefore}h vorher
              </span>
              <span
                className={`rounded-full border px-2 py-1 ${
                  serverOnline ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'
                }`}
              >
                Server: {serverOnline ? 'online' : 'offline'}
              </span>
              <span
                className={`rounded-full border px-2 py-1 ${
                  webhookReady ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}
              >
                Webhook: {webhookReady ? 'verbunden' : 'pruefen'}
              </span>
              <span
                className={`rounded-full border px-2 py-1 ${
                  llmReady === null
                    ? 'border-gray-200 bg-gray-50 text-gray-600'
                    : llmReady
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}
              >
                LLM: {llmReady === null ? 'aus' : llmReady ? 'bereit' : 'nicht konfiguriert'}
              </span>
              <span
                className={`rounded-full border px-2 py-1 ${
                  calendarReady === null
                    ? 'border-gray-200 bg-gray-50 text-gray-600'
                    : calendarReady
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}
              >
                Kalender: {calendarReady === null ? 'aus' : calendarReady ? 'bereit' : 'nicht bereit'}
              </span>
            </div>

            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative block w-full sm:max-w-sm">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Suche in Titel, Adresse, Telefon, Kommentar..."
                  className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-3 text-sm text-gray-700 placeholder:text-gray-400"
                />
              </label>

              <div className="flex flex-wrap items-center gap-1.5">
                {QUICK_FILTER_OPTIONS.map((option) => {
                  const active = quickFilter === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setQuickFilter(option.id)}
                      className={cx(
                        'rounded-full border px-2.5 py-1 text-xs font-medium',
                        active
                          ? 'border-sky-300 bg-sky-50 text-sky-700'
                          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={clearUiFilters}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Zuruecksetzen
                </button>
              </div>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-gray-500">Ansicht:</span>
              {VIEW_MODE_OPTIONS.map((option) => {
                const active = viewMode === option.id;
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setViewMode(option.id)}
                    className={cx(
                      'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
                      active
                        ? 'border-sky-300 bg-sky-50 text-sky-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {option.label}
                  </button>
                );
              })}
            </div>

            <p className="mt-1 text-xs text-gray-500">
              Sichtbare Karten: {filteredCardCount} / {openCards.length}
            </p>
          </div>

          <div className="flex w-full items-center justify-end sm:w-auto">
            <details ref={menuRef} className="relative">
              <summary className="list-none cursor-pointer rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                <span className="inline-flex items-center gap-2">
                  <MoreHorizontal className="h-4 w-4" />
                  Menue
                </span>
              </summary>

              <div className="absolute right-0 z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    handleEditDashboardLabel();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <PencilLine className="h-4 w-4" />
                  Beschriftung
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    setIsPropertyEditorOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Settings2 className="h-4 w-4" />
                  Eigenschaften
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    setIsConfigOpen(true);
                    void refreshRuntimeConfig();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Settings2 className="h-4 w-4" />
                  Technik-Konfiguration
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    setIsRadarOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Sparkles className="h-4 w-4" />
                  Operations Radar
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    setIsDispatchOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Dispatch Center
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    setIsArchiveOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <ArchiveRestore className="h-4 w-4" />
                  Archiv ({archivedCards.length})
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    handleArchiveCompleted();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <ArchiveRestore className="h-4 w-4" />
                  Erledigte archivieren
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    handleTelegramSync();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  Telegram Sync
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    handleResetTelegramSync();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  Telegram Sync reset
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    void handleGoogleSetup();
                  }}
                  disabled={googleSetupBusy}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <CalendarCheck2 className="h-4 w-4" />
                  {googleSetupBusy ? 'Google Setup laeuft...' : 'Google Kalender Setup'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    void handleGoogleSync();
                  }}
                  disabled={googleSyncBusy}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw className="h-4 w-4" />
                  {googleSyncBusy ? 'Google Sync laeuft...' : 'Google Sync jetzt'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    const ok = window.confirm(
                      'Google Resync repariert Event-Zuordnungen (Relink/Recreate) und bereinigt Dubletten. Jetzt starten?',
                    );
                    if (!ok) return;
                    void handleGoogleSync(true);
                  }}
                  disabled={googleSyncBusy}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw className="h-4 w-4" />
                  {googleSyncBusy ? 'Google Resync laeuft...' : 'Google Resync (hart)'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    setIsDiagnosticsOpen(true);
                    void refreshDiagnostics();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Activity className="h-4 w-4" />
                  Diagnose
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    handleExportJson();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Download className="h-4 w-4" />
                  Export JSON
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    handlePdfExport();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <FileText className="h-4 w-4" />
                  Export PDF (A4)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    handleImportClick();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Upload className="h-4 w-4" />
                  Import JSON
                </button>
              </div>
            </details>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImportFile}
            />
          </div>
        </div>
      </header>

      <OperationsRadar open={isRadarOpen} onClose={() => setIsRadarOpen(false)} />
      <DispatchCenter
        open={isDispatchOpen}
        onClose={() => setIsDispatchOpen(false)}
        onRunGoogleSync={() => handleGoogleSync()}
        dispatchConfig={runtimeConfig?.dispatch}
        onProposalOutcome={handleDispatchProposalOutcome}
      />

      {isArchiveOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4" onClick={() => setIsArchiveOpen(false)}>
          <div
            className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-2xl sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900">Archivierte Karten</h2>
              <button
                type="button"
                onClick={() => setIsArchiveOpen(false)}
                className="rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
              >
                Schliessen
              </button>
            </div>

            {archivedCards.length === 0 ? (
              <p className="text-sm text-gray-500">Keine archivierten Karten.</p>
            ) : (
              <div className="space-y-2">
                {archivedCards.map((card) => (
                  <div key={card.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 p-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{card.title}</p>
                      <p className="text-xs text-gray-500">
                        Archiviert: {card.hiddenAt ? new Date(card.hiddenAt).toLocaleString('de-AT') : '-'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => restoreCard(card.id)}
                        className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <ArchiveRestore className="h-3.5 w-3.5" />
                        Wiederherstellen
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const ok = window.confirm('Karte endgueltig loeschen?');
                          if (!ok) return;
                          deleteCard(card.id);
                        }}
                        className="inline-flex min-h-9 items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Loeschen
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {isDiagnosticsOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4" onClick={() => setIsDiagnosticsOpen(false)}>
          <div
            className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-2xl sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900">System-Diagnose</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refreshDiagnostics()}
                  className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Aktualisieren
                </button>
                <button
                  type="button"
                  onClick={() => setIsDiagnosticsOpen(false)}
                  className="rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Schliessen
                </button>
              </div>
            </div>

            {diagnosticsLoading ? <p className="text-sm text-gray-500">Diagnose wird geladen...</p> : null}
            {diagnosticsError ? <p className="mb-3 rounded-md bg-rose-50 p-2 text-sm text-rose-700">{diagnosticsError}</p> : null}

            {diagnostics ? (
              <div className="space-y-3 text-sm text-gray-700">
                <section className="rounded-lg border border-gray-200 p-3">
                  <p className="font-semibold text-gray-900">Server</p>
                  <p>Service: {diagnostics.service ?? '-'}</p>
                  <p>Zeit: {diagnostics.serverTime ? new Date(diagnostics.serverTime).toLocaleString('de-AT') : '-'}</p>
                  <p>Pending Proposals: {diagnostics.pendingProposals ?? 0}</p>
                  <p>Offene Follow-ups: {diagnostics.openConversations ?? 0}</p>
                </section>

                {Array.isArray(diagnostics.alerts) && diagnostics.alerts.length > 0 ? (
                  <section className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="font-semibold text-gray-900">Warnungen</p>
                    <div className="mt-1 space-y-1 text-xs">
                      {diagnostics.alerts.map((alert, index) => (
                        <p
                          key={`${alert.code ?? 'alert'}-${index}`}
                          className={cx(
                            alert.severity === 'critical' ? 'text-rose-700' : alert.severity === 'warn' ? 'text-amber-800' : 'text-gray-700',
                          )}
                        >
                          [{(alert.severity ?? 'info').toUpperCase()}] {alert.message ?? '-'}
                        </p>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="rounded-lg border border-gray-200 p-3">
                  <p className="font-semibold text-gray-900">Telegram</p>
                  <p>Bot konfiguriert: {diagnostics.telegram?.botConfigured ? 'Ja' : 'Nein'}</p>
                  <p>Webhook gesetzt: {diagnostics.telegram?.webhook?.configured ? 'Ja' : 'Nein'}</p>
                  <p>Webhook OK: {diagnostics.telegram?.webhook?.ok ? 'Ja' : 'Nein'}</p>
                  <p>Pending Updates: {diagnostics.telegram?.webhook?.pendingUpdateCount ?? 0}</p>
                  <p>
                    Dedupe-Cache: Updates{' '}
                    {diagnostics.telegram?.processedUpdateCount ?? diagnostics.telegramProcessedUpdateCount ?? 0} | Messages{' '}
                    {diagnostics.telegram?.processedMessageCount ?? diagnostics.telegramProcessedMessageCount ?? 0}
                  </p>
                  <p className="break-all">URL: {diagnostics.telegram?.webhook?.url || '-'}</p>
                  {diagnostics.telegram?.webhook?.lastErrorMessage ? (
                    <p className="text-amber-700">Letzter Telegram-Fehler: {diagnostics.telegram.webhook.lastErrorMessage}</p>
                  ) : null}
                  {diagnostics.telegram?.webhook?.error ? (
                    <p className="text-rose-700">Webhook-Fehler: {diagnostics.telegram.webhook.error}</p>
                  ) : null}
                </section>

                <section className="rounded-lg border border-gray-200 p-3">
                  <p className="font-semibold text-gray-900">LLM</p>
                  <p>Aktiv: {diagnostics.llm?.enabled ? 'Ja' : 'Nein'}</p>
                  <p>Konfiguriert: {diagnostics.llm?.configured ? 'Ja' : 'Nein'}</p>
                  <p>Modell: {diagnostics.llm?.model ?? '-'}</p>
                  <p>Strategie: {diagnostics.llm?.strategy ?? '-'}</p>
                </section>

                <section className="rounded-lg border border-gray-200 p-3">
                  <p className="font-semibold text-gray-900">Google Kalender</p>
                  <p>Aktiv: {diagnostics.google?.enabled ? 'Ja' : 'Nein'}</p>
                  <p>Konfiguriert: {diagnostics.google?.configured ? 'Ja' : 'Nein'}</p>
                  <p>Kalender vorhanden: {diagnostics.google?.calendarConfigured ? 'Ja' : 'Nein'}</p>
                  <p>Schreibzugriff: {diagnostics.google?.canWrite ? 'Ja' : 'Nein'}</p>
                  <p>Rolle: {diagnostics.google?.accessRole || '-'}</p>
                  <p className="break-all">Kalender-ID: {diagnostics.google?.calendarId || '-'}</p>
                  <p>Freigegeben an: {diagnostics.google?.sharedWith?.length ? diagnostics.google.sharedWith.join(', ') : '-'}</p>
                  <p>
                    Auto-Sync Telegram -&gt; Google: {diagnostics.automation?.autoGoogleSyncOnTelegramImport ? 'Ja' : 'Nein'}
                  </p>
                  <p>
                    Daily Hintergrund-Resync: {diagnostics.automation?.dailyGoogleResyncEnabled ? 'Ja' : 'Nein'}
                  </p>
                  <p>
                    Letzter Sync: {diagnostics.google?.sync?.lastRunAt ? new Date(diagnostics.google.sync.lastRunAt).toLocaleString('de-AT') : '-'}
                  </p>
                  <p>
                    Sync Modus: {diagnostics.google?.sync?.lastMode || '-'} | Ergebnis:{' '}
                    {diagnostics.google?.sync?.ok === null || diagnostics.google?.sync?.ok === undefined
                      ? '-'
                      : diagnostics.google.sync.ok
                        ? 'OK'
                        : 'Fehler'}
                  </p>
                  <p>
                    Counts: C {diagnostics.google?.sync?.counts?.created ?? 0} | U {diagnostics.google?.sync?.counts?.updated ?? 0} | D{' '}
                    {diagnostics.google?.sync?.counts?.deleted ?? 0} | R {diagnostics.google?.sync?.counts?.relinked ?? 0}
                  </p>
                  {diagnostics.google?.sync?.summary ? <p className="text-xs text-gray-500">{diagnostics.google.sync.summary}</p> : null}
                  {diagnostics.google?.sync?.error ? <p className="text-rose-700">Letzter Sync-Fehler: {diagnostics.google.sync.error}</p> : null}
                  {diagnostics.google?.error ? <p className="text-rose-700">Kalender-Fehler: {diagnostics.google.error}</p> : null}
                </section>

                <section className="rounded-lg border border-gray-200 p-3">
                  <p className="font-semibold text-gray-900">Security</p>
                  <p>Auth aktiv: {diagnostics.security?.authEnabled ? 'Ja' : 'Nein'}</p>
                  <p>
                    CORS Origins:{' '}
                    {Array.isArray(diagnostics.security?.corsOrigins) && diagnostics.security?.corsOrigins.length
                      ? diagnostics.security?.corsOrigins.join(', ')
                      : '-'}
                  </p>
                  <p>
                    Rate Limit: {diagnostics.security?.rateLimit?.enabled ? 'Ja' : 'Nein'} | Fenster:{' '}
                    {diagnostics.security?.rateLimit?.windowMs ?? '-'} ms | Max:{' '}
                    {diagnostics.security?.rateLimit?.max ?? '-'} | Webhook Max:{' '}
                    {diagnostics.security?.rateLimit?.webhookMax ?? '-'}
                  </p>
                  <p>Aktive Buckets: {diagnostics.security?.rateLimit?.activeBuckets ?? 0}</p>
                </section>

                <section className="rounded-lg border border-gray-200 p-3">
                  <p className="font-semibold text-gray-900">Backups</p>
                  <p>Aktiv: {diagnostics.backup?.enabled ? 'Ja' : 'Nein'}</p>
                  <p>Tages-Backup aktiv: {diagnostics.backup?.dailyEnabled ? 'Ja' : 'Nein'}</p>
                  <p>
                    Zeit (UTC): {diagnostics.backup?.dailyHourUtc ?? '-'} | Aufbewahrung:{' '}
                    {diagnostics.backup?.retentionDays ?? '-'} Tage
                  </p>
                  <p>
                    Letztes Backup:{' '}
                    {diagnostics.backup?.lastBackupAt ? new Date(diagnostics.backup.lastBackupAt).toLocaleString('de-AT') : '-'}
                  </p>
                  <p className="break-all">Backup-Datei: {diagnostics.backup?.lastBackupFile || '-'}</p>
                  <p>
                    Letzter Restore:{' '}
                    {diagnostics.backup?.lastRestoreAt ? new Date(diagnostics.backup.lastRestoreAt).toLocaleString('de-AT') : '-'}
                  </p>
                  <p className="break-all">Restore-Datei: {diagnostics.backup?.lastRestoreFile || '-'}</p>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => void handleRunServerBackup()}
                      className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Backup jetzt
                    </button>
                  </div>
                </section>

                <section className="rounded-lg border border-gray-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-gray-900">Preset-Telemetrie</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void refreshDiagnostics()}
                        className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Telemetrie neu laden
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleExportPresetTelemetry()}
                        className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Export JSON
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleResetPresetTelemetry()}
                        className="inline-flex min-h-9 items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Reset
                      </button>
                    </div>
                  </div>
                  <p>
                    Letztes Update:{' '}
                    {presetTelemetry.updatedAt ? new Date(presetTelemetry.updatedAt).toLocaleString('de-AT') : '-'}
                  </p>
                  <p>Events gesamt: {presetTelemetry.eventsCount ?? 0}</p>

                  <div className="mt-2 space-y-1">
                    <p className="font-medium text-gray-900">Dispatch (Wirkung)</p>
                    {dispatchTelemetryRows.length === 0 ? (
                      <p className="text-xs text-gray-500">Noch keine Dispatch-Telemetrie vorhanden.</p>
                    ) : (
                      dispatchTelemetryRows.map((row) => (
                        <p key={`dispatch-${row.key}`}>
                          {row.label}: angewendet {row.applied} | Freigegeben {row.approved} | Verworfen {row.dismissed} | Quote {row.approvalRate}%
                        </p>
                      ))
                    )}
                  </div>

                  <div className="mt-3 space-y-1">
                    <p className="font-medium text-gray-900">Agent (Nutzung)</p>
                    {agentTelemetryRows.length === 0 ? (
                      <p className="text-xs text-gray-500">Noch keine Agent-Preset-Nutzung vorhanden.</p>
                    ) : (
                      agentTelemetryRows.map((row) => (
                        <p key={`agent-${row.key}`}>{row.label}: angewendet {row.applied}</p>
                      ))
                    )}
                  </div>

                  <div className="mt-3 space-y-1">
                    <p className="font-medium text-gray-900">Wochenranking Dispatch (Quote + Volumen)</p>
                    <p className="text-xs text-gray-500">
                      Fenster seit:{' '}
                      {presetTelemetry.weeklyDispatchRanking.since
                        ? new Date(presetTelemetry.weeklyDispatchRanking.since).toLocaleString('de-AT')
                        : '-'}{' '}
                      | Entscheidungen: {presetTelemetry.weeklyDispatchRanking.totalDecisions ?? 0}
                    </p>
                    <p className="text-xs text-gray-500">
                      Bestes Preset:{' '}
                      {presetTelemetry.weeklyDispatchRanking.bestPresetId
                        ? DISPATCH_PRESETS.find((preset) => preset.id === presetTelemetry.weeklyDispatchRanking.bestPresetId)?.label ??
                          presetTelemetry.weeklyDispatchRanking.bestPresetId
                        : '-'}
                    </p>
                    {weeklyDispatchRankingRows.length === 0 ? (
                      <p className="text-xs text-gray-500">Noch keine Dispatch-Entscheidungen in den letzten 7 Tagen.</p>
                    ) : (
                      weeklyDispatchRankingRows.slice(0, 5).map((row) => (
                        <p key={`ranking-${row.presetId}`}>
                          {row.label}: Quote {row.approvalRate}% | Volumen {row.totalDecisions} (OK {row.approved} / Nein {row.dismissed})
                        </p>
                      ))
                    )}
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {isConfigOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4" onClick={() => setIsConfigOpen(false)}>
          <div
            className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-2xl sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900">Technik-Konfiguration</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refreshRuntimeConfig()}
                  className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Neu laden
                </button>
                <button
                  type="button"
                  onClick={() => setIsConfigOpen(false)}
                  className="rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Schliessen
                </button>
              </div>
            </div>

            {runtimeConfigLoading ? <p className="mb-3 text-sm text-gray-500">Konfiguration wird geladen...</p> : null}
            {runtimeConfigError ? <p className="mb-3 rounded-md bg-rose-50 p-2 text-sm text-rose-700">{runtimeConfigError}</p> : null}

            <section className="mb-4 space-y-2 rounded-lg border border-gray-200 p-3 text-sm text-gray-700">
              <p className="font-semibold text-gray-900">Status (Live)</p>
              <p>
                LLM - Aktiv: {diagnostics?.llm?.enabled ? 'Ja' : 'Nein'} | Konfiguriert:{' '}
                {diagnostics?.llm?.configured ? 'Ja' : 'Nein'} | Modell: {diagnostics?.llm?.model ?? '-'} | Strategie:{' '}
                {diagnostics?.llm?.strategy ?? '-'}
              </p>
              <p>
                Google Kalender - Aktiv: {diagnostics?.google?.enabled ? 'Ja' : 'Nein'} | Konfiguriert:{' '}
                {diagnostics?.google?.configured ? 'Ja' : 'Nein'} | Kalender vorhanden:{' '}
                {diagnostics?.google?.calendarConfigured ? 'Ja' : 'Nein'} | Schreibzugriff:{' '}
                {diagnostics?.google?.canWrite ? 'Ja' : 'Nein'}
              </p>
              <p>
                Rolle: {diagnostics?.google?.accessRole || '-'} | Kalender-ID: {diagnostics?.google?.calendarId || '-'}
              </p>
              <p>Freigegeben an: {diagnostics?.google?.sharedWith?.length ? diagnostics.google.sharedWith.join(', ') : '-'}</p>
              <p>
                Security - Auth: {diagnostics?.security?.authEnabled ? 'Ja' : 'Nein'} | Rate Limit:{' '}
                {diagnostics?.security?.rateLimit?.enabled ? 'Ja' : 'Nein'} | CORS:{' '}
                {diagnostics?.security?.corsOrigins?.length ? diagnostics.security.corsOrigins.join(', ') : '-'}
              </p>
              <p>
                Backup - Aktiv: {diagnostics?.backup?.enabled ? 'Ja' : 'Nein'} | Daily:{' '}
                {diagnostics?.backup?.dailyEnabled ? 'Ja' : 'Nein'} | Letztes Backup:{' '}
                {diagnostics?.backup?.lastBackupAt ? new Date(diagnostics.backup.lastBackupAt).toLocaleString('de-AT') : '-'}
              </p>
            </section>

            <section className="mb-4 rounded-lg border border-gray-200 p-3">
              <h3 className="mb-2 text-sm font-semibold text-gray-900">API Session (Client)</h3>
              <p className="mb-2 text-xs text-gray-500">
                Wird lokal im Browser gespeichert und fuer API-Requests als `x-promanager-api-key` gesendet.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  value={apiSessionKeyInput}
                  onChange={(e) => setApiSessionKeyInput(e.target.value)}
                  className="min-w-[220px] flex-1 rounded-md border border-gray-300 px-2 py-2 text-sm"
                  placeholder="API Key eingeben"
                />
                <button
                  type="button"
                  onClick={handleSaveApiSessionKey}
                  className="inline-flex min-h-10 items-center rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Speichern
                </button>
              </div>
            </section>

            <div className="space-y-4">
              <section className="rounded-lg border border-gray-200 p-3">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">LLM</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Aktiv</span>
                    <select
                      value={runtimeConfigForm.llmEnabled ? '1' : '0'}
                      onChange={(e) => updateRuntimeConfigField('llmEnabled', e.target.value === '1')}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    >
                      <option value="1">Ja</option>
                      <option value="0">Nein</option>
                    </select>
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Modell</span>
                    <input
                      value={runtimeConfigForm.llmModel}
                      onChange={(e) => updateRuntimeConfigField('llmModel', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      placeholder="gpt-4.1-mini"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Strategie</span>
                    <select
                      value={runtimeConfigForm.llmStrategy}
                      onChange={(e) => updateRuntimeConfigField('llmStrategy', e.target.value as RuntimeConfigForm['llmStrategy'])}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    >
                      <option value="dominant">dominant</option>
                      <option value="hybrid">hybrid</option>
                      <option value="fallback">fallback</option>
                    </select>
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Min Confidence (0-1)</span>
                    <input
                      value={runtimeConfigForm.llmMinConfidence}
                      onChange={(e) => updateRuntimeConfigField('llmMinConfidence', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700 sm:col-span-2">
                    <span className="mb-1 block">OpenAI Base URL</span>
                    <input
                      value={runtimeConfigForm.llmBaseUrl}
                      onChange={(e) => updateRuntimeConfigField('llmBaseUrl', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700 sm:col-span-2">
                    <span className="mb-1 block">OpenAI API Key (optional neu setzen)</span>
                    <input
                      type="password"
                      value={runtimeConfigForm.llmApiKey}
                      onChange={(e) => updateRuntimeConfigField('llmApiKey', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      placeholder={runtimeConfig?.llm?.hasApiKey ? 'Bereits gesetzt' : 'sk-...'}
                    />
                  </label>
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 p-3">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">Google Kalender</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Aktiv</span>
                    <select
                      value={runtimeConfigForm.googleEnabled ? '1' : '0'}
                      onChange={(e) => updateRuntimeConfigField('googleEnabled', e.target.value === '1')}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    >
                      <option value="1">Ja</option>
                      <option value="0">Nein</option>
                    </select>
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Kalendername</span>
                    <input
                      value={runtimeConfigForm.googleCalendarName}
                      onChange={(e) => updateRuntimeConfigField('googleCalendarName', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Kalender-ID (optional)</span>
                    <input
                      value={runtimeConfigForm.googleCalendarId}
                      onChange={(e) => updateRuntimeConfigField('googleCalendarId', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Zeitzone</span>
                    <input
                      value={runtimeConfigForm.googleTimezone}
                      onChange={(e) => updateRuntimeConfigField('googleTimezone', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Event-Dauer (Min)</span>
                    <input
                      value={runtimeConfigForm.googleEventDurationMin}
                      onChange={(e) => updateRuntimeConfigField('googleEventDurationMin', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Slot-Fenster (Tage)</span>
                    <input
                      value={runtimeConfigForm.googleSlotWindowDays}
                      onChange={(e) => updateRuntimeConfigField('googleSlotWindowDays', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Share-Rolle</span>
                    <select
                      value={runtimeConfigForm.googleShareRole}
                      onChange={(e) => updateRuntimeConfigField('googleShareRole', e.target.value as RuntimeConfigForm['googleShareRole'])}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    >
                      <option value="writer">writer</option>
                      <option value="reader">reader</option>
                      <option value="owner">owner</option>
                      <option value="freeBusyReader">freeBusyReader</option>
                    </select>
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Freigegeben an (CSV)</span>
                    <input
                      value={runtimeConfigForm.googleSharedWith}
                      onChange={(e) => updateRuntimeConfigField('googleSharedWith', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      placeholder="user@firma.at, office@firma.at"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Client ID (optional neu setzen)</span>
                    <input
                      type="password"
                      value={runtimeConfigForm.googleClientId}
                      onChange={(e) => updateRuntimeConfigField('googleClientId', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      placeholder={runtimeConfig?.google?.hasClientId ? 'Bereits gesetzt' : ''}
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Client Secret (optional neu setzen)</span>
                    <input
                      type="password"
                      value={runtimeConfigForm.googleClientSecret}
                      onChange={(e) => updateRuntimeConfigField('googleClientSecret', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      placeholder={runtimeConfig?.google?.hasClientSecret ? 'Bereits gesetzt' : ''}
                    />
                  </label>
                  <label className="text-sm text-gray-700 sm:col-span-2">
                    <span className="mb-1 block">Refresh Token (optional neu setzen)</span>
                    <input
                      type="password"
                      value={runtimeConfigForm.googleRefreshToken}
                      onChange={(e) => updateRuntimeConfigField('googleRefreshToken', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      placeholder={runtimeConfig?.google?.hasRefreshToken ? 'Bereits gesetzt' : ''}
                    />
                  </label>
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 p-3">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">Agent und Guardrail</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Agent aktiv</span>
                    <select
                      value={runtimeConfigForm.agentEnabled ? '1' : '0'}
                      onChange={(e) => updateRuntimeConfigField('agentEnabled', e.target.value === '1')}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    >
                      <option value="1">Ja</option>
                      <option value="0">Nein</option>
                    </select>
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Follow-up include required</span>
                    <select
                      value={runtimeConfigForm.agentFollowupIncludeRequired ? '1' : '0'}
                      onChange={(e) => updateRuntimeConfigField('agentFollowupIncludeRequired', e.target.value === '1')}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    >
                      <option value="1">Ja</option>
                      <option value="0">Nein</option>
                    </select>
                  </label>
                  <div className="text-sm text-gray-700 sm:col-span-2">
                    <span className="mb-1 block">Agent Presets (1-Klick-Uebernahme)</span>
                    <div className="flex flex-wrap gap-2">
                      {AGENT_PRESETS.map((preset) => {
                        const active = isAgentPresetActive(preset);
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => void handleApplyAgentPreset(preset)}
                            disabled={runtimeConfigSaving}
                            className={cx(
                              'inline-flex min-h-9 items-center rounded-md border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50',
                              active
                                ? 'border-blue-300 bg-blue-50 text-blue-700'
                                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
                            )}
                            title={preset.description}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Auto Google Sync nach Telegram-Import</span>
                    <select
                      value={runtimeConfigForm.autoGoogleSyncOnTelegramImport ? '1' : '0'}
                      onChange={(e) => updateRuntimeConfigField('autoGoogleSyncOnTelegramImport', e.target.value === '1')}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    >
                      <option value="1">Ja</option>
                      <option value="0">Nein</option>
                    </select>
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Taeglicher Google Hintergrund-Resync</span>
                    <select
                      value={runtimeConfigForm.dailyGoogleResyncEnabled ? '1' : '0'}
                      onChange={(e) => updateRuntimeConfigField('dailyGoogleResyncEnabled', e.target.value === '1')}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    >
                      <option value="1">Ja</option>
                      <option value="0">Nein</option>
                    </select>
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Dispatch aktiv</span>
                    <select
                      value={runtimeConfigForm.dispatchEnabled ? '1' : '0'}
                      onChange={(e) => updateRuntimeConfigField('dispatchEnabled', e.target.value === '1')}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    >
                      <option value="1">Ja</option>
                      <option value="0">Nein</option>
                    </select>
                  </label>
                  <div className="text-sm text-gray-700 sm:col-span-2">
                    <span className="mb-1 block">Dispatch Presets (1-Klick-Uebernahme)</span>
                    <div className="flex flex-wrap gap-2">
                      {DISPATCH_PRESETS.map((preset) => {
                        const active = isDispatchPresetActive(preset);
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => void handleApplyDispatchPreset(preset)}
                            disabled={runtimeConfigSaving}
                            className={cx(
                              'inline-flex min-h-9 items-center rounded-md border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50',
                              active
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
                            )}
                            title={preset.description}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Dispatch Min Score</span>
                    <input
                      value={runtimeConfigForm.dispatchMinScore}
                      onChange={(e) => updateRuntimeConfigField('dispatchMinScore', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Dispatch Max Daily Slots</span>
                    <input
                      value={runtimeConfigForm.dispatchMaxDailySlots}
                      onChange={(e) => updateRuntimeConfigField('dispatchMaxDailySlots', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700 sm:col-span-2">
                    <span className="mb-1 block">Dispatch Pflichtfelder (CSV)</span>
                    <input
                      value={runtimeConfigForm.dispatchRequiredFields}
                      onChange={(e) => updateRuntimeConfigField('dispatchRequiredFields', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700 sm:col-span-2">
                    <span className="mb-1 block">Dispatch Score Weights</span>
                    <input
                      value={runtimeConfigForm.dispatchScoreWeights}
                      onChange={(e) => updateRuntimeConfigField('dispatchScoreWeights', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700 sm:col-span-2">
                    <span className="mb-1 block">Agent Required Fields (CSV)</span>
                    <input
                      value={runtimeConfigForm.agentRequiredFields}
                      onChange={(e) => updateRuntimeConfigField('agentRequiredFields', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700 sm:col-span-2">
                    <span className="mb-1 block">Agent Critical Fields (CSV)</span>
                    <input
                      value={runtimeConfigForm.agentCriticalFields}
                      onChange={(e) => updateRuntimeConfigField('agentCriticalFields', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700 sm:col-span-2">
                    <span className="mb-1 block">Agent Property Priority</span>
                    <input
                      value={runtimeConfigForm.agentPropertyPriority}
                      onChange={(e) => updateRuntimeConfigField('agentPropertyPriority', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Import Guardrail (0-1)</span>
                    <input
                      value={runtimeConfigForm.guardrailImportConfidence}
                      onChange={(e) => updateRuntimeConfigField('guardrailImportConfidence', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 p-3">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">Security und Backup</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Auth aktiv</span>
                    <select
                      value={runtimeConfigForm.securityAuthEnabled ? '1' : '0'}
                      onChange={(e) => updateRuntimeConfigField('securityAuthEnabled', e.target.value === '1')}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    >
                      <option value="1">Ja</option>
                      <option value="0">Nein</option>
                    </select>
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Rate Limit aktiv</span>
                    <select
                      value={runtimeConfigForm.securityRateLimitEnabled ? '1' : '0'}
                      onChange={(e) => updateRuntimeConfigField('securityRateLimitEnabled', e.target.value === '1')}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    >
                      <option value="1">Ja</option>
                      <option value="0">Nein</option>
                    </select>
                  </label>
                  <label className="text-sm text-gray-700 sm:col-span-2">
                    <span className="mb-1 block">CORS Origins (CSV, * fuer alle)</span>
                    <input
                      value={runtimeConfigForm.securityCorsOrigins}
                      onChange={(e) => updateRuntimeConfigField('securityCorsOrigins', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Rate Limit Fenster (ms)</span>
                    <input
                      value={runtimeConfigForm.securityRateLimitWindowMs}
                      onChange={(e) => updateRuntimeConfigField('securityRateLimitWindowMs', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Rate Limit Max API</span>
                    <input
                      value={runtimeConfigForm.securityRateLimitMax}
                      onChange={(e) => updateRuntimeConfigField('securityRateLimitMax', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Rate Limit Max Webhook</span>
                    <input
                      value={runtimeConfigForm.securityRateLimitWebhookMax}
                      onChange={(e) => updateRuntimeConfigField('securityRateLimitWebhookMax', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <p className="text-xs text-gray-500 sm:col-span-2">
                    Gespeicherte Keys: Owner {runtimeConfig?.security?.ownerKeyCount ?? 0} | Dispatcher{' '}
                    {runtimeConfig?.security?.dispatcherKeyCount ?? 0} | ReadOnly {runtimeConfig?.security?.readonlyKeyCount ?? 0}
                  </p>
                  <label className="text-sm text-gray-700 sm:col-span-2">
                    <span className="mb-1 block">Owner API Keys (CSV, optional neu setzen)</span>
                    <input
                      value={runtimeConfigForm.securityOwnerKeys}
                      onChange={(e) => updateRuntimeConfigField('securityOwnerKeys', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      placeholder="owner-key-1, owner-key-2"
                    />
                  </label>
                  <label className="text-sm text-gray-700 sm:col-span-2">
                    <span className="mb-1 block">Dispatcher API Keys (CSV, optional neu setzen)</span>
                    <input
                      value={runtimeConfigForm.securityDispatcherKeys}
                      onChange={(e) => updateRuntimeConfigField('securityDispatcherKeys', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      placeholder="dispatcher-key-1"
                    />
                  </label>
                  <label className="text-sm text-gray-700 sm:col-span-2">
                    <span className="mb-1 block">ReadOnly API Keys (CSV, optional neu setzen)</span>
                    <input
                      value={runtimeConfigForm.securityReadonlyKeys}
                      onChange={(e) => updateRuntimeConfigField('securityReadonlyKeys', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                      placeholder="readonly-key-1"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Backups aktiv</span>
                    <select
                      value={runtimeConfigForm.backupEnabled ? '1' : '0'}
                      onChange={(e) => updateRuntimeConfigField('backupEnabled', e.target.value === '1')}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    >
                      <option value="1">Ja</option>
                      <option value="0">Nein</option>
                    </select>
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Daily Backup aktiv</span>
                    <select
                      value={runtimeConfigForm.backupDailyEnabled ? '1' : '0'}
                      onChange={(e) => updateRuntimeConfigField('backupDailyEnabled', e.target.value === '1')}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    >
                      <option value="1">Ja</option>
                      <option value="0">Nein</option>
                    </select>
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Backup Aufbewahrung (Tage)</span>
                    <input
                      value={runtimeConfigForm.backupRetentionDays}
                      onChange={(e) => updateRuntimeConfigField('backupRetentionDays', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block">Daily Backup Stunde (UTC)</span>
                    <input
                      value={runtimeConfigForm.backupDailyHourUtc}
                      onChange={(e) => updateRuntimeConfigField('backupDailyHourUtc', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                    />
                  </label>
                </div>
              </section>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => void handleSaveRuntimeConfig()}
                disabled={runtimeConfigSaving}
                className="inline-flex min-h-10 items-center rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {runtimeConfigSaving ? 'Speichern...' : 'Konfiguration speichern'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isPropertyEditorOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4" onClick={() => setIsPropertyEditorOpen(false)}>
          <div
            className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-2xl sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900">Eigenschaften</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddProperty}
                  className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Feld hinzufuegen
                </button>
                <button
                  type="button"
                  onClick={() => setIsPropertyEditorOpen(false)}
                  className="rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Schliessen
                </button>
              </div>
            </div>

            <section className="mb-4 space-y-2 rounded-lg border border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900">Quellen</h3>
                <button
                  type="button"
                  onClick={handleAddSource}
                  className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Quelle hinzufuegen
                </button>
              </div>

              {managedSources.length === 0 ? (
                <p className="text-xs text-gray-500">Noch keine Quellen vorhanden.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {managedSources.map((source) => (
                    <span
                      key={source}
                      className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700"
                    >
                      {source}
                      <button
                        type="button"
                        onClick={() => handleRenameSource(source)}
                        className="rounded border border-gray-200 bg-white p-0.5 text-gray-700 hover:bg-gray-100"
                        aria-label={`Quelle ${source} umbenennen`}
                      >
                        <PencilLine className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveSource(source)}
                        className="rounded border border-red-200 bg-red-50 p-0.5 text-red-700 hover:bg-red-100"
                        aria-label={`Quelle ${source} entfernen`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </section>

            <div className="space-y-2">
              {(database?.properties ?? DEFAULT_DATABASE_SCHEMA.properties).map((property) => (
                <div key={property.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 p-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {property.name} <span className="text-xs font-normal text-gray-500">({property.type})</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      id: {property.id}
                      {property.options?.length ? ` | Optionen: ${property.options.join(', ')}` : ''}
                      {property.system ? ' | Systemfeld' : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleEditProperty(property)}
                      className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <PencilLine className="h-3.5 w-3.5" />
                      Bearbeiten
                    </button>
                    <button
                      type="button"
                      disabled={property.system || property.required}
                      onClick={() => handleDeleteProperty(property)}
                      className="inline-flex min-h-9 items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Loeschen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
