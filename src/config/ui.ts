import type { Source, Status } from '../types/board';

export const STATUS_UI: Record<
  Status,
  {
    chip: string;
    column: string;
    emptyText: string;
  }
> = {
  'Eingang / Anfrage': {
    chip: 'bg-red-100 text-red-800',
    column: 'bg-red-50/60 border-red-100',
    emptyText: 'Noch keine Anfrage',
  },
  Warteschlange: {
    chip: 'bg-blue-100 text-blue-800',
    column: 'bg-blue-50/60 border-blue-100',
    emptyText: 'Noch kein Eintrag',
  },
  Terminiert: {
    chip: 'bg-violet-100 text-violet-800',
    column: 'bg-violet-50/60 border-violet-100',
    emptyText: 'Noch kein Termin',
  },
  Erledigt: {
    chip: 'bg-emerald-100 text-emerald-800',
    column: 'bg-emerald-50/60 border-emerald-100',
    emptyText: 'Noch nichts erledigt',
  },
};

export const SOURCE_UI: Record<Source, string> = {
  WhatsApp: 'bg-purple-100 text-purple-800',
  'E-Mail': 'bg-rose-100 text-rose-800',
};
