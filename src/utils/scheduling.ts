import { APP_CONFIG } from '../config/appConfig';

const DAY_MS = 24 * 60 * 60 * 1000;

type DateParts = {
  year: number;
  month: number;
  day: number;
};

export type AppointmentBadgeTone = 'overdue' | 'today' | 'tomorrow' | 'soon' | 'planned' | 'invalid';

export type AppointmentBadge = {
  label: string;
  tone: AppointmentBadgeTone;
  isBusinessDay: boolean;
};

const weekdayLabelByIndex: Record<number, string> = {
  0: 'So',
  1: 'Mo',
  2: 'Di',
  3: 'Mi',
  4: 'Do',
  5: 'Fr',
  6: 'Sa',
};

const pad = (value: number): string => String(value).padStart(2, '0');

const datePartsFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: APP_CONFIG.scheduling.timezone,
});

const formatDatePartsAsIso = ({ year, month, day }: DateParts): string => `${year}-${pad(month)}-${pad(day)}`;

const parseIsoDateParts = (value: string): DateParts | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return { year, month, day };
};

const toEpochDay = ({ year, month, day }: DateParts): number => Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);

const addDays = ({ year, month, day }: DateParts, offsetDays: number): DateParts => {
  const date = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

const getTodayInConfiguredTimezone = (): DateParts => {
  const map: Partial<Record<'year' | 'month' | 'day', string>> = {};

  for (const part of datePartsFormatter.formatToParts(new Date())) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      map[part.type] = part.value;
    }
  }

  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);

  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    const local = new Date();
    return {
      year: local.getFullYear(),
      month: local.getMonth() + 1,
      day: local.getDate(),
    };
  }

  return { year, month, day };
};

const getDaysFromToday = (value: string): number | null => {
  const target = parseIsoDateParts(value);
  if (!target) return null;

  return toEpochDay(target) - toEpochDay(getTodayInConfiguredTimezone());
};

export const createDateInputFromTodayOffset = (offsetDays: number): string => {
  const date = addDays(getTodayInConfiguredTimezone(), offsetDays);
  return formatDatePartsAsIso(date);
};

export const getQuickDateLabel = (offsetDays: number): string => {
  if (offsetDays === 0) return 'Heute';
  if (offsetDays === 1) return 'Morgen';
  if (offsetDays > 1) return `+${offsetDays} Tage`;
  return `${offsetDays} Tage`;
};

export const isBusinessDay = (dateValue: string): boolean => {
  const parsed = parseIsoDateParts(dateValue);
  if (!parsed) return true;

  const day = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
  return APP_CONFIG.scheduling.businessDays.includes(day as (typeof APP_CONFIG.scheduling.businessDays)[number]);
};

export const getBusinessDaysLabel = (): string =>
  APP_CONFIG.scheduling.businessDays.map((day) => weekdayLabelByIndex[day] ?? '?').join(', ');

export const getAppointmentBadge = (dateValue: string | null | undefined): AppointmentBadge | null => {
  if (!dateValue) return null;

  const parsed = parseIsoDateParts(dateValue);
  if (!parsed) {
    return {
      label: 'Ungueltiges Datum',
      tone: 'invalid',
      isBusinessDay: true,
    };
  }

  const isWorkingDay = isBusinessDay(dateValue);
  const daysFromToday = getDaysFromToday(dateValue);

  if (daysFromToday === null) {
    return {
      label: 'Ungueltiges Datum',
      tone: 'invalid',
      isBusinessDay: isWorkingDay,
    };
  }

  if (daysFromToday < 0) {
    const overdueDays = Math.abs(daysFromToday);
    return {
      label: overdueDays === 1 ? '1 Tag ueberfaellig' : `${overdueDays} Tage ueberfaellig`,
      tone: 'overdue',
      isBusinessDay: isWorkingDay,
    };
  }

  if (daysFromToday === 0) {
    return {
      label: 'Heute',
      tone: 'today',
      isBusinessDay: isWorkingDay,
    };
  }

  if (daysFromToday === 1) {
    return {
      label: 'Morgen',
      tone: 'tomorrow',
      isBusinessDay: isWorkingDay,
    };
  }

  if (daysFromToday <= APP_CONFIG.scheduling.dueSoonThresholdDays) {
    return {
      label: `In ${daysFromToday} Tagen`,
      tone: 'soon',
      isBusinessDay: isWorkingDay,
    };
  }

  const formatter = new Intl.DateTimeFormat(APP_CONFIG.scheduling.locale, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });

  return {
    label: formatter.format(new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day))),
    tone: 'planned',
    isBusinessDay: isWorkingDay,
  };
};
