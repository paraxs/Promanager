import { CARD_PROPERTY_IDS } from '../config/database';
import type { ServiceCard } from '../types/board';
import type { CardQuickFilter } from '../store/uiStore';
import { getAppointmentBadge } from './scheduling';

const normalize = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const includesNormalized = (haystack: string[], query: string): boolean => {
  const normalizedQuery = normalize(query).trim();
  if (!normalizedQuery) return true;
  return haystack.some((entry) => normalize(entry).includes(normalizedQuery));
};

const getCardDateValue = (card: ServiceCard): string | null => {
  const raw = card.values?.[CARD_PROPERTY_IDS.date];
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (typeof card.date === 'string' && card.date.trim()) return card.date;
  return null;
};

const hasMissingCoreData = (card: ServiceCard): boolean => {
  const hasAddress = typeof card.address === 'string' && card.address.trim().length > 0;
  const hasPhone = typeof card.phone === 'string' && card.phone.trim().length > 0;
  const hasSource = Array.isArray(card.sources) && card.sources.some((entry) => entry.trim().length > 0);
  return !hasSource || !hasAddress || !hasPhone;
};

const matchesQuickFilter = (card: ServiceCard, quickFilter: CardQuickFilter): boolean => {
  if (quickFilter === 'all') return true;

  const dateValue = getCardDateValue(card);
  const badge = getAppointmentBadge(dateValue);

  if (quickFilter === 'overdue') {
    return badge?.tone === 'overdue';
  }

  if (quickFilter === 'today_tomorrow') {
    return badge?.tone === 'today' || badge?.tone === 'tomorrow';
  }

  if (quickFilter === 'missing_core') {
    return hasMissingCoreData(card);
  }

  return true;
};

const matchesSearchQuery = (card: ServiceCard, query: string): boolean => {
  if (!query.trim()) return true;

  const searchableValues = [
    card.title,
    card.status,
    card.address ?? '',
    card.location ?? '',
    card.phone ?? '',
    card.date ?? '',
    ...(card.sources ?? []),
    ...card.comments.map((comment) => comment.text),
  ];

  return includesNormalized(searchableValues, query);
};

export const cardMatchesUiFilters = (card: ServiceCard, query: string, quickFilter: CardQuickFilter): boolean =>
  matchesSearchQuery(card, query) && matchesQuickFilter(card, quickFilter);

