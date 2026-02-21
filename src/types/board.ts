import { APP_CONFIG } from '../config/appConfig';

export const STATUS_ORDER = APP_CONFIG.workflow.statusOrder;

export type Status = (typeof STATUS_ORDER)[number];

export const SOURCES = APP_CONFIG.workflow.sources;
export type Source = string;

export interface BoardComment {
  id: string;
  user: string;
  text: string;
  createdAt: string;
}

export interface StatusHistoryEntry {
  id: string;
  cardId: string;
  from: Status;
  to: Status;
  movedAt: string;
  movedBy: string;
}

export type PropertyType = 'text' | 'select' | 'multi_select' | 'date' | 'number' | 'checkbox';

export interface PropertyDefinition {
  id: string;
  name: string;
  type: PropertyType;
  required?: boolean;
  options?: string[];
  system?: boolean;
}

export type PropertyScalarValue = string | number | boolean | null;

export type CardRecordValue = PropertyScalarValue | string[];

export type CardRecordValues = Record<string, CardRecordValue>;

export interface BoardDatabaseSchema {
  id: string;
  name: string;
  properties: PropertyDefinition[];
}

export interface ServiceCard {
  id: string;
  title: string;
  collapsed?: boolean;
  status: Status;
  sources: Source[];
  address?: string;
  location?: string;
  phone?: string;
  date?: string | null;
  hiddenAt?: string | null;
  values: CardRecordValues;
  comments: BoardComment[];
  history: StatusHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export type Columns = Record<Status, string[]>;

export interface BoardData {
  cardsById: Record<string, ServiceCard>;
  columns: Columns;
  database: BoardDatabaseSchema;
  selectedCardId: string | null;
}

export interface PersistedBoardV2 {
  schemaVersion: 2;
  cardsById: Record<string, ServiceCard>;
  columns: Columns;
  database?: BoardDatabaseSchema;
}

export interface WorkspaceUiSettings {
  dashboardLabel: string;
  dashboardSubtitle: string;
}

export interface WorkspaceExportV1 {
  formatVersion: 1;
  exportedAt: string;
  board: PersistedBoardV2;
  ui: WorkspaceUiSettings;
}

export interface WorkspaceExportV2 {
  formatVersion: 2;
  exportedAt: string;
  board: PersistedBoardV2;
  ui: WorkspaceUiSettings;
  database: BoardDatabaseSchema;
}

export type WorkspaceExportPayload = WorkspaceExportV1 | WorkspaceExportV2;
