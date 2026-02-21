import { APP_CONFIG } from './appConfig';
import type { BoardDatabaseSchema, PropertyDefinition, PropertyType } from '../types/board';

export const CARD_PROPERTY_IDS = {
  title: 'title',
  status: 'status',
  sources: 'sources',
  address: 'address',
  location: 'location',
  phone: 'phone',
  date: 'date',
} as const;

export const RUNTIME_PROPERTY_TYPES: PropertyType[] = ['text', 'select', 'date'];

export const DEFAULT_SELECT_OPTIONS: Record<string, string[]> = {
  [CARD_PROPERTY_IDS.status]: [...APP_CONFIG.workflow.statusOrder],
};

export const DEFAULT_DATABASE_PROPERTIES: PropertyDefinition[] = [
  { id: CARD_PROPERTY_IDS.title, name: 'Titel', type: 'text', required: true, system: true },
  {
    id: CARD_PROPERTY_IDS.status,
    name: 'Status',
    type: 'select',
    required: true,
    system: true,
    options: [...APP_CONFIG.workflow.statusOrder],
  },
  { id: CARD_PROPERTY_IDS.address, name: 'Adresse', type: 'text', system: true },
  { id: CARD_PROPERTY_IDS.location, name: 'Ort', type: 'text', system: true },
  { id: CARD_PROPERTY_IDS.phone, name: 'Telefon', type: 'text', system: true },
  { id: CARD_PROPERTY_IDS.date, name: 'Datum', type: 'date', system: true },
];

export const DEFAULT_DATABASE_SCHEMA: BoardDatabaseSchema = {
  id: 'service-card-db',
  name: 'Service Cards',
  properties: DEFAULT_DATABASE_PROPERTIES.map((property) => ({ ...property, options: property.options?.slice() })),
};

export const createDefaultDatabaseSchema = (): BoardDatabaseSchema => ({
  id: DEFAULT_DATABASE_SCHEMA.id,
  name: DEFAULT_DATABASE_SCHEMA.name,
  properties: DEFAULT_DATABASE_SCHEMA.properties.map((property) => ({
    ...property,
    options: property.options?.slice(),
  })),
});
