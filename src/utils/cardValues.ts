import { CARD_PROPERTY_IDS } from '../config/database';
import { STATUS_ORDER, type CardRecordValues, type ServiceCard, type Source, type Status } from '../types/board';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isStatus = (value: unknown): value is Status => typeof value === 'string' && STATUS_ORDER.includes(value as Status);

const normalizeSource = (value: unknown): Source | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

type CardFieldSnapshot = Pick<ServiceCard, 'title' | 'status' | 'sources' | 'address' | 'location' | 'phone' | 'date'>;

const normalizeText = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

const normalizeDate = (value: unknown, fallback: string | null): string | null =>
  typeof value === 'string' || value === null ? value : fallback;

const normalizeSources = (value: unknown, fallback: Source[]): Source[] => {
  if (!Array.isArray(value)) return fallback;
  const parsed = value.map((entry) => normalizeSource(entry)).filter((entry): entry is Source => Boolean(entry));
  return parsed.length ? parsed : fallback;
};

const normalizeStatus = (value: unknown, fallback: Status): Status => (isStatus(value) ? value : fallback);

const isRecordValue = (value: unknown): value is CardRecordValues[string] => {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every((entry) => typeof entry === 'string');
  return false;
};

export const createRecordValuesFromCardFields = (fields: CardFieldSnapshot): CardRecordValues => ({
  [CARD_PROPERTY_IDS.title]: fields.title,
  [CARD_PROPERTY_IDS.status]: fields.status,
  [CARD_PROPERTY_IDS.sources]: fields.sources,
  [CARD_PROPERTY_IDS.address]: fields.address ?? '',
  [CARD_PROPERTY_IDS.location]: fields.location ?? '',
  [CARD_PROPERTY_IDS.phone]: fields.phone ?? '',
  [CARD_PROPERTY_IDS.date]: fields.date ?? null,
});

export const normalizeRecordValues = (
  rawValues: unknown,
  fallbackFromFields: CardFieldSnapshot,
): { values: CardRecordValues; fields: CardFieldSnapshot } => {
  const sanitizedRaw: CardRecordValues = {};
  if (isObject(rawValues)) {
    for (const [key, value] of Object.entries(rawValues)) {
      if (isRecordValue(value)) sanitizedRaw[key] = value;
    }
  }

  const title = normalizeText(sanitizedRaw[CARD_PROPERTY_IDS.title], fallbackFromFields.title);
  const status = normalizeStatus(sanitizedRaw[CARD_PROPERTY_IDS.status], fallbackFromFields.status);
  const sources = normalizeSources(sanitizedRaw[CARD_PROPERTY_IDS.sources], fallbackFromFields.sources);
  const address = normalizeText(sanitizedRaw[CARD_PROPERTY_IDS.address], fallbackFromFields.address ?? '');
  const location = normalizeText(sanitizedRaw[CARD_PROPERTY_IDS.location], fallbackFromFields.location ?? '');
  const phone = normalizeText(sanitizedRaw[CARD_PROPERTY_IDS.phone], fallbackFromFields.phone ?? '');
  const date = normalizeDate(sanitizedRaw[CARD_PROPERTY_IDS.date], fallbackFromFields.date ?? null);

  const fields: CardFieldSnapshot = {
    title,
    status,
    sources,
    address,
    location,
    phone,
    date,
  };

  return {
    values: {
      ...sanitizedRaw,
      ...createRecordValuesFromCardFields(fields),
    },
    fields,
  };
};
