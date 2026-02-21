import type { BoardData, Source, Status, ServiceCard } from '../types/board';
import { createEmptyColumns } from '../utils/board';
import { nowIso } from '../utils/id';
import { createRecordValuesFromCardFields } from '../utils/cardValues';
import { createDefaultDatabaseSchema } from '../config/database';

type RawSeedCard = {
  id: string;
  title: string;
  status: Status;
  source: Source;
  address?: string;
  location?: string;
  phone?: string;
  date?: string | null;
  comments: Array<{ id: string; user: string; text: string }>;
};

const rawSeed: RawSeedCard[] = [
  {
    id: '1',
    title: 'Kircher Christian Oberdrauburg',
    status: 'Warteschlange',
    source: 'WhatsApp',
    address: 'Kircher Christian Oberdrauburg',
    location: 'Oberdrauburg, Kärnten, Österreich',
    phone: '+43 69910035428',
    date: null,
    comments: [
      {
        id: 'c1',
        user: 'Franz Kofler',
        text: 'Kastenrinne, Fensterbank laut Angebot montieren, wenn die Temperatur es zulässt.',
      },
    ],
  },
  {
    id: '2',
    title: 'Stegen Brustblech in Blei',
    status: 'Warteschlange',
    source: 'E-Mail',
    comments: [{ id: 'c2', user: 'System', text: 'Anfrage eingegangen' }],
  },
  {
    id: '3',
    title: 'Pascal Krabb',
    status: 'Warteschlange',
    source: 'WhatsApp',
    comments: [],
  },
];

export const createInitialBoardData = (): BoardData => {
  const columns = createEmptyColumns();
  const cardsById: Record<string, ServiceCard> = {};

  for (const item of rawSeed) {
    const createdAt = nowIso();

    const card: ServiceCard = {
      id: item.id,
      title: item.title,
      collapsed: false,
      status: item.status,
      sources: [item.source],
      address: item.address ?? item.title,
      location: item.location,
      phone: item.phone,
      date: item.date ?? null,
      comments: item.comments.map((c) => ({
        ...c,
        createdAt,
      })),
      history: [],
      createdAt,
      updatedAt: createdAt,
      values: {},
    };

    card.values = createRecordValuesFromCardFields(card);
    cardsById[item.id] = card;

    columns[item.status].push(item.id);
  }

  return {
    cardsById,
    columns,
    database: createDefaultDatabaseSchema(),
    selectedCardId: null,
  };
};
