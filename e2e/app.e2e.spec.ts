import { expect, test, type Page } from '@playwright/test';

const diagnosticsPayload = {
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
};

const configPayload = {
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
};

const fulfillJson = async (page: Page, pattern: string, payload: unknown): Promise<void> => {
  await page.route(pattern, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
};

const setupApiMocks = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await fulfillJson(page, '**/api/health', diagnosticsPayload);

  await page.route('**/api/config', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(configPayload),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...configPayload,
        health: diagnosticsPayload,
      }),
    });
  });

  await fulfillJson(page, '**/api/board/schema', { ok: true });
  await fulfillJson(page, '**/api/telemetry/presets', {
    ok: true,
    telemetry: diagnosticsPayload.presetTelemetry,
  });
  await fulfillJson(page, '**/api/telemetry/presets/export', {
    ok: true,
    exportedAt: diagnosticsPayload.serverTime,
    telemetry: { ...diagnosticsPayload.presetTelemetry, events: [] },
  });
};

test.beforeEach(async ({ page }) => {
  await setupApiMocks(page);
  await page.goto('/');
});

test('switches from cards view to table view', async ({ page }) => {
  await expect(page.getByText('Massenaktionen')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tabellenansicht' }).click();
  await expect(page.getByText(/Massenaktionen/)).toBeVisible();
});

test('edits title and status in table view', async ({ page }) => {
  await page.getByRole('button', { name: 'Tabellenansicht' }).click();
  await expect(page.getByText(/Massenaktionen/)).toBeVisible();

  const row = page.locator('tbody tr').filter({ has: page.locator('select') }).first();
  const titleInput = row.locator('td').nth(1).locator('input').first();
  const previousTitle = await titleInput.inputValue();
  const newTitle = `${previousTitle} Neu`;
  await titleInput.fill(newTitle);
  await titleInput.blur();
  await expect(titleInput).toHaveValue(newTitle);

  const statusSelect = row.locator('select').first();
  await statusSelect.selectOption('Terminiert');
  await expect(statusSelect).toHaveValue('Terminiert');

  await page.getByRole('button', { name: 'Kartenansicht' }).click();
  await expect(page.getByText(newTitle)).toBeVisible();
});
