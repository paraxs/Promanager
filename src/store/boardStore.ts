import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  STATUS_ORDER,
  type BoardDatabaseSchema,
  type BoardComment,
  type BoardData,
  type CardRecordValues,
  type CardRecordValue,
  type PersistedBoardV2,
  type PropertyDefinition,
  type PropertyType,
  type ServiceCard,
  type Source,
  type Status,
  type StatusHistoryEntry,
  type WorkspaceExportPayload,
  type WorkspaceUiSettings,
} from '../types/board';
import { createInitialBoardData } from '../data/seed';
import { APP_CONFIG } from '../config/appConfig';
import {
  CARD_PROPERTY_IDS,
  createDefaultDatabaseSchema,
  DEFAULT_DATABASE_SCHEMA,
  DEFAULT_SELECT_OPTIONS,
  RUNTIME_PROPERTY_TYPES,
} from '../config/database';
import { findCardStatus, moveCard } from '../utils/board';
import { createRecordValuesFromCardFields, normalizeRecordValues } from '../utils/cardValues';
import { nowIso, uid } from '../utils/id';
import { clearPersistedState, localStorageAdapter } from './storage';

const SCHEMA_VERSION = 2 as const;
const PERSIST_KEY = APP_CONFIG.persistence.boardStorageKey;
const UI_SETTINGS_EVENT = 'promanager-ui-settings-updated';

type EditableCardPatch = Partial<
  Pick<ServiceCard, 'title' | 'collapsed' | 'sources' | 'address' | 'location' | 'phone' | 'date'>
>;

type EditablePropertyType = Extract<PropertyType, 'text' | 'select' | 'date'>;

type PropertyDraft = {
  id: string;
  name: string;
  type: EditablePropertyType;
  options?: string[];
};

const hasPatchKey = <K extends keyof EditableCardPatch>(patch: EditableCardPatch, key: K): boolean =>
  Object.prototype.hasOwnProperty.call(patch, key);

const PRESERVED_META_VALUE_PREFIXES = ['google_'];

interface BoardStoreState extends BoardData {
  schemaVersion: 2;
}

interface BoardStoreActions {
  openCard: (cardId: string | null) => void;
  updateCard: (cardId: string, patch: EditableCardPatch) => void;
  updateCardValue: (cardId: string, propertyId: string, value: CardRecordValue) => void;
  addPropertyDefinition: (draft: PropertyDraft) => void;
  updatePropertyDefinition: (draft: PropertyDraft) => void;
  removePropertyDefinition: (propertyId: string) => void;
  addGlobalSource: (source: string) => void;
  renameGlobalSource: (from: string, to: string) => void;
  removeGlobalSource: (source: string) => void;
  addCard: (status: Status) => void;
  addComment: (cardId: string, text: string, user?: string) => void;

  dragMove: (cardId: string, toStatus: Status, toIndex: number) => void;
  finalizeMove: (cardId: string, startStatus: Status, movedBy?: string) => void;

  moveCardToStatus: (cardId: string, toStatus: Status, movedBy?: string) => void;
  moveCardLeft: (cardId: string, movedBy?: string) => void;
  moveCardRight: (cardId: string, movedBy?: string) => void;

  exportState: () => string;
  importState: (jsonText: string) => void;
  importTelegramState: (jsonText: string) => number;
  dedupeBoard: () => number;
  resetDemoData: (hard?: boolean) => void;
  hideCard: (cardId: string) => void;
  restoreCard: (cardId: string) => void;
  archiveCompletedCards: () => number;
  deleteCard: (cardId: string) => void;
}

export type BoardStore = BoardStoreState & BoardStoreActions;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const isStatus = (v: unknown): v is Status => typeof v === 'string' && STATUS_ORDER.includes(v as Status);

const normalizeSource = (value: unknown): Source | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeSourceKey = (value: string): string => value.trim().toLowerCase();

const isSameSource = (a: string, b: string): boolean => normalizeSourceKey(a) === normalizeSourceKey(b);

const dedupeSources = (sources: Source[]): Source[] => {
  const seen = new Set<string>();
  const next: Source[] = [];
  for (const source of sources) {
    const key = normalizeSourceKey(source);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(source);
  }
  return next;
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

const clampTextLength = (value: string, max: number): string => value.slice(0, max);

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

const isRuntimePropertyType = (value: unknown): value is EditablePropertyType =>
  typeof value === 'string' && (RUNTIME_PROPERTY_TYPES as readonly string[]).includes(value);

const normalizeSelectOptions = (options: unknown): string[] | undefined => {
  if (!Array.isArray(options)) return undefined;
  const next = options
    .filter((option): option is string => typeof option === 'string')
    .map((option) => option.trim())
    .filter((option) => option.length > 0);
  if (!next.length) return undefined;
  return Array.from(new Set(next));
};

const normalizePropertyDefinition = (value: unknown, fallbackNamePrefix = 'Feld'): PropertyDefinition | null => {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string') return null;
  const id = slugify(value.id);
  if (!id) return null;

  const nameRaw = typeof value.name === 'string' ? value.name.trim() : '';
  const name = nameRaw || `${fallbackNamePrefix} ${id}`;
  const type: EditablePropertyType = isRuntimePropertyType(value.type) ? value.type : 'text';

  return {
    id,
    name,
    type,
    required: typeof value.required === 'boolean' ? value.required : false,
    system: typeof value.system === 'boolean' ? value.system : false,
    options: type === 'select' ? normalizeSelectOptions(value.options) : undefined,
  };
};

const ensureDefaultOptionsForProperty = (property: PropertyDefinition): PropertyDefinition => {
  if (property.type !== 'select') return { ...property, options: undefined };
  if (property.id === CARD_PROPERTY_IDS.status) {
    return { ...property, options: [...APP_CONFIG.workflow.statusOrder] };
  }
  if (property.options && property.options.length > 0) {
    return { ...property, options: Array.from(new Set(property.options.map((option) => option.trim()).filter(Boolean))) };
  }
  const defaultOptions = DEFAULT_SELECT_OPTIONS[property.id];
  return {
    ...property,
    options: defaultOptions ? [...defaultOptions] : [],
  };
};

const normalizeDatabaseSchema = (value: unknown): BoardDatabaseSchema | null => {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || !Array.isArray(value.properties)) return null;

  const known = new Map<string, PropertyDefinition>();
  for (const [idx, propertyValue] of value.properties.entries()) {
    const normalized = normalizePropertyDefinition(propertyValue, `Feld ${idx + 1}`);
    if (!normalized) continue;
    known.set(normalized.id, ensureDefaultOptionsForProperty(normalized));
  }

  for (const property of DEFAULT_DATABASE_SCHEMA.properties) {
    if (!known.has(property.id)) {
      known.set(property.id, { ...property, options: property.options?.slice() });
      continue;
    }

    const existing = known.get(property.id);
    if (!existing) continue;
    known.set(property.id, {
      ...existing,
      system: true,
      required: property.required ?? existing.required,
      type: property.type,
      options:
        property.type === 'select'
          ? (existing.options && existing.options.length ? existing.options : property.options?.slice() ?? [])
          : undefined,
      name: existing.name || property.name,
    });
    known.set(property.id, ensureDefaultOptionsForProperty(known.get(property.id)!));
  }

  const orderedIds = [
    ...DEFAULT_DATABASE_SCHEMA.properties.map((property) => property.id),
    ...Array.from(known.keys()).filter((id) => !DEFAULT_DATABASE_SCHEMA.properties.some((property) => property.id === id)),
  ];

  return {
    id: value.id.trim() || DEFAULT_DATABASE_SCHEMA.id,
    name: value.name.trim() || DEFAULT_DATABASE_SCHEMA.name,
    properties: orderedIds
      .map((id) => known.get(id))
      .filter((property): property is PropertyDefinition => !!property)
      .map((property) => ({ ...property, options: property.options?.slice() })),
  };
};

const getSafeLocalStorage = (): Storage | null => {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
};

const scrubInvalidPersistedSnapshot = (): void => {
  const ls = getSafeLocalStorage();
  if (!ls) return;

  const raw = ls.getItem(PERSIST_KEY);
  if (!raw) return;

  try {
    JSON.parse(raw);
  } catch {
    ls.removeItem(PERSIST_KEY);
  }
};

const readUiSettingsFromStorage = (): WorkspaceUiSettings => {
  const defaults: WorkspaceUiSettings = {
    dashboardLabel: APP_CONFIG.board.dashboardLabel,
    dashboardSubtitle: APP_CONFIG.board.subtitle,
  };

  const ls = getSafeLocalStorage();
  if (!ls) return defaults;

  const label = ls.getItem(APP_CONFIG.persistence.dashboardLabelStorageKey)?.trim();
  const subtitle = ls.getItem(APP_CONFIG.persistence.dashboardSubtitleStorageKey)?.trim();

  return {
    dashboardLabel: label || defaults.dashboardLabel,
    dashboardSubtitle: subtitle || defaults.dashboardSubtitle,
  };
};

const writeUiSettingsToStorage = (settings: WorkspaceUiSettings): void => {
  const ls = getSafeLocalStorage();
  if (!ls) return;

  ls.setItem(APP_CONFIG.persistence.dashboardLabelStorageKey, settings.dashboardLabel);
  ls.setItem(APP_CONFIG.persistence.dashboardSubtitleStorageKey, settings.dashboardSubtitle);
};

const clearUiSettingsFromStorage = (): void => {
  const ls = getSafeLocalStorage();
  if (!ls) return;

  ls.removeItem(APP_CONFIG.persistence.dashboardLabelStorageKey);
  ls.removeItem(APP_CONFIG.persistence.dashboardSubtitleStorageKey);
};

const emitUiSettingsChanged = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UI_SETTINGS_EVENT));
};

const normalizeComment = (value: unknown): BoardComment | null => {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || typeof value.user !== 'string' || typeof value.text !== 'string') {
    return null;
  }

  return {
    id: value.id,
    user: value.user,
    text: value.text,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : nowIso(),
  };
};

const normalizeHistory = (value: unknown): StatusHistoryEntry | null => {
  if (!isObject(value)) return null;
  if (
    typeof value.id !== 'string' ||
    typeof value.cardId !== 'string' ||
    !isStatus(value.from) ||
    !isStatus(value.to) ||
    typeof value.movedAt !== 'string' ||
    typeof value.movedBy !== 'string'
  ) {
    return null;
  }

  return {
    id: value.id,
    cardId: value.cardId,
    from: value.from,
    to: value.to,
    movedAt: value.movedAt,
    movedBy: value.movedBy,
  };
};

const normalizeCard = (cardId: string, value: unknown): ServiceCard | null => {
  if (!isObject(value)) return null;
  if (typeof value.title !== 'string' || value.title.trim().length === 0) return null;

  const status: Status = isStatus(value.status) ? value.status : APP_CONFIG.defaults.fallbackStatus;

  const sourcesFromArray = Array.isArray(value.sources)
    ? value.sources.map((source) => normalizeSource(source)).filter((source): source is Source => Boolean(source))
    : [];
  const legacySourceValue = normalizeSource((value as { source?: unknown }).source);
  const legacySource = legacySourceValue ? [legacySourceValue] : [];
  const sources: Source[] = sourcesFromArray.length ? sourcesFromArray : legacySource;

  const comments = Array.isArray(value.comments)
    ? (value.comments.map(normalizeComment).filter(Boolean) as BoardComment[])
    : [];

  const history = Array.isArray(value.history)
    ? (value.history.map(normalizeHistory).filter(Boolean) as StatusHistoryEntry[])
    : [];

  const fallbackFields = {
    title: value.title,
    status,
    sources: sources.length ? sources : [APP_CONFIG.defaults.fallbackSource],
    address: typeof value.address === 'string' ? value.address : '',
    location: typeof value.location === 'string' ? value.location : '',
    phone: typeof value.phone === 'string' ? value.phone : '',
    date: typeof value.date === 'string' || value.date === null ? value.date : null,
  };
  const valuesCandidate = (value as { values?: unknown }).values;
  const normalizedValues = normalizeRecordValues(valuesCandidate, fallbackFields);

  return {
    id: cardId,
    title: normalizedValues.fields.title,
    collapsed:
      typeof (value as { collapsed?: unknown }).collapsed === 'boolean'
        ? (value as { collapsed: boolean }).collapsed
        : false,
    status: normalizedValues.fields.status,
    sources: normalizedValues.fields.sources,
    address: normalizedValues.fields.address,
    location: normalizedValues.fields.location,
    phone: normalizedValues.fields.phone,
    date: normalizedValues.fields.date,
    hiddenAt:
      typeof (value as { hiddenAt?: unknown }).hiddenAt === 'string' ||
      (value as { hiddenAt?: unknown }).hiddenAt === null
        ? ((value as { hiddenAt?: string | null }).hiddenAt ?? null)
        : null,
    values: normalizedValues.values,
    comments,
    history,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : nowIso(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : nowIso(),
  };
};

const normalizePersistedPayload = (payload: unknown): PersistedBoardV2 | null => {
  if (!isObject(payload)) return null;
  if (!isObject(payload.cardsById)) return null;

  const cardsById: Record<string, ServiceCard> = {};
  for (const [id, raw] of Object.entries(payload.cardsById)) {
    const normalized = normalizeCard(id, raw);
    if (normalized) cardsById[id] = normalized;
  }

  const columns: PersistedBoardV2['columns'] = STATUS_ORDER.reduce((acc, status) => {
    acc[status] = [];
    return acc;
  }, {} as PersistedBoardV2['columns']);

  const assignedCardIds = new Set<string>();

  if (isObject(payload.columns)) {
    for (const status of STATUS_ORDER) {
      const list = payload.columns[status];
      if (!Array.isArray(list)) continue;

      for (const rawCardId of list) {
        if (typeof rawCardId !== 'string') continue;
        if (assignedCardIds.has(rawCardId)) continue;

        const card = cardsById[rawCardId];
        if (!card || card.hiddenAt) continue;

        columns[status].push(rawCardId);
        assignedCardIds.add(rawCardId);
        cardsById[rawCardId] = syncCardValues({ ...card, status });
      }
    }
  }

  for (const [cardId, card] of Object.entries(cardsById)) {
    if (card.hiddenAt) continue;
    if (assignedCardIds.has(cardId)) continue;

    columns[card.status].push(cardId);
    assignedCardIds.add(cardId);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    cardsById,
    columns,
  };
};

const normalizeUiSettings = (value: unknown): WorkspaceUiSettings | null => {
  if (!isObject(value)) return null;

  const label = typeof value.dashboardLabel === 'string' ? value.dashboardLabel.trim() : '';
  const subtitle = typeof value.dashboardSubtitle === 'string' ? value.dashboardSubtitle.trim() : '';

  if (!label && !subtitle) return null;

  return {
    dashboardLabel: label || APP_CONFIG.board.dashboardLabel,
    dashboardSubtitle: subtitle || APP_CONFIG.board.subtitle,
  };
};

const normalizeImportPayload = (
  payload: unknown,
): {
  board: PersistedBoardV2;
  ui?: WorkspaceUiSettings;
  database?: BoardDatabaseSchema;
} | null => {
  if (!isObject(payload)) return null;

  const boardCandidate = isObject(payload.board) ? payload.board : payload;
  const normalizedBoard = normalizePersistedPayload(boardCandidate);
  if (!normalizedBoard) return null;

  const normalizedUi = normalizeUiSettings(payload.ui);
  const databaseCandidate = payload.database ?? (isObject(payload.board) ? payload.board.database : undefined);
  const normalizedDatabase = normalizeDatabaseSchema(databaseCandidate);

  return {
    board: normalizedBoard,
    ui: normalizedUi ?? undefined,
    database: normalizedDatabase ?? undefined,
  };
};

const normalizeFingerprintToken = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

const buildCardSemanticKey = (card: ServiceCard): string => {
  const title = normalizeFingerprintToken(card.title);
  const date = normalizeFingerprintToken(card.date ?? '');
  const address = normalizeFingerprintToken(card.address ?? '');
  const location = normalizeFingerprintToken(card.location ?? '');
  const phone = normalizeFingerprintToken(card.phone ?? '');
  const status = normalizeFingerprintToken(card.status);
  return [status, title, date, address, location, phone].join('|');
};

const mergeCardPreferFilledFields = (existing: ServiceCard, incoming: ServiceCard): ServiceCard => {
  const pickText = (current: string | undefined, next: string | undefined): string => {
    const currentTrimmed = (current ?? '').trim();
    const nextTrimmed = (next ?? '').trim();
    if (!currentTrimmed && nextTrimmed) return nextTrimmed;
    return current ?? '';
  };

  const pickDate = (current: string | null | undefined, next: string | null | undefined): string | null => {
    if ((!current || current.trim?.() === '') && typeof next === 'string' && next.trim()) return next;
    return current ?? null;
  };

  const nextTitle = (() => {
    const currentTrimmed = existing.title.trim();
    const incomingTrimmed = incoming.title.trim();
    if (!currentTrimmed && incomingTrimmed) return incoming.title;
    if (normalizeFingerprintToken(currentTrimmed) === normalizeFingerprintToken(APP_CONFIG.defaults.newCardTitle) && incomingTrimmed)
      return incoming.title;
    return existing.title;
  })();

  const merged: ServiceCard = {
    ...existing,
    title: nextTitle,
    status: existing.status || incoming.status,
    address: pickText(existing.address, incoming.address),
    location: pickText(existing.location, incoming.location),
    phone: pickText(existing.phone, incoming.phone),
    date: pickDate(existing.date, incoming.date),
    comments: existing.comments.length >= incoming.comments.length ? existing.comments : incoming.comments,
    history: existing.history.length >= incoming.history.length ? existing.history : incoming.history,
    updatedAt: existing.updatedAt > incoming.updatedAt ? existing.updatedAt : incoming.updatedAt,
    values: {
      ...incoming.values,
      ...existing.values,
    },
  };

  return syncCardValues(merged);
};

const dedupeCardsBySemanticKey = (cardsById: Record<string, ServiceCard>): Record<string, ServiceCard> => {
  const keyToCardId = new Map<string, string>();
  const deduped: Record<string, ServiceCard> = {};

  for (const [cardId, card] of Object.entries(cardsById)) {
    const semanticKey = buildCardSemanticKey(card);
    if (!semanticKey) {
      deduped[cardId] = card;
      continue;
    }

    const existingId = keyToCardId.get(semanticKey);
    if (!existingId) {
      keyToCardId.set(semanticKey, cardId);
      deduped[cardId] = card;
      continue;
    }

    const existingCard = deduped[existingId];
    if (!existingCard) {
      keyToCardId.set(semanticKey, cardId);
      deduped[cardId] = card;
      continue;
    }

    deduped[existingId] = mergeCardPreferFilledFields(existingCard, card);
  }

  return deduped;
};

const mergeBoardForTelegramSync = (
  currentBoard: PersistedBoardV2,
  incomingBoard: PersistedBoardV2,
): { board: PersistedBoardV2; addedCardIds: string[] } => {
  const mergedCardsById: Record<string, ServiceCard> = dedupeCardsBySemanticKey(currentBoard.cardsById);
  const addedCardIds: string[] = [];
  const existingBySemanticKey = new Map<string, string>();
  const incomingSeenSemantic = new Set<string>();

  for (const card of Object.values(currentBoard.cardsById)) {
    if (!card || card.hiddenAt) continue;
    existingBySemanticKey.set(buildCardSemanticKey(card), card.id);
  }

  for (const [cardId, card] of Object.entries(incomingBoard.cardsById)) {
    const semanticKey = buildCardSemanticKey(card);
    if (semanticKey && incomingSeenSemantic.has(semanticKey)) continue;
    if (semanticKey) incomingSeenSemantic.add(semanticKey);

    const duplicateLocalCardId = semanticKey ? existingBySemanticKey.get(semanticKey) : undefined;
    if (duplicateLocalCardId) {
      const existing = mergedCardsById[duplicateLocalCardId];
      if (existing) {
        mergedCardsById[duplicateLocalCardId] = mergeCardPreferFilledFields(existing, card);
      }
      continue;
    }

    if (mergedCardsById[cardId]) continue;
    mergedCardsById[cardId] = card;
    addedCardIds.push(cardId);
    if (semanticKey) existingBySemanticKey.set(semanticKey, cardId);
  }

  const normalized = normalizePersistedPayload({
    cardsById: mergedCardsById,
    columns: currentBoard.columns,
  });

  if (!normalized) {
    return {
      board: currentBoard,
      addedCardIds: [],
    };
  }

  return {
    board: normalized,
    addedCardIds,
  };
};

export const BOARD_STORE_TESTING = {
  normalizePersistedPayload,
  normalizeImportPayload,
  mergeBoardForTelegramSync,
};

const createHistoryEntry = (
  cardId: string,
  from: Status,
  to: Status,
  movedBy: string = APP_CONFIG.defaults.actorName,
): StatusHistoryEntry => ({
  id: uid(),
  cardId,
  from,
  to,
  movedAt: nowIso(),
  movedBy,
});

const getDefaultRecordValueForProperty = (property: PropertyDefinition): CardRecordValue => {
  if (property.type === 'date') return null;
  if (property.type === 'select') return property.options?.[0] ?? '';
  return '';
};

const applyCardValueChange = (card: ServiceCard, propertyId: string, value: CardRecordValue): ServiceCard | null => {
  const next = {
    ...card,
    values: {
      ...card.values,
      [propertyId]: value,
    },
    updatedAt: nowIso(),
  };

  if (propertyId === CARD_PROPERTY_IDS.title) {
    if (typeof value !== 'string') return null;
    const title = clampTextLength(value.trim(), APP_CONFIG.project.maxTitleLength) || APP_CONFIG.defaults.newCardTitle;
    next.title = title;
    next.values[CARD_PROPERTY_IDS.title] = title;
  } else if (propertyId === CARD_PROPERTY_IDS.address) {
    if (typeof value !== 'string') return null;
    next.address = value;
  } else if (propertyId === CARD_PROPERTY_IDS.location) {
    if (typeof value !== 'string') return null;
    next.location = value;
  } else if (propertyId === CARD_PROPERTY_IDS.phone) {
    if (typeof value !== 'string') return null;
    next.phone = value;
  } else if (propertyId === CARD_PROPERTY_IDS.date) {
    if (!(typeof value === 'string' || value === null)) return null;
    next.date = value;
  }

  return syncCardValues(next);
};

const applyDatabaseSchemaToCards = (
  cardsById: Record<string, ServiceCard>,
  schema: BoardDatabaseSchema,
): Record<string, ServiceCard> => {
  const allowedIds = new Set(schema.properties.map((property) => property.id));

  return Object.fromEntries(
    Object.entries(cardsById).map(([cardId, card]) => {
      const nextValues: CardRecordValues = {};
      for (const [propertyId, propertyValue] of Object.entries(card.values ?? {})) {
        if (
          allowedIds.has(propertyId) ||
          PRESERVED_META_VALUE_PREFIXES.some((prefix) => propertyId.startsWith(prefix)) ||
          propertyId === CARD_PROPERTY_IDS.sources ||
          propertyId === CARD_PROPERTY_IDS.title ||
          propertyId === CARD_PROPERTY_IDS.status ||
          propertyId === CARD_PROPERTY_IDS.address ||
          propertyId === CARD_PROPERTY_IDS.location ||
          propertyId === CARD_PROPERTY_IDS.phone ||
          propertyId === CARD_PROPERTY_IDS.date
        ) {
          nextValues[propertyId] = propertyValue;
        }
      }

      for (const property of schema.properties) {
        if (!(property.id in nextValues)) {
          nextValues[property.id] = getDefaultRecordValueForProperty(property);
        }
      }

      return [cardId, syncCardValues({ ...card, values: nextValues })];
    }),
  );
};

const removeCardFromAllColumns = (
  columns: BoardStoreState['columns'],
  cardId: string,
): BoardStoreState['columns'] =>
  STATUS_ORDER.reduce((acc, status) => {
    acc[status] = columns[status].filter((id) => id !== cardId);
    return acc;
  }, {} as BoardStoreState['columns']);

const syncCardValues = (card: ServiceCard): ServiceCard => {
  const values: CardRecordValues = {
    ...(card.values ?? {}),
    ...createRecordValuesFromCardFields(card),
  };
  return {
    ...card,
    values,
  };
};

const initial = createInitialBoardData();
scrubInvalidPersistedSnapshot();

export const useBoardStore = create<BoardStore>()(
  persist(
    (set, get) => ({
      schemaVersion: SCHEMA_VERSION,
      ...initial,

      openCard: (cardId) => set({ selectedCardId: cardId }),

      updateCardValue: (cardId, propertyId, value) =>
        set((state) => {
          const card = state.cardsById[cardId];
          if (!card) return state;
          if (propertyId === CARD_PROPERTY_IDS.status || propertyId === CARD_PROPERTY_IDS.sources) return state;

          const nextCard = applyCardValueChange(card, propertyId, value);
          if (!nextCard) return state;

          return {
            cardsById: {
              ...state.cardsById,
              [cardId]: nextCard,
            },
          };
        }),

      addPropertyDefinition: (draft) =>
        set((state) => {
          const id = slugify(draft.id || draft.name);
          if (!id) return state;
          if (state.database.properties.some((property) => property.id === id)) return state;

          const property: PropertyDefinition = ensureDefaultOptionsForProperty({
            id,
            name: draft.name.trim() || id,
            type: draft.type,
            options: draft.options?.slice(),
            required: false,
            system: false,
          });

          const database: BoardDatabaseSchema = {
            ...state.database,
            properties: [...state.database.properties, property],
          };

          return {
            database,
            cardsById: applyDatabaseSchemaToCards(state.cardsById, database),
          };
        }),

      updatePropertyDefinition: (draft) =>
        set((state) => {
          const id = slugify(draft.id);
          if (!id) return state;

          const index = state.database.properties.findIndex((property) => property.id === id);
          if (index < 0) return state;

          const current = state.database.properties[index];
          const nextType = current.system ? current.type : draft.type;
          const next: PropertyDefinition = ensureDefaultOptionsForProperty({
            ...current,
            name: draft.name.trim() || current.name,
            type: nextType,
            options: current.system ? current.options?.slice() : draft.options?.slice(),
          });

          const properties = state.database.properties.map((property) => (property.id === id ? next : property));
          const database: BoardDatabaseSchema = { ...state.database, properties };
          return {
            database,
            cardsById: applyDatabaseSchemaToCards(state.cardsById, database),
          };
        }),

      removePropertyDefinition: (propertyId) =>
        set((state) => {
          const id = slugify(propertyId);
          if (!id) return state;
          const target = state.database.properties.find((property) => property.id === id);
          if (!target || target.system || target.required) return state;

          const properties = state.database.properties.filter((property) => property.id !== id);
          const database: BoardDatabaseSchema = { ...state.database, properties };
          return {
            database,
            cardsById: applyDatabaseSchemaToCards(state.cardsById, database),
          };
        }),

      addGlobalSource: (source) =>
        set((state) => {
          const normalizedSource = normalizeSource(source);
          if (!normalizedSource) return state;
          const sourceKey = normalizeSourceKey(normalizedSource);

          let propertiesChanged = false;
          let hasSourceSelectProperty = false;

          let nextProperties = state.database.properties.map((property) => {
            if (!(property.type === 'select' && isLikelySourceProperty(property))) return property;
            hasSourceSelectProperty = true;
            const options = property.options ?? [];
            if (options.some((option) => normalizeSourceKey(option) === sourceKey)) return property;
            propertiesChanged = true;
            return {
              ...property,
              options: [...options, normalizedSource],
            };
          });

          if (!hasSourceSelectProperty) {
            propertiesChanged = true;
            let id = 'quelle';
            let index = 2;
            const usedIds = new Set(nextProperties.map((property) => property.id));
            while (usedIds.has(id)) {
              id = `quelle-${index}`;
              index += 1;
            }

            nextProperties = [
              ...nextProperties,
              {
                id,
                name: 'Quelle',
                type: 'select',
                options: [normalizedSource],
                required: false,
                system: false,
              },
            ];
          }

          if (!propertiesChanged) return state;

          const database: BoardDatabaseSchema = {
            ...state.database,
            properties: nextProperties,
          };

          return {
            database,
            cardsById: applyDatabaseSchemaToCards(state.cardsById, database),
          };
        }),

      renameGlobalSource: (from, to) =>
        set((state) => {
          const fromSource = normalizeSource(from);
          const toSource = normalizeSource(to);
          if (!fromSource || !toSource) return state;

          const fromKey = normalizeSourceKey(fromSource);
          const toKey = normalizeSourceKey(toSource);

          let propertiesChanged = false;
          const nextProperties = state.database.properties.map((property) => {
            if (!(property.type === 'select' && isLikelySourceProperty(property))) return property;
            const options = property.options ?? [];
            if (!options.some((option) => normalizeSourceKey(option) === fromKey)) return property;

            const seen = new Set<string>();
            const nextOptions: string[] = [];
            for (const option of options) {
              const normalizedOptionKey = normalizeSourceKey(option);
              const mapped = normalizedOptionKey === fromKey ? toSource : option;
              const mappedKey = normalizeSourceKey(mapped);
              if (!mappedKey || seen.has(mappedKey)) continue;
              seen.add(mappedKey);
              nextOptions.push(mappedKey === toKey ? toSource : mapped);
            }

            const changed =
              nextOptions.length !== options.length || nextOptions.some((option, index) => option !== options[index]);
            if (!changed) return property;
            propertiesChanged = true;
            return {
              ...property,
              options: nextOptions,
            };
          });

          const sourceSelectProperties = nextProperties.filter(
            (property) => property.type === 'select' && isLikelySourceProperty(property),
          );
          const sourcePropertyIds = new Set(sourceSelectProperties.map((property) => property.id));

          let cardsChanged = false;
          const cardsById = Object.fromEntries(
            Object.entries(state.cardsById).map(([cardId, card]) => {
              const mappedSources = card.sources.map((entry) => (isSameSource(entry, fromSource) ? toSource : entry));
              const nextSources = dedupeSources(mappedSources);

              const nextValues: CardRecordValues = { ...card.values };
              let valuesChanged = false;
              for (const propertyId of sourcePropertyIds) {
                const raw = nextValues[propertyId];
                if (typeof raw !== 'string') continue;
                if (!isSameSource(raw, fromSource)) continue;
                nextValues[propertyId] = toSource;
                valuesChanged = true;
              }

              const sourcesChanged =
                nextSources.length !== card.sources.length || nextSources.some((entry, idx) => entry !== card.sources[idx]);

              if (!sourcesChanged && !valuesChanged) {
                return [cardId, card];
              }

              cardsChanged = true;
              return [
                cardId,
                syncCardValues({
                  ...card,
                  sources: nextSources.length ? nextSources : [APP_CONFIG.defaults.fallbackSource],
                  values: nextValues,
                  updatedAt: nowIso(),
                }),
              ];
            }),
          );

          if (!propertiesChanged && !cardsChanged) return state;

          const database: BoardDatabaseSchema = {
            ...state.database,
            properties: nextProperties,
          };

          return {
            database,
            cardsById: applyDatabaseSchemaToCards(cardsById, database),
          };
        }),

      removeGlobalSource: (source) =>
        set((state) => {
          const normalizedSource = normalizeSource(source);
          if (!normalizedSource) return state;

          const sourceKey = normalizeSourceKey(normalizedSource);
          const fallbackCandidates = [APP_CONFIG.defaults.fallbackSource, ...APP_CONFIG.workflow.sources]
            .map((entry) => normalizeSource(entry))
            .filter((entry): entry is Source => Boolean(entry));
          const fallbackSource =
            fallbackCandidates.find((entry) => normalizeSourceKey(entry) !== sourceKey) ?? APP_CONFIG.defaults.fallbackSource;

          let propertiesChanged = false;
          const nextProperties = state.database.properties.map((property) => {
            if (!(property.type === 'select' && isLikelySourceProperty(property))) return property;
            const options = property.options ?? [];
            const filteredOptions = options.filter((option) => normalizeSourceKey(option) !== sourceKey);
            if (filteredOptions.length === options.length) return property;
            propertiesChanged = true;
            return {
              ...property,
              options: filteredOptions,
            };
          });

          const sourceSelectProperties = nextProperties.filter(
            (property) => property.type === 'select' && isLikelySourceProperty(property),
          );
          const sourcePropertyIds = new Set(sourceSelectProperties.map((property) => property.id));
          const nextOptionBySourcePropertyId = new Map<string, string>();
          for (const property of sourceSelectProperties) {
            nextOptionBySourcePropertyId.set(property.id, property.options?.[0] ?? '');
          }

          let cardsChanged = false;
          const cardsById = Object.fromEntries(
            Object.entries(state.cardsById).map(([cardId, card]) => {
              const filteredSources = dedupeSources(card.sources.filter((entry) => !isSameSource(entry, normalizedSource)));
              const nextSources = filteredSources.length ? filteredSources : [fallbackSource];

              const nextValues: CardRecordValues = { ...card.values };
              let valuesChanged = false;
              for (const propertyId of sourcePropertyIds) {
                const raw = nextValues[propertyId];
                if (typeof raw !== 'string') continue;
                if (!isSameSource(raw, normalizedSource)) continue;
                nextValues[propertyId] = nextOptionBySourcePropertyId.get(propertyId) ?? '';
                valuesChanged = true;
              }

              const sourcesChanged =
                nextSources.length !== card.sources.length || nextSources.some((entry, idx) => entry !== card.sources[idx]);

              if (!sourcesChanged && !valuesChanged) {
                return [cardId, card];
              }

              cardsChanged = true;
              return [
                cardId,
                syncCardValues({
                  ...card,
                  sources: nextSources,
                  values: nextValues,
                  updatedAt: nowIso(),
                }),
              ];
            }),
          );

          if (!propertiesChanged && !cardsChanged) return state;

          const database: BoardDatabaseSchema = {
            ...state.database,
            properties: nextProperties,
          };

          return {
            database,
            cardsById: applyDatabaseSchemaToCards(cardsById, database),
          };
        }),

      updateCard: (cardId, patch) =>
        set((state) => {
          const card = state.cardsById[cardId];
          if (!card) return state;

          const normalizedPatch: EditableCardPatch = {};

          if (hasPatchKey(patch, 'title') && typeof patch.title === 'string') {
            const nextTitle = clampTextLength(patch.title.trim(), APP_CONFIG.project.maxTitleLength);
            normalizedPatch.title = nextTitle || APP_CONFIG.defaults.newCardTitle;
          }

          if (hasPatchKey(patch, 'collapsed') && typeof patch.collapsed === 'boolean') {
            normalizedPatch.collapsed = patch.collapsed;
          }

          if (hasPatchKey(patch, 'sources') && Array.isArray(patch.sources)) {
            const nextSources = patch.sources.map((source) => normalizeSource(source)).filter((source): source is Source => Boolean(source));
            normalizedPatch.sources = nextSources.length ? nextSources : [APP_CONFIG.defaults.fallbackSource];
          }

          if (hasPatchKey(patch, 'address') && (typeof patch.address === 'string' || patch.address === undefined)) {
            normalizedPatch.address = patch.address;
          }

          if (hasPatchKey(patch, 'location') && (typeof patch.location === 'string' || patch.location === undefined)) {
            normalizedPatch.location = patch.location;
          }

          if (hasPatchKey(patch, 'phone') && (typeof patch.phone === 'string' || patch.phone === undefined)) {
            normalizedPatch.phone = patch.phone;
          }

          if (
            hasPatchKey(patch, 'date') &&
            (typeof patch.date === 'string' || patch.date === null || patch.date === undefined)
          ) {
            normalizedPatch.date = patch.date;
          }

          if (Object.keys(normalizedPatch).length === 0) return state;

          return {
            cardsById: {
              ...state.cardsById,
              [cardId]: syncCardValues({
                ...card,
                ...normalizedPatch,
                updatedAt: nowIso(),
              }),
            },
          };
        }),

      addCard: (status) =>
        set((state) => {
          const id = uid();
          const createdAt = nowIso();

          const card: ServiceCard = {
            id,
            title: clampTextLength(APP_CONFIG.defaults.newCardTitle, APP_CONFIG.project.maxTitleLength),
            collapsed: false,
            status,
            sources: [APP_CONFIG.defaults.fallbackSource],
            address: '',
            location: '',
            phone: '',
            date: null,
            hiddenAt: null,
            values: {},
            comments: [],
            history: [],
            createdAt,
            updatedAt: createdAt,
          };
          const normalizedCard = applyDatabaseSchemaToCards({ [id]: syncCardValues(card) }, state.database)[id];

          return {
            cardsById: { ...state.cardsById, [id]: normalizedCard },
            columns: { ...state.columns, [status]: [...state.columns[status], id] },
            selectedCardId: id,
          };
        }),

      addComment: (cardId, text, user = APP_CONFIG.defaults.actorName) =>
        set((state) => {
          const card = state.cardsById[cardId];
          if (!card) return state;

          const trimmed = clampTextLength(text.trim(), APP_CONFIG.project.maxCommentLength);
          if (!trimmed) return state;

          const createdAt = nowIso();

          const comment: BoardComment = {
            id: uid(),
            user,
            text: trimmed,
            createdAt,
          };

          return {
            cardsById: {
              ...state.cardsById,
              [cardId]: {
                ...card,
                comments: [...card.comments, comment],
                updatedAt: createdAt,
              },
            },
          };
        }),

      dragMove: (cardId, toStatus, toIndex) =>
        set((state) => {
          const fromStatus = findCardStatus(state.columns, cardId);
          if (!fromStatus) return state;

          const nextColumns = moveCard(state.columns, cardId, fromStatus, toStatus, toIndex);
          if (nextColumns === state.columns) return state;

          const card = state.cardsById[cardId];
          if (!card) return { columns: nextColumns };

          if (card.status === toStatus) {
            return { columns: nextColumns };
          }

          return {
            columns: nextColumns,
            cardsById: {
              ...state.cardsById,
              [cardId]: syncCardValues({
                ...card,
                status: toStatus,
                updatedAt: nowIso(),
              }),
            },
          };
        }),

      finalizeMove: (cardId, startStatus, movedBy = APP_CONFIG.defaults.actorName) =>
        set((state) => {
          const card = state.cardsById[cardId];
          if (!card) return state;
          if (card.status === startStatus) return state;

          const entry = createHistoryEntry(cardId, startStatus, card.status, movedBy);

          return {
            cardsById: {
              ...state.cardsById,
              [cardId]: {
                ...card,
                history: [...card.history, entry],
                updatedAt: nowIso(),
              },
            },
          };
        }),

      moveCardToStatus: (cardId, toStatus, movedBy = APP_CONFIG.defaults.actorName) =>
        set((state) => {
          const card = state.cardsById[cardId];
          if (!card) return state;

          const fromStatus = findCardStatus(state.columns, cardId);
          if (!fromStatus) return state;
          if (fromStatus === toStatus) return state;

          const toIndex = state.columns[toStatus].length;
          const nextColumns = moveCard(state.columns, cardId, fromStatus, toStatus, toIndex);

          const entry = createHistoryEntry(cardId, fromStatus, toStatus, movedBy);

          return {
            columns: nextColumns,
            cardsById: {
              ...state.cardsById,
              [cardId]: syncCardValues({
                ...card,
                status: toStatus,
                history: [...card.history, entry],
                updatedAt: nowIso(),
              }),
            },
          };
        }),

      moveCardLeft: (cardId, movedBy = APP_CONFIG.defaults.actorName) => {
        const card = get().cardsById[cardId];
        if (!card) return;

        const idx = STATUS_ORDER.indexOf(card.status);
        if (idx <= 0) return;

        get().moveCardToStatus(cardId, STATUS_ORDER[idx - 1], movedBy);
      },

      moveCardRight: (cardId, movedBy = APP_CONFIG.defaults.actorName) => {
        const card = get().cardsById[cardId];
        if (!card) return;

        const idx = STATUS_ORDER.indexOf(card.status);
        if (idx < 0 || idx >= STATUS_ORDER.length - 1) return;

        get().moveCardToStatus(cardId, STATUS_ORDER[idx + 1], movedBy);
      },

      hideCard: (cardId) =>
        set((state) => {
          const card = state.cardsById[cardId];
          if (!card) return state;

          return {
            columns: removeCardFromAllColumns(state.columns, cardId),
            cardsById: {
              ...state.cardsById,
              [cardId]: {
                ...card,
                hiddenAt: nowIso(),
                updatedAt: nowIso(),
              },
            },
            selectedCardId: state.selectedCardId === cardId ? null : state.selectedCardId,
          };
        }),

      restoreCard: (cardId) =>
        set((state) => {
          const card = state.cardsById[cardId];
          if (!card || !card.hiddenAt) return state;

          const targetStatus = isStatus(card.status) ? card.status : APP_CONFIG.defaults.fallbackStatus;
          const columnsWithoutCard = removeCardFromAllColumns(state.columns, cardId);

          return {
            columns: {
              ...columnsWithoutCard,
              [targetStatus]: [...columnsWithoutCard[targetStatus], cardId],
            },
            cardsById: {
              ...state.cardsById,
              [cardId]: syncCardValues({
                ...card,
                status: targetStatus,
                hiddenAt: null,
                updatedAt: nowIso(),
              }),
            },
          };
        }),

      archiveCompletedCards: () => {
        let archived = 0;

        set((state) => {
          const completedIds = state.columns['Erledigt'].filter((cardId) => {
            const card = state.cardsById[cardId];
            return Boolean(card) && !card.hiddenAt;
          });
          if (completedIds.length === 0) return state;

          const completedIdSet = new Set(completedIds);
          archived = completedIds.length;
          const now = nowIso();

          const cardsById = Object.fromEntries(
            Object.entries(state.cardsById).map(([cardId, card]) => {
              if (!completedIdSet.has(cardId)) return [cardId, card];
              return [
                cardId,
                {
                  ...card,
                  hiddenAt: now,
                  updatedAt: now,
                },
              ];
            }),
          );

          return {
            columns: {
              ...state.columns,
              Erledigt: state.columns.Erledigt.filter((cardId) => !completedIdSet.has(cardId)),
            },
            cardsById,
            selectedCardId:
              state.selectedCardId && completedIdSet.has(state.selectedCardId) ? null : state.selectedCardId,
          };
        });

        return archived;
      },

      deleteCard: (cardId) =>
        set((state) => {
          if (!state.cardsById[cardId]) return state;

          const restCards = Object.fromEntries(Object.entries(state.cardsById).filter(([id]) => id !== cardId));

          return {
            columns: removeCardFromAllColumns(state.columns, cardId),
            cardsById: restCards,
            selectedCardId: state.selectedCardId === cardId ? null : state.selectedCardId,
          };
        }),

      exportState: () => {
        const { cardsById, columns, database } = get();
        const payload: WorkspaceExportPayload = {
          formatVersion: 2,
          exportedAt: nowIso(),
          board: {
            schemaVersion: SCHEMA_VERSION,
            cardsById,
            columns,
            database,
          },
          ui: readUiSettingsFromStorage(),
          database,
        };

        return JSON.stringify(payload, null, 2);
      },

      importState: (jsonText) => {
        const parsed = JSON.parse(jsonText) as unknown;
        const normalized = normalizeImportPayload(parsed);

        if (!normalized) {
          throw new Error('Ungueltiges JSON-Format.');
        }

        if (normalized.ui) {
          writeUiSettingsToStorage(normalized.ui);
          emitUiSettingsChanged();
        }

        set({
          schemaVersion: SCHEMA_VERSION,
          cardsById: applyDatabaseSchemaToCards(
            normalized.board.cardsById,
            normalized.database ?? normalized.board.database ?? createDefaultDatabaseSchema(),
          ),
          columns: normalized.board.columns,
          database: normalized.database ?? normalized.board.database ?? createDefaultDatabaseSchema(),
          selectedCardId: null,
        });
      },

      importTelegramState: (jsonText) => {
        const parsed = JSON.parse(jsonText) as unknown;
        const normalized = normalizeImportPayload(parsed);

        if (!normalized) {
          throw new Error('Ungueltiges Telegram-Sync-Format.');
        }

        let added = 0;

        set((state) => {
          const incomingDatabase = normalized.database ?? normalized.board.database ?? createDefaultDatabaseSchema();
          const incomingCards = applyDatabaseSchemaToCards(normalized.board.cardsById, incomingDatabase);
          const merged = mergeBoardForTelegramSync(
            {
              schemaVersion: SCHEMA_VERSION,
              cardsById: state.cardsById,
              columns: state.columns,
            },
            {
              schemaVersion: SCHEMA_VERSION,
              cardsById: incomingCards,
              columns: normalized.board.columns,
            },
          );

          added = merged.addedCardIds.length;
          const nextCardsById = applyDatabaseSchemaToCards(merged.board.cardsById, state.database);
          const nextColumns = merged.board.columns;
          const currentSnapshot = JSON.stringify({ cardsById: state.cardsById, columns: state.columns });
          const nextSnapshot = JSON.stringify({ cardsById: nextCardsById, columns: nextColumns });
          if (currentSnapshot === nextSnapshot) return state;

          return {
            cardsById: nextCardsById,
            columns: nextColumns,
          };
        });

        return added;
      },

      dedupeBoard: () => {
        let removed = 0;

        set((state) => {
          const merged = mergeBoardForTelegramSync(
            {
              schemaVersion: SCHEMA_VERSION,
              cardsById: state.cardsById,
              columns: state.columns,
            },
            {
              schemaVersion: SCHEMA_VERSION,
              cardsById: {},
              columns: {
                'Eingang / Anfrage': [],
                Warteschlange: [],
                Terminiert: [],
                Erledigt: [],
              },
            },
          );

          const nextCardsById = applyDatabaseSchemaToCards(merged.board.cardsById, state.database);
          const nextColumns = merged.board.columns;
          removed = Math.max(0, Object.keys(state.cardsById).length - Object.keys(nextCardsById).length);

          const currentSnapshot = JSON.stringify({ cardsById: state.cardsById, columns: state.columns });
          const nextSnapshot = JSON.stringify({ cardsById: nextCardsById, columns: nextColumns });
          if (currentSnapshot === nextSnapshot) return state;

          return {
            cardsById: nextCardsById,
            columns: nextColumns,
          };
        });

        return removed;
      },

      resetDemoData: (hard = false) => {
        if (hard) {
          clearPersistedState(PERSIST_KEY);
          clearUiSettingsFromStorage();
          emitUiSettingsChanged();
        }

        const fresh = createInitialBoardData();
        set({
          schemaVersion: SCHEMA_VERSION,
          ...fresh,
        });
      },
    }),
    {
      name: PERSIST_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorageAdapter.getStateStorage()),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<BoardStore> | null) ?? null;
        const base = currentState as BoardStore;
        const merged: BoardStore = {
          ...base,
          ...(persisted ?? {}),
        };

        const normalizedDatabase = normalizeDatabaseSchema(persisted?.database);
        merged.database = normalizedDatabase ?? createDefaultDatabaseSchema();

        const normalizedBoard = normalizePersistedPayload(persisted);
        if (normalizedBoard) {
          merged.cardsById = applyDatabaseSchemaToCards(normalizedBoard.cardsById, merged.database);
          merged.columns = normalizedBoard.columns;
        } else {
          merged.cardsById = applyDatabaseSchemaToCards(merged.cardsById ?? {}, merged.database);
          merged.columns = merged.columns ?? createInitialBoardData().columns;
        }

        const selectedCardId = typeof persisted?.selectedCardId === 'string' ? persisted.selectedCardId : null;
        merged.selectedCardId = selectedCardId && merged.cardsById[selectedCardId] ? selectedCardId : null;

        if (!merged.database || !Array.isArray(merged.database.properties)) {
          merged.database = createDefaultDatabaseSchema();
        }

        return merged;
      },
      partialize: (state) => ({
        schemaVersion: SCHEMA_VERSION,
        cardsById: state.cardsById,
        columns: state.columns,
        database: state.database,
      }),
      migrate: (persistedState) => {
        const normalized = normalizePersistedPayload(persistedState);
        const normalizedDatabase = normalizeDatabaseSchema((persistedState as { database?: unknown })?.database);
        const database = normalizedDatabase ?? createDefaultDatabaseSchema();
        if (!normalized) {
          return {
            schemaVersion: SCHEMA_VERSION,
            ...createInitialBoardData(),
          };
        }

        return {
          schemaVersion: SCHEMA_VERSION,
          cardsById: applyDatabaseSchemaToCards(normalized.cardsById, database),
          columns: normalized.columns,
          database,
          selectedCardId: null,
        };
      },
    },
  ),
);
