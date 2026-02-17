import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  SOURCES,
  STATUS_ORDER,
  type BoardComment,
  type BoardData,
  type PersistedBoardV2,
  type ServiceCard,
  type Source,
  type Status,
  type StatusHistoryEntry,
} from '../types/board';
import { createInitialBoardData } from '../data/seed';
import { findCardStatus, moveCard } from '../utils/board';
import { nowIso, uid } from '../utils/id';
import { localStorageAdapter } from './storage';

const SCHEMA_VERSION = 2 as const;

interface BoardStoreState extends BoardData {
  schemaVersion: 2;
}

interface BoardStoreActions {
  openCard: (cardId: string | null) => void;
  updateCard: (cardId: string, patch: Partial<Omit<ServiceCard, 'id'>>) => void;
  addCard: (status: Status) => void;
  addComment: (cardId: string, text: string, user?: string) => void;

  dragMove: (cardId: string, toStatus: Status, toIndex: number) => void;
  finalizeMove: (cardId: string, startStatus: Status, movedBy?: string) => void;

  moveCardToStatus: (cardId: string, toStatus: Status, movedBy?: string) => void;
  moveCardLeft: (cardId: string, movedBy?: string) => void;
  moveCardRight: (cardId: string, movedBy?: string) => void;

  exportState: () => string;
  importState: (jsonText: string) => void;
  resetDemoData: () => void;
  hideCard: (cardId: string) => void;
  deleteCard: (cardId: string) => void;
}

export type BoardStore = BoardStoreState & BoardStoreActions;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const isStatus = (v: unknown): v is Status =>
  typeof v === 'string' && STATUS_ORDER.includes(v as Status);

const isSource = (v: unknown): v is Source =>
  typeof v === 'string' && SOURCES.includes(v as Source);

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
    timeLabel: typeof value.timeLabel === 'string' ? value.timeLabel : undefined,
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

  const status: Status = isStatus(value.status) ? value.status : 'Eingang / Anfrage';

  const sourcesFromArray = Array.isArray(value.sources) ? value.sources.filter(isSource) : [];
  const legacySource = isSource((value as { source?: unknown }).source) ? [(value as { source: Source }).source] : [];
  const sources: Source[] = (sourcesFromArray.length ? sourcesFromArray : legacySource) as Source[];

  const comments = Array.isArray(value.comments)
    ? value.comments.map(normalizeComment).filter(Boolean) as BoardComment[]
    : [];

  const history = Array.isArray(value.history)
    ? value.history.map(normalizeHistory).filter(Boolean) as StatusHistoryEntry[]
    : [];

  return {
    id: cardId,
    title: value.title,
    status,
    sources: sources.length ? sources : ['E-Mail'],
    address: typeof value.address === 'string' ? value.address : undefined,
    location: typeof value.location === 'string' ? value.location : undefined,
    phone: typeof value.phone === 'string' ? value.phone : undefined,
    date: typeof value.date === 'string' || value.date === null ? value.date : null,
	hiddenAt:
    typeof (value as { hiddenAt?: unknown }).hiddenAt === 'string' ||
    (value as { hiddenAt?: unknown }).hiddenAt === null
    ? ((value as { hiddenAt?: string | null }).hiddenAt ?? null)
    : null,

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

  const columns: PersistedBoardV2['columns'] = {
    'Eingang / Anfrage': [],
    Warteschlange: [],
    Terminiert: [],
    Erledigt: [],
  };

  if (isObject(payload.columns)) {
    for (const status of STATUS_ORDER) {
      const list = payload.columns[status];
      if (!Array.isArray(list)) continue;
      for (const cardId of list) {
        if (typeof cardId !== 'string') continue;
const card = cardsById[cardId];
if (!card || card.hiddenAt) continue;

if (!columns[status].includes(cardId)) {
  columns[status].push(cardId);
  cardsById[cardId] = { ...card, status };
       }

      }
    }
  }

  for (const [cardId, card] of Object.entries(cardsById)) {
  // ausgeblendete Karten bleiben ausgeblendet
  if (card.hiddenAt) continue;

  const alreadyInColumns = STATUS_ORDER.some((s) => columns[s].includes(cardId));
  if (!alreadyInColumns) {
    columns[card.status].push(cardId);
  }
}


  return {
    schemaVersion: SCHEMA_VERSION,
    cardsById,
    columns,
  };
};

const createHistoryEntry = (
  cardId: string,
  from: Status,
  to: Status,
  movedBy = 'Franz Kofler',
): StatusHistoryEntry => ({
  id: uid(),
  cardId,
  from,
  to,
  movedAt: nowIso(),
  movedBy,
});

const removeCardFromAllColumns = (
  columns: BoardStoreState['columns'],
  cardId: string,
): BoardStoreState['columns'] => ({
  'Eingang / Anfrage': columns['Eingang / Anfrage'].filter((id) => id !== cardId),
  Warteschlange: columns.Warteschlange.filter((id) => id !== cardId),
  Terminiert: columns.Terminiert.filter((id) => id !== cardId),
  Erledigt: columns.Erledigt.filter((id) => id !== cardId),
});

const initial = createInitialBoardData();

export const useBoardStore = create<BoardStore>()(
  persist(
    (set, get) => ({
      schemaVersion: SCHEMA_VERSION,
      ...initial,

      openCard: (cardId) => set({ selectedCardId: cardId }),

      updateCard: (cardId, patch) =>
        set((state) => {
          const card = state.cardsById[cardId];
          if (!card) return state;

          return {
            cardsById: {
              ...state.cardsById,
              [cardId]: {
                ...card,
                ...patch,
                updatedAt: nowIso(),
              },
            },
          };
        }),

      addCard: (status) =>
        set((state) => {
          const id = uid();
          const createdAt = nowIso();

          const card: ServiceCard = {
            id,
            title: 'Neue Seite',
            status,
            sources: ['E-Mail'],
            address: 'Neue Seite',
            location: '',
            phone: '',
            date: null,
			hiddenAt: null,
            comments: [],
            history: [],
            createdAt,
            updatedAt: createdAt,
          };

          return {
            cardsById: { ...state.cardsById, [id]: card },
            columns: { ...state.columns, [status]: [...state.columns[status], id] },
            selectedCardId: id,
          };
        }),

      addComment: (cardId, text, user = 'Franz Kofler') =>
        set((state) => {
          const card = state.cardsById[cardId];
          if (!card) return state;

          const trimmed = text.trim();
          if (!trimmed) return state;

          const createdAt = nowIso();

          const comment: BoardComment = {
            id: uid(),
            user,
            text: trimmed,
            createdAt,
            timeLabel: formatDistanceToNow(new Date(createdAt), { locale: de }),
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
              [cardId]: {
                ...card,
                status: toStatus,
                updatedAt: nowIso(),
              },
            },
          };
        }),

      finalizeMove: (cardId, startStatus, movedBy = 'Franz Kofler') =>
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

      moveCardToStatus: (cardId, toStatus, movedBy = 'Franz Kofler') =>
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
              [cardId]: {
                ...card,
                status: toStatus,
                history: [...card.history, entry],
                updatedAt: nowIso(),
              },
            },
          };
        }),

      moveCardLeft: (cardId, movedBy = 'Franz Kofler') => {
        const card = get().cardsById[cardId];
        if (!card) return;

        const idx = STATUS_ORDER.indexOf(card.status);
        if (idx <= 0) return;

        get().moveCardToStatus(cardId, STATUS_ORDER[idx - 1], movedBy);
      },

      moveCardRight: (cardId, movedBy = 'Franz Kofler') => {
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

deleteCard: (cardId) =>
  set((state) => {
    if (!state.cardsById[cardId]) return state;

    const { [cardId]: _removed, ...restCards } = state.cardsById;

    return {
      columns: removeCardFromAllColumns(state.columns, cardId),
      cardsById: restCards,
      selectedCardId: state.selectedCardId === cardId ? null : state.selectedCardId,
    };
  }),

      exportState: () => {
        const { cardsById, columns } = get();
        const payload: PersistedBoardV2 = {
          schemaVersion: SCHEMA_VERSION,
          cardsById,
          columns,
        };
        return JSON.stringify(payload, null, 2);
      },

      importState: (jsonText) => {
        const parsed = JSON.parse(jsonText) as unknown;
        const normalized = normalizePersistedPayload(parsed);
        if (!normalized) {
          throw new Error('Ungültiges JSON-Format.');
        }

        set({
          schemaVersion: SCHEMA_VERSION,
          cardsById: normalized.cardsById,
          columns: normalized.columns,
          selectedCardId: null,
        });
      },

      resetDemoData: () => {
        const fresh = createInitialBoardData();
        set({
          schemaVersion: SCHEMA_VERSION,
          ...fresh,
        });
      },
    }),
    {
      name: 'roofing-kanban-board-v2',
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorageAdapter.getStateStorage()),
      partialize: (state) => ({
        schemaVersion: SCHEMA_VERSION,
        cardsById: state.cardsById,
        columns: state.columns,
      }),
      migrate: (persistedState) => {
        const normalized = normalizePersistedPayload(persistedState);
        if (!normalized) {
          return {
            schemaVersion: SCHEMA_VERSION,
            ...createInitialBoardData(),
          };
        }

        return {
          schemaVersion: SCHEMA_VERSION,
          cardsById: normalized.cardsById,
          columns: normalized.columns,
          selectedCardId: null,
        };
      },
    },
  ),
);
