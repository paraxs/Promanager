export const STATUS_ORDER = [
  'Eingang / Anfrage',
  'Warteschlange',
  'Terminiert',
  'Erledigt',
] as const;

export type Status = (typeof STATUS_ORDER)[number];

export const SOURCES = ['WhatsApp', 'E-Mail'] as const;
export type Source = (typeof SOURCES)[number];

export interface BoardComment {
  id: string;
  user: string;
  text: string;
  createdAt: string;
  timeLabel?: string;
}

export interface StatusHistoryEntry {
  id: string;
  cardId: string;
  from: Status;
  to: Status;
  movedAt: string;
  movedBy: string;
}

export interface ServiceCard {
  id: string;
  title: string;
  status: Status;
  sources: Source[];
  address?: string;
  location?: string;
  phone?: string;
  date?: string | null;
  hiddenAt?: string | null;
  comments: BoardComment[];
  history: StatusHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export type Columns = Record<Status, string[]>;

export interface BoardData {
  cardsById: Record<string, ServiceCard>;
  columns: Columns;
  selectedCardId: string | null;
}

export interface PersistedBoardV2 {
  schemaVersion: 2;
  cardsById: Record<string, ServiceCard>;
  columns: Columns;
}
