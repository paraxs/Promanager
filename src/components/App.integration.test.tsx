// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { createInitialBoardData } from '../data/seed';
import { useBoardStore } from '../store/boardStore';
import { useUiStore } from '../store/uiStore';

const createDiagnosticsPayload = () => ({
  ok: true,
  service: 'telegram-mvp',
  serverTime: '2026-02-21T10:00:00.000Z',
  pendingProposals: 0,
  openConversations: 0,
  telegram: {
    botConfigured: false,
    webhook: {
      configured: false,
      ok: false,
      url: '',
      pendingUpdateCount: 0,
    },
  },
  llm: {
    enabled: false,
    configured: false,
    model: 'gpt-4.1-mini',
    strategy: 'dominant',
  },
  google: {
    enabled: false,
    configured: false,
    calendarConfigured: false,
    canWrite: false,
    sync: {
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
    },
  },
  automation: {
    autoGoogleSyncOnTelegramImport: false,
    dailyGoogleResyncEnabled: false,
  },
  presetTelemetry: {
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
  },
});

const createConfigPayload = () => ({
  ok: true,
  config: {
    llm: {
      enabled: false,
      model: 'gpt-4.1-mini',
      strategy: 'dominant',
      minConfidence: 0.7,
      repairPass: true,
      repairMinConfidence: 0.82,
      repairMaxTries: 2,
      timeoutMs: 12000,
      baseUrl: 'https://api.openai.com/v1',
      hasApiKey: false,
    },
    google: {
      enabled: false,
      hasClientId: false,
      hasClientSecret: false,
      hasRefreshToken: false,
      calendarId: '',
      calendarName: 'Projekte Firma 2026',
      timezone: 'Europe/Vienna',
      eventDurationMin: 90,
      slotWindowDays: 14,
      shareRole: 'writer',
      sharedWith: [],
    },
    agent: {
      enabled: true,
      requiredFields: 'date,address,source',
      criticalFields: 'date,address,source',
      propertyPriority: 'date:100,address:90,source:85',
      followupIncludeRequired: false,
    },
    automation: {
      autoGoogleSyncOnTelegramImport: false,
      dailyGoogleResyncEnabled: false,
    },
    dispatch: {
      enabled: true,
      minScore: 55,
      maxDailySlots: 3,
      requiredFields: 'date,address,source',
      scoreWeights:
        'eingang:80,warteschlange:65,termin_ohne_datum:85,ueberfaellig:95,missing_date:18,missing_address:12,missing_phone:8,missing_source:6,no_comment:6,age_per_day:2,age_max:24',
    },
    guardrail: {
      importConfidence: 0.65,
    },
  },
});

const createJsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const resetStores = (): void => {
  const fresh = createInitialBoardData();
  useBoardStore.setState((state) => ({
    ...state,
    schemaVersion: 2,
    ...fresh,
  }));

  useUiStore.setState((state) => ({
    ...state,
    searchQuery: '',
    quickFilter: 'all',
    viewMode: 'cards',
    tableColumnOrder: [],
    hiddenTableColumnIds: [],
    tableColumnFilters: {},
    tableSort: null,
    tableViewProfiles: [],
    activeTableViewProfileId: null,
  }));
};

describe('App table integration', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStores();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
        if (url.includes('/api/health')) return createJsonResponse(createDiagnosticsPayload());
        if (url.includes('/api/config')) return createJsonResponse(createConfigPayload());
        if (url.includes('/api/board/schema')) return createJsonResponse({ ok: true });
        if (url.includes('/api/telemetry/presets')) return createJsonResponse({ ok: true, telemetry: createDiagnosticsPayload().presetTelemetry });
        return createJsonResponse({ ok: true });
      }),
    );

    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('prompt', vi.fn(() => null));
    vi.stubGlobal('open', vi.fn(() => null));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('switches from cards view to table view via header controls', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByText(/Massenaktionen/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: /Tabellenansicht/i }));

    await waitFor(() => {
      expect(screen.getByText(/Massenaktionen/i)).not.toBeNull();
    });
    expect(useUiStore.getState().viewMode).toBe('table');
  });

  it('edits table fields in DOM and updates store state', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /Tabellenansicht/i }));
    await screen.findByText(/Massenaktionen/i);

    const titleInputs = (await screen.findAllByDisplayValue('Kircher Christian Oberdrauburg')) as HTMLInputElement[];
    const titleInput = titleInputs[0];
    const row = titleInput.closest('tr');
    expect(row).not.toBeNull();

    await user.clear(titleInput);
    await user.type(titleInput, 'Kircher Christian Neu');
    fireEvent.blur(titleInput);

    await waitFor(() => {
      expect(useBoardStore.getState().cardsById['1']?.title).toBe('Kircher Christian Neu');
    });

    const statusSelect = within(row as HTMLElement).getByRole('combobox') as HTMLSelectElement;
    await user.selectOptions(statusSelect, 'Terminiert');

    await waitFor(() => {
      const state = useBoardStore.getState();
      expect(state.cardsById['1']?.status).toBe('Terminiert');
      expect(state.columns.Terminiert.includes('1')).toBe(true);
    });
  });
});
