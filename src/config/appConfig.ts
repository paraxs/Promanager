export const APP_CONFIG = {
  board: {
    dashboardLabel: 'Projekte Firma 2026',
    subtitle: 'Service Management Dashboard',
  },
  project: {
    maxTitleLength: 140,
    maxCommentLength: 2000,
  },
  defaults: {
    actorName: 'Franz Kofler',
    fallbackStatus: 'Eingang / Anfrage',
    fallbackSource: 'E-Mail',
    newCardTitle: 'Neue Seite',
  },
  scheduling: {
    locale: 'de-AT',
    timezone: 'Europe/Vienna',
    businessDays: [1, 2, 3, 4, 5],
    workdayStart: '07:00',
    workdayEnd: '17:30',
    defaultAppointmentDurationMin: 90,
    reminderHoursBefore: 48,
    dueSoonThresholdDays: 2,
    quickDateOffsetsDays: [0, 1, 2, 3, 7, 14],
    allowWeekendAppointments: false,
  },
  workflow: {
    statusOrder: ['Eingang / Anfrage', 'Warteschlange', 'Terminiert', 'Erledigt'],
    sources: ['Telefon', 'SMS', 'WhatsApp', 'Messenger', 'E-Mail', 'Persoenlich', 'Post'],
  },
  persistence: {
    boardStorageKey: 'roofing-kanban-board-v2',
    dashboardLabelStorageKey: 'promanager-dashboard-label',
    dashboardSubtitleStorageKey: 'promanager-dashboard-subtitle',
    writeDebounceMs: 250,
  },
} as const;

