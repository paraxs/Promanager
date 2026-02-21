import { beforeEach, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../config/appConfig';
import { createInitialBoardData } from '../data/seed';
import type { ServiceCard, Status } from '../types/board';
import { findCardStatus } from '../utils/board';
import { createRecordValuesFromCardFields } from '../utils/cardValues';
import { BOARD_STORE_TESTING, useBoardStore } from './boardStore';

const makeCard = (id: string, status: Status, overrides: Partial<ServiceCard> = {}): ServiceCard => {
  const base: ServiceCard = {
    id,
    title: `Card ${id}`,
    collapsed: false,
    status,
    sources: ['E-Mail'],
    address: '',
    location: '',
    phone: '',
    date: null,
    hiddenAt: null,
    comments: [],
    history: [],
    createdAt: '2026-02-18T10:00:00.000Z',
    updatedAt: '2026-02-18T10:00:00.000Z',
    values: {},
    ...overrides,
  };

  return {
    ...base,
    values: createRecordValuesFromCardFields(base),
  };
};

describe('normalizePersistedPayload', () => {
  it('deduplicates card assignments and excludes archived cards from columns', () => {
    const payload = {
      cardsById: {
        a: makeCard('a', 'Warteschlange'),
        b: makeCard('b', 'Eingang / Anfrage'),
        c: makeCard('c', 'Terminiert', { hiddenAt: '2026-02-10T08:00:00.000Z' }),
        d: makeCard('d', 'Erledigt'),
      },
      columns: {
        'Eingang / Anfrage': ['a', 'b'],
        Warteschlange: ['a'],
        Terminiert: ['c'],
        Erledigt: [],
      },
    };

    const normalized = BOARD_STORE_TESTING.normalizePersistedPayload(payload);
    expect(normalized).not.toBeNull();
    if (!normalized) return;

    expect(normalized.columns['Eingang / Anfrage']).toEqual(['a', 'b']);
    expect(normalized.columns.Warteschlange).toEqual([]);
    expect(normalized.columns.Terminiert).toEqual([]);
    expect(normalized.columns.Erledigt).toEqual(['d']);
    expect(normalized.cardsById.a.status).toBe('Eingang / Anfrage');
    expect(normalized.columns['Eingang / Anfrage']).not.toContain('c');
  });

  it('hydrates record values for legacy cards without values field', () => {
    const payload = {
      cardsById: {
        legacy: {
          ...makeCard('legacy', 'Warteschlange'),
          values: undefined,
        },
      },
      columns: {
        'Eingang / Anfrage': [],
        Warteschlange: ['legacy'],
        Terminiert: [],
        Erledigt: [],
      },
    };

    const normalized = BOARD_STORE_TESTING.normalizePersistedPayload(payload);
    expect(normalized).not.toBeNull();
    if (!normalized) return;

    expect(normalized.cardsById.legacy.values.title).toBe('Card legacy');
    expect(normalized.cardsById.legacy.values.status).toBe('Warteschlange');
  });
});

describe('normalizeImportPayload', () => {
  it('imports ui settings and applies defaults for blank values', () => {
    const payload = {
      board: {
        cardsById: {
          a: makeCard('a', 'Eingang / Anfrage'),
        },
        columns: {
          'Eingang / Anfrage': ['a'],
          Warteschlange: [],
          Terminiert: [],
          Erledigt: [],
        },
      },
      ui: {
        dashboardLabel: '  Team Board  ',
        dashboardSubtitle: '   ',
      },
    };

    const normalized = BOARD_STORE_TESTING.normalizeImportPayload(payload);
    expect(normalized).not.toBeNull();
    if (!normalized) return;

    expect(normalized.ui).toEqual({
      dashboardLabel: 'Team Board',
      dashboardSubtitle: APP_CONFIG.board.subtitle,
    });
  });

  it('returns null for invalid import payload', () => {
    const normalized = BOARD_STORE_TESTING.normalizeImportPayload({ foo: 'bar' });
    expect(normalized).toBeNull();
  });

  it('keeps custom record values and accepts runtime database schema', () => {
    const card = makeCard('a', 'Eingang / Anfrage');
    card.values = { ...card.values, project_code: 'PX-42' };

    const payload = {
      board: {
        cardsById: { a: card },
        columns: {
          'Eingang / Anfrage': ['a'],
          Warteschlange: [],
          Terminiert: [],
          Erledigt: [],
        },
      },
      database: {
        id: 'service-card-db',
        name: 'Service Cards',
        properties: [
          { id: 'title', name: 'Titel', type: 'text', system: true },
          { id: 'status', name: 'Status', type: 'select', system: true, options: ['Eingang / Anfrage', 'Warteschlange'] },
          { id: 'project_code', name: 'Projektcode', type: 'text' },
        ],
      },
    };

    const normalized = BOARD_STORE_TESTING.normalizeImportPayload(payload);
    expect(normalized).not.toBeNull();
    if (!normalized) return;

    expect(normalized.database?.properties.some((property) => property.id === 'project_code')).toBe(true);
    expect(normalized.board.cardsById.a.values.project_code).toBe('PX-42');
  });
});

describe('mergeBoardForTelegramSync', () => {
  it('adds only new incoming cards and keeps existing local cards', () => {
    const localOnly = makeCard('local-1', 'Warteschlange', { title: 'Local Card' });
    const sameIdLocal = makeCard('shared-1', 'Eingang / Anfrage', { title: 'Local Shared' });
    const sameIdIncoming = makeCard('shared-1', 'Erledigt', { title: 'Incoming Shared' });
    const incomingOnly = makeCard('telegram-1', 'Terminiert', { title: 'Telegram Card' });

    const merged = BOARD_STORE_TESTING.mergeBoardForTelegramSync(
      {
        schemaVersion: 2,
        cardsById: {
          'local-1': localOnly,
          'shared-1': sameIdLocal,
        },
        columns: {
          'Eingang / Anfrage': ['shared-1'],
          Warteschlange: ['local-1'],
          Terminiert: [],
          Erledigt: [],
        },
      },
      {
        schemaVersion: 2,
        cardsById: {
          'shared-1': sameIdIncoming,
          'telegram-1': incomingOnly,
        },
        columns: {
          'Eingang / Anfrage': [],
          Warteschlange: [],
          Terminiert: ['telegram-1'],
          Erledigt: ['shared-1'],
        },
      },
    );

    expect(merged.addedCardIds).toEqual(['telegram-1']);
    expect(merged.board.cardsById['local-1'].title).toBe('Local Card');
    expect(merged.board.cardsById['shared-1'].title).toBe('Local Shared');
    expect(merged.board.cardsById['telegram-1'].title).toBe('Telegram Card');
    expect(merged.board.columns.Terminiert).toContain('telegram-1');
    expect(merged.board.columns.Warteschlange).toContain('local-1');
  });

  it('deduplicates incoming cards by semantic content', () => {
    const local = makeCard('local-1', 'Eingang / Anfrage', {
      title: 'Termin morgen',
      date: '2026-02-19',
      location: 'Lienz',
      address: 'Peter Weber Gasse',
    });

    const incomingDup1 = makeCard('telegram-a', 'Eingang / Anfrage', {
      title: 'Termin: morgen',
      date: '2026-02-19',
      location: 'Lienz',
      address: 'Peter Weber Gasse',
    });

    const incomingDup2 = makeCard('telegram-b', 'Eingang / Anfrage', {
      title: 'Termin morgen',
      date: '2026-02-19',
      location: 'lienz',
      address: 'Peter Weber Gasse',
    });

    const incomingNew = makeCard('telegram-c', 'Warteschlange', {
      title: 'Neuer Auftrag',
      date: null,
    });

    const merged = BOARD_STORE_TESTING.mergeBoardForTelegramSync(
      {
        schemaVersion: 2,
        cardsById: { 'local-1': local },
        columns: {
          'Eingang / Anfrage': ['local-1'],
          Warteschlange: [],
          Terminiert: [],
          Erledigt: [],
        },
      },
      {
        schemaVersion: 2,
        cardsById: {
          'telegram-a': incomingDup1,
          'telegram-b': incomingDup2,
          'telegram-c': incomingNew,
        },
        columns: {
          'Eingang / Anfrage': ['telegram-a', 'telegram-b'],
          Warteschlange: ['telegram-c'],
          Terminiert: [],
          Erledigt: [],
        },
      },
    );

    expect(merged.addedCardIds).toEqual(['telegram-c']);
    expect(merged.board.cardsById['local-1']).toBeDefined();
    expect(merged.board.cardsById['telegram-a']).toBeUndefined();
    expect(merged.board.cardsById['telegram-b']).toBeUndefined();
    expect(merged.board.cardsById['telegram-c']).toBeDefined();
    expect(merged.board.columns['Eingang / Anfrage']).toContain('local-1');
    expect(merged.board.columns.Warteschlange).toContain('telegram-c');
  });

  it('deduplicates already existing local duplicates on merge', () => {
    const localA = makeCard('local-a', 'Eingang / Anfrage', {
      title: 'Termin morgen 15 Uhr',
      date: '2026-02-19',
      location: 'Lienz',
      address: 'Peter Weber Gasse',
    });
    const localB = makeCard('local-b', 'Eingang / Anfrage', {
      title: 'Termin: morgen 15 Uhr',
      date: '2026-02-19',
      location: 'lienz',
      address: 'Peter Weber Gasse',
    });

    const merged = BOARD_STORE_TESTING.mergeBoardForTelegramSync(
      {
        schemaVersion: 2,
        cardsById: {
          'local-a': localA,
          'local-b': localB,
        },
        columns: {
          'Eingang / Anfrage': ['local-a', 'local-b'],
          Warteschlange: [],
          Terminiert: [],
          Erledigt: [],
        },
      },
      {
        schemaVersion: 2,
        cardsById: {},
        columns: {
          'Eingang / Anfrage': [],
          Warteschlange: [],
          Terminiert: [],
          Erledigt: [],
        },
      },
    );

    const ids = Object.keys(merged.board.cardsById);
    expect(ids.length).toBe(1);
    expect(merged.board.columns['Eingang / Anfrage'].length).toBe(1);
  });
});

describe('store actions hardening', () => {
  beforeEach(() => {
    const fresh = createInitialBoardData();
    useBoardStore.setState((state) => ({
      ...state,
      schemaVersion: 2,
      ...fresh,
    }));
  });

  it('ignores status patches passed to updateCard and keeps column assignment consistent', () => {
    const stateBefore = useBoardStore.getState();
    const cardId = stateBefore.columns.Warteschlange[0];
    const previousStatus = stateBefore.cardsById[cardId].status;

    useBoardStore.getState().updateCard(
      cardId,
      { status: 'Erledigt' } as unknown as Parameters<(typeof stateBefore)['updateCard']>[1],
    );

    const stateAfter = useBoardStore.getState();
    expect(stateAfter.cardsById[cardId].status).toBe(previousStatus);
    expect(findCardStatus(stateAfter.columns, cardId)).toBe(previousStatus);
    expect(stateAfter.columns.Erledigt).not.toContain(cardId);
  });

  it('creates new cards with empty address by default', () => {
    useBoardStore.getState().addCard('Eingang / Anfrage');
    const state = useBoardStore.getState();
    const cardId = state.columns['Eingang / Anfrage'][state.columns['Eingang / Anfrage'].length - 1];
    expect(state.cardsById[cardId].address).toBe('');
  });

  it('can archive and restore a card without losing placement', () => {
    const stateBefore = useBoardStore.getState();
    const cardId = stateBefore.columns.Warteschlange[0];

    useBoardStore.getState().hideCard(cardId);
    const hiddenState = useBoardStore.getState();
    expect(hiddenState.cardsById[cardId].hiddenAt).toBeTruthy();
    expect(hiddenState.columns.Warteschlange).not.toContain(cardId);

    useBoardStore.getState().restoreCard(cardId);
    const restoredState = useBoardStore.getState();
    expect(restoredState.cardsById[cardId].hiddenAt).toBeNull();
    expect(restoredState.columns.Warteschlange).toContain(cardId);
  });
});
