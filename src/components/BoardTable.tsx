import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, ChevronDown, ChevronUp, Filter, History, Layers3, Save, Settings2, Undo2 } from 'lucide-react';
import { APP_CONFIG } from '../config/appConfig';
import { CARD_PROPERTY_IDS } from '../config/database';
import { useBoardStore } from '../store/boardStore';
import { type TableSortDirection, type TableSortState, useUiStore } from '../store/uiStore';
import type { CardRecordValue, PropertyDefinition, ServiceCard, Status } from '../types/board';
import { STATUS_ORDER } from '../types/board';
import { cardMatchesUiFilters } from '../utils/cardFilters';
import { cx } from '../utils/cx';
import { apiFetch } from '../utils/apiClient';

type ColumnKind = 'text' | 'select' | 'date' | 'status' | 'sources' | 'comments' | 'updated' | 'actions';

type TableColumn = {
  id: string;
  label: string;
  kind: ColumnKind;
  hideable: boolean;
  property?: PropertyDefinition;
};

type UndoEntry = {
  id: string;
  label: string;
  undo: () => void;
  at: string;
};

const VIRTUALIZE_MIN_ROWS = 500;
const VIRTUAL_OVERSCAN = 8;
const ROW_HEIGHT = 62;

const normalizeSearch = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const normalizeKey = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

const textValue = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

const isoDateValue = (value: unknown): string => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '');

const isSourceProperty = (property: PropertyDefinition): boolean => {
  const key = normalizeKey(`${property.id} ${property.name}`);
  return key === 'source' || key.includes('quelle') || key.includes('kanal') || key.includes('eingang') || key.includes('herkunft');
};

const isTimeProperty = (property: PropertyDefinition): boolean => {
  if (property.type !== 'text' && property.type !== 'select') return false;
  const key = normalizeKey(`${property.id} ${property.name}`);
  return key.includes('uhrzeit') || key.includes('zeit') || key.includes('time') || key.includes('beginn') || key.includes('start');
};

const normalizeStatus = (value: unknown): Status | null => {
  if (typeof value !== 'string') return null;
  return STATUS_ORDER.find((status) => status === value) ?? null;
};

const normalizeSlotTime = (value: string): string => {
  const hhmm = /(\d{1,2}):(\d{2})/.exec(value);
  if (hhmm) {
    const hh = Number(hhmm[1]);
    const mm = Number(hhmm[2]);
    if (Number.isFinite(hh) && Number.isFinite(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }

  const hourOnly = /(\d{1,2})\s*uhr/i.exec(value);
  if (hourOnly) {
    const hh = Number(hourOnly[1]);
    if (Number.isFinite(hh) && hh >= 0 && hh <= 23) {
      return `${String(hh).padStart(2, '0')}:00`;
    }
  }

  return value.replace(/\s*uhr/i, '').trim();
};

const parseJson = <T,>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const getCardTitle = (card: ServiceCard): string => {
  const raw = card.values?.[CARD_PROPERTY_IDS.title];
  return typeof raw === 'string' && raw.trim() ? raw : card.title;
};

const getCardDate = (card: ServiceCard): string => {
  const raw = card.values?.[CARD_PROPERTY_IDS.date];
  if (typeof raw === 'string' && raw.trim()) return raw;
  return typeof card.date === 'string' && card.date.trim() ? card.date : '';
};

const getCardPropertyValue = (card: ServiceCard, propertyId: string): CardRecordValue => {
  if (propertyId === CARD_PROPERTY_IDS.title) return getCardTitle(card);
  if (propertyId === CARD_PROPERTY_IDS.status) return card.status;
  if (propertyId === CARD_PROPERTY_IDS.sources) return card.sources;
  if (propertyId === CARD_PROPERTY_IDS.address) return card.address ?? '';
  if (propertyId === CARD_PROPERTY_IDS.location) return card.location ?? '';
  if (propertyId === CARD_PROPERTY_IDS.phone) return card.phone ?? '';
  if (propertyId === CARD_PROPERTY_IDS.date) return getCardDate(card) || null;
  return card.values?.[propertyId] ?? '';
};

const recordValueToText = (value: CardRecordValue): string => {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null) return '';
  return String(value);
};

const getColumnFilterText = (card: ServiceCard, column: TableColumn): string => {
  if (column.kind === 'sources') return card.sources.join(', ');
  if (column.kind === 'comments') return `${card.comments.length} ${card.comments.map((entry) => entry.text).join(' ')}`;
  if (column.kind === 'updated') return card.updatedAt;
  if (column.kind === 'actions') return '';
  if (!column.property) return '';
  return recordValueToText(getCardPropertyValue(card, column.property.id));
};

const getSortValue = (card: ServiceCard, column: TableColumn): string | number => {
  if (column.kind === 'sources') return card.sources.join(', ');
  if (column.kind === 'comments') return card.comments.length;
  if (column.kind === 'updated') {
    const ms = Date.parse(card.updatedAt ?? '');
    return Number.isFinite(ms) ? ms : 0;
  }

  if (!column.property) return '';

  const raw = getCardPropertyValue(card, column.property.id);
  if (column.kind === 'date') {
    const iso = isoDateValue(raw);
    if (!iso) return '';
    const ms = Date.parse(`${iso}T00:00:00Z`);
    return Number.isFinite(ms) ? ms : '';
  }

  if (typeof raw === 'number') return raw;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (Array.isArray(raw)) return raw.join(', ');
  if (raw === null) return '';
  return String(raw);
};

const compareValues = (left: string | number, right: string | number): number => {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), 'de', { sensitivity: 'base', numeric: true });
};

const cycleSort = (current: TableSortState, columnId: string): TableSortState => {
  if (!current || current.columnId !== columnId) return { columnId, direction: 'asc' };
  if (current.direction === 'asc') return { columnId, direction: 'desc' };
  return null;
};

const sourceEquals = (a: string, b: string): boolean => normalizeSearch(a) === normalizeSearch(b);
const sourceInList = (sources: string[], source: string): boolean => sources.some((entry) => sourceEquals(entry, source));

const defaultColumnOrder = (columns: TableColumn[]): string[] => {
  const priority = [
    CARD_PROPERTY_IDS.title,
    CARD_PROPERTY_IDS.status,
    'sources',
    CARD_PROPERTY_IDS.date,
    CARD_PROPERTY_IDS.address,
    CARD_PROPERTY_IDS.location,
    CARD_PROPERTY_IDS.phone,
    'comments',
    'updatedAt',
    'actions',
  ];

  const seen = new Set<string>();
  const output: string[] = [];

  for (const id of priority) {
    if (!columns.some((column) => column.id === id) || seen.has(id)) continue;
    seen.add(id);
    output.push(id);
  }

  for (const column of columns) {
    if (seen.has(column.id)) continue;
    seen.add(column.id);
    output.push(column.id);
  }

  return output;
};

export function BoardTable() {
  const cardsById = useBoardStore((s) => s.cardsById);
  const boardColumns = useBoardStore((s) => s.columns);
  const database = useBoardStore((s) => s.database);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const quickFilter = useUiStore((s) => s.quickFilter);
  const tableColumnOrder = useUiStore((s) => s.tableColumnOrder);
  const hiddenTableColumnIds = useUiStore((s) => s.hiddenTableColumnIds);
  const tableColumnFilters = useUiStore((s) => s.tableColumnFilters);
  const tableSort = useUiStore((s) => s.tableSort);
  const tableViewProfiles = useUiStore((s) => s.tableViewProfiles);
  const activeTableViewProfileId = useUiStore((s) => s.activeTableViewProfileId);

  const setTableColumnOrder = useUiStore((s) => s.setTableColumnOrder);
  const setHiddenTableColumnIds = useUiStore((s) => s.setHiddenTableColumnIds);
  const setTableColumnFilter = useUiStore((s) => s.setTableColumnFilter);
  const clearTableColumnFilters = useUiStore((s) => s.clearTableColumnFilters);
  const setTableSort = useUiStore((s) => s.setTableSort);
  const resetTableColumns = useUiStore((s) => s.resetTableColumns);
  const saveTableViewProfile = useUiStore((s) => s.saveTableViewProfile);
  const applyTableViewProfile = useUiStore((s) => s.applyTableViewProfile);
  const deleteTableViewProfile = useUiStore((s) => s.deleteTableViewProfile);

  const openCard = useBoardStore((s) => s.openCard);
  const updateCard = useBoardStore((s) => s.updateCard);
  const updateCardValue = useBoardStore((s) => s.updateCardValue);
  const moveCardToStatus = useBoardStore((s) => s.moveCardToStatus);
  const hideCard = useBoardStore((s) => s.hideCard);
  const restoreCard = useBoardStore((s) => s.restoreCard);
  const addGlobalSource = useBoardStore((s) => s.addGlobalSource);
  const addComment = useBoardStore((s) => s.addComment);

  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<Status>('Warteschlange');
  const [bulkSource, setBulkSource] = useState<string>(APP_CONFIG.defaults.fallbackSource);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [auditTrail, setAuditTrail] = useState<Array<{ id: string; label: string; at: string }>>([]);
  const [isColumnMenuOpen, setIsColumnMenuOpen] = useState(false);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [rowBusyCardId, setRowBusyCardId] = useState('');
  const [rowMessages, setRowMessages] = useState<Record<string, string>>({});
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(560);

  const scrollRef = useRef<HTMLDivElement>(null);

  const allColumns = useMemo<TableColumn[]>(() => {
    const dynamicColumns: TableColumn[] = database.properties.map((property) => {
      if (property.id === CARD_PROPERTY_IDS.status) {
        return { id: property.id, label: property.name, kind: 'status', property, hideable: false };
      }
      if (property.type === 'date') {
        return { id: property.id, label: property.name, kind: 'date', property, hideable: true };
      }
      if (property.type === 'select') {
        return { id: property.id, label: property.name, kind: 'select', property, hideable: true };
      }
      return { id: property.id, label: property.name, kind: 'text', property, hideable: true };
    });

    if (!dynamicColumns.some((column) => column.id === 'sources')) {
      dynamicColumns.splice(2, 0, { id: 'sources', label: 'Quelle', kind: 'sources', hideable: true });
    }

    dynamicColumns.push({ id: 'comments', label: 'Kommentare', kind: 'comments', hideable: true });
    dynamicColumns.push({ id: 'updatedAt', label: 'Geaendert', kind: 'updated', hideable: true });
    dynamicColumns.push({ id: 'actions', label: 'Aktionen', kind: 'actions', hideable: false });

    return dynamicColumns;
  }, [database.properties]);

  const columnById = useMemo(() => new Map(allColumns.map((column) => [column.id, column])), [allColumns]);
  const initialOrder = useMemo(() => defaultColumnOrder(allColumns), [allColumns]);

  useEffect(() => {
    if (tableColumnOrder.length > 0) return;
    setTableColumnOrder(initialOrder);
  }, [initialOrder, setTableColumnOrder, tableColumnOrder.length]);

  const orderedColumnIds = useMemo(() => {
    const known = new Set(allColumns.map((column) => column.id));
    const preferred = tableColumnOrder.filter((id) => known.has(id));
    const missing = initialOrder.filter((id) => !preferred.includes(id));
    return [...preferred, ...missing];
  }, [allColumns, initialOrder, tableColumnOrder]);

  const visibleColumns = useMemo(
    () =>
      orderedColumnIds
        .map((id) => columnById.get(id))
        .filter((column): column is TableColumn => Boolean(column))
        .filter((column) => !hiddenTableColumnIds.includes(column.id)),
    [columnById, hiddenTableColumnIds, orderedColumnIds],
  );

  const sourceOptions = useMemo(() => {
    const values = new Set<string>(APP_CONFIG.workflow.sources);

    for (const property of database.properties) {
      if (property.type !== 'select' || !isSourceProperty(property)) continue;
      for (const option of property.options ?? []) {
        const trimmed = option.trim();
        if (trimmed) values.add(trimmed);
      }
    }

    for (const card of Object.values(cardsById)) {
      for (const source of card.sources) {
        const trimmed = source.trim();
        if (trimmed) values.add(trimmed);
      }
    }

    return Array.from(values).sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
  }, [cardsById, database.properties]);

  useEffect(() => {
    if (!sourceOptions.length) return;
    if (sourceInList(sourceOptions, bulkSource)) return;
    setBulkSource(sourceOptions[0]);
  }, [bulkSource, sourceOptions]);

  const timeProperty = useMemo(() => database.properties.find((property) => isTimeProperty(property)) ?? null, [database.properties]);

  const filteredCards = useMemo(() => {
    const visibleCards = Object.values(cardsById).filter((card) => !card.hiddenAt);
    const byGlobal = visibleCards.filter((card) => cardMatchesUiFilters(card, searchQuery, quickFilter));

    const byColumns = byGlobal.filter((card) => {
      for (const [columnId, filterValue] of Object.entries(tableColumnFilters)) {
        const column = columnById.get(columnId);
        if (!column) continue;

        const normalizedFilter = normalizeSearch(filterValue);
        if (!normalizedFilter) continue;

        const normalizedValue = normalizeSearch(getColumnFilterText(card, column));
        if (!normalizedValue.includes(normalizedFilter)) return false;
      }
      return true;
    });

    if (!tableSort) {
      return byColumns.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    }

    const sortColumn = columnById.get(tableSort.columnId);
    if (!sortColumn) return byColumns;

    const direction = tableSort.direction === 'desc' ? -1 : 1;
    return [...byColumns].sort((left, right) => compareValues(getSortValue(left, sortColumn), getSortValue(right, sortColumn)) * direction);
  }, [cardsById, columnById, quickFilter, searchQuery, tableColumnFilters, tableSort]);

  const visibleCardIds = useMemo(() => filteredCards.map((card) => card.id), [filteredCards]);
  const visibleCardIdSet = useMemo(() => new Set(visibleCardIds), [visibleCardIds]);

  useEffect(() => {
    setSelectedCardIds((prev) => prev.filter((id) => visibleCardIdSet.has(id)));
  }, [visibleCardIdSet]);

  const selectedVisibleIds = useMemo(() => selectedCardIds.filter((id) => visibleCardIdSet.has(id)), [selectedCardIds, visibleCardIdSet]);
  const isAllVisibleSelected = filteredCards.length > 0 && selectedVisibleIds.length === filteredCards.length;

  const isVirtualized = filteredCards.length >= VIRTUALIZE_MIN_ROWS;

  useEffect(() => {
    if (!isVirtualized) return;
    const node = scrollRef.current;
    if (!node) return;

    const updateHeight = () => setViewportHeight(node.clientHeight || 560);
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, [isVirtualized]);

  const virtualRange = useMemo(() => {
    if (!isVirtualized) return { start: 0, end: filteredCards.length, topSpacer: 0, bottomSpacer: 0 };

    const visibleCount = Math.max(1, Math.ceil(viewportHeight / ROW_HEIGHT));
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const end = Math.min(filteredCards.length, start + visibleCount + VIRTUAL_OVERSCAN * 2);
    return {
      start,
      end,
      topSpacer: start * ROW_HEIGHT,
      bottomSpacer: Math.max(0, (filteredCards.length - end) * ROW_HEIGHT),
    };
  }, [filteredCards.length, isVirtualized, scrollTop, viewportHeight]);

  const visibleRows = useMemo(() => filteredCards.slice(virtualRange.start, virtualRange.end), [filteredCards, virtualRange.end, virtualRange.start]);

  const pushUndo = (label: string, undo: () => void) => {
    const entry: UndoEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      undo,
      at: new Date().toISOString(),
    };
    setUndoStack((prev) => [entry, ...prev].slice(0, 30));
    setAuditTrail((prev) => [{ id: entry.id, label: entry.label, at: entry.at }, ...prev].slice(0, 120));
  };

  const handleUndo = () => {
    setUndoStack((prev) => {
      const [current, ...rest] = prev;
      if (!current) return prev;
      current.undo();
      setAuditTrail((trail) => [{ id: `${current.id}-undo`, label: `Rueckgaengig: ${current.label}`, at: new Date().toISOString() }, ...trail].slice(0, 120));
      return rest;
    });
  };

  const setRowMessage = (cardId: string, message: string) => {
    setRowMessages((prev) => ({ ...prev, [cardId]: message }));
  };

  const toggleCardSelection = (cardId: string, checked: boolean) => {
    setSelectedCardIds((prev) => {
      if (checked) return prev.includes(cardId) ? prev : [...prev, cardId];
      return prev.filter((id) => id !== cardId);
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    if (!checked) {
      setSelectedCardIds((prev) => prev.filter((id) => !visibleCardIdSet.has(id)));
      return;
    }

    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleCardIds) next.add(id);
      return Array.from(next);
    });
  };

  const updateRecord = (cardId: string, propertyId: string, nextValue: CardRecordValue) => {
    const card = cardsById[cardId];
    if (!card) return;
    const previousValue = getCardPropertyValue(card, propertyId);
    if (recordValueToText(previousValue) === recordValueToText(nextValue)) return;

    updateCardValue(cardId, propertyId, nextValue);
    pushUndo(`Feld ${propertyId} geaendert (${getCardTitle(card)})`, () => {
      updateCardValue(cardId, propertyId, previousValue);
    });
  };

  const updateStatus = (cardId: string, nextStatus: Status) => {
    const card = cardsById[cardId];
    if (!card || card.status === nextStatus) return;
    const previousStatus = card.status;

    moveCardToStatus(cardId, nextStatus, APP_CONFIG.defaults.actorName);
    pushUndo(`Status geaendert (${getCardTitle(card)})`, () => {
      moveCardToStatus(cardId, previousStatus, APP_CONFIG.defaults.actorName);
    });
  };

  const toggleSource = (cardId: string, source: string, checked: boolean) => {
    const card = cardsById[cardId];
    if (!card) return;

    const previousSources = [...card.sources];
    const nextSet = new Set(card.sources);
    if (checked) nextSet.add(source);
    else nextSet.delete(source);

    const nextSources = Array.from(nextSet).filter((entry) => entry.trim());
    const normalized = nextSources.length ? nextSources : [APP_CONFIG.defaults.fallbackSource];

    updateCard(cardId, { sources: normalized });
    pushUndo(`Quellen aktualisiert (${getCardTitle(card)})`, () => {
      updateCard(cardId, { sources: previousSources });
    });
  };

  const addSourceToCard = (cardId: string) => {
    const card = cardsById[cardId];
    if (!card) return;

    const input = window.prompt('Neue Quelle eingeben:', '');
    if (input === null) return;
    const source = input.trim();
    if (!source) return;

    addGlobalSource(source);
    const previousSources = [...card.sources];
    const nextSources = sourceInList(previousSources, source) ? previousSources : [...previousSources, source];

    updateCard(cardId, { sources: nextSources });
    pushUndo(`Quelle hinzugefuegt (${getCardTitle(card)})`, () => {
      updateCard(cardId, { sources: previousSources });
    });
  };

  const runBulkMove = () => {
    if (!selectedVisibleIds.length) return;

    const snapshots = selectedVisibleIds
      .map((cardId) => cardsById[cardId])
      .filter((card): card is ServiceCard => Boolean(card))
      .map((card) => ({ cardId: card.id, status: card.status }));

    for (const snapshot of snapshots) {
      moveCardToStatus(snapshot.cardId, bulkStatus, APP_CONFIG.defaults.actorName);
    }

    pushUndo(`Massenaktion: ${snapshots.length} Karten nach ${bulkStatus}`, () => {
      for (const snapshot of snapshots) {
        moveCardToStatus(snapshot.cardId, snapshot.status, APP_CONFIG.defaults.actorName);
      }
    });
  };

  const runBulkArchive = () => {
    if (!selectedVisibleIds.length) return;

    const snapshots = selectedVisibleIds
      .map((cardId) => cardsById[cardId])
      .filter((card): card is ServiceCard => Boolean(card))
      .map((card) => ({ cardId: card.id, hiddenAt: card.hiddenAt }));

    for (const snapshot of snapshots) {
      hideCard(snapshot.cardId);
    }

    pushUndo(`Massenaktion: ${snapshots.length} Karten archiviert`, () => {
      for (const snapshot of snapshots) {
        if (snapshot.hiddenAt) continue;
        restoreCard(snapshot.cardId);
      }
    });

    setSelectedCardIds([]);
  };

  const runBulkSetSource = () => {
    if (!selectedVisibleIds.length) return;
    const source = bulkSource.trim();
    if (!source) return;

    addGlobalSource(source);

    const snapshots = selectedVisibleIds
      .map((cardId) => cardsById[cardId])
      .filter((card): card is ServiceCard => Boolean(card))
      .map((card) => ({ cardId: card.id, sources: [...card.sources] }));

    for (const snapshot of snapshots) {
      updateCard(snapshot.cardId, { sources: [source] });
    }

    pushUndo(`Massenaktion: Quelle ${source} fuer ${snapshots.length} Karten`, () => {
      for (const snapshot of snapshots) {
        updateCard(snapshot.cardId, { sources: snapshot.sources });
      }
    });
  };
  const moveColumn = (columnId: string, direction: TableSortDirection) => {
    const index = orderedColumnIds.indexOf(columnId);
    if (index < 0) return;

    const target = direction === 'asc' ? Math.max(0, index - 1) : Math.min(orderedColumnIds.length - 1, index + 1);
    if (target === index) return;

    const next = [...orderedColumnIds];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setTableColumnOrder(next);
  };

  const saveProfile = () => {
    const active = tableViewProfiles.find((profile) => profile.id === activeTableViewProfileId);
    const input = window.prompt('Profilname speichern:', active?.name ?? '');
    if (!input) return;
    const name = input.trim();
    if (!name) return;
    saveTableViewProfile(name, active?.id ?? null);
  };

  const removeProfile = () => {
    if (!activeTableViewProfileId) return;
    const active = tableViewProfiles.find((profile) => profile.id === activeTableViewProfileId);
    const ok = window.confirm(`Profil "${active?.name ?? activeTableViewProfileId}" loeschen?`);
    if (!ok) return;
    deleteTableViewProfile(activeTableViewProfileId);
  };

  const applyGoogleUpdates = (updates: unknown, targetCardId?: string): number => {
    if (!Array.isArray(updates)) return 0;
    let applied = 0;

    for (const entry of updates) {
      if (!entry || typeof entry !== 'object') continue;
      const cardId = typeof (entry as { cardId?: unknown }).cardId === 'string' ? (entry as { cardId: string }).cardId : '';
      if (!cardId) continue;
      if (targetCardId && cardId !== targetCardId) continue;

      const values = (entry as { values?: unknown }).values;
      if (!values || typeof values !== 'object') continue;

      for (const [propertyId, value] of Object.entries(values as Record<string, unknown>)) {
        if (propertyId === CARD_PROPERTY_IDS.status) {
          const status = normalizeStatus(value);
          if (status) {
            moveCardToStatus(cardId, status, 'Google Sync');
            applied += 1;
          }
          continue;
        }

        if (propertyId === CARD_PROPERTY_IDS.sources && Array.isArray(value)) {
          const nextSources = value.map((entry) => textValue(entry)).filter(Boolean);
          if (nextSources.length) {
            updateCard(cardId, { sources: nextSources });
            applied += 1;
          }
          continue;
        }

        updateCardValue(cardId, propertyId, value as CardRecordValue);
        applied += 1;
      }
    }

    return applied;
  };

  const suggestSlotForCard = async (cardId: string) => {
    const card = cardsById[cardId];
    if (!card) return;

    setRowBusyCardId(cardId);
    setRowMessage(cardId, 'Suche freie Slots...');

    try {
      const response = await apiFetch('/api/google/slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timezone: APP_CONFIG.scheduling.timezone,
          workdayStart: APP_CONFIG.scheduling.workdayStart,
          workdayEnd: APP_CONFIG.scheduling.workdayEnd,
          durationMin: APP_CONFIG.scheduling.defaultAppointmentDurationMin,
          businessDays: APP_CONFIG.scheduling.businessDays,
          top: 1,
          fromDate: getCardDate(card) || null,
        }),
      });

      const raw = await response.text();
      const parsed = parseJson<{ suggestions?: Array<{ date?: string; timeLabel?: string; label?: string }>; error?: string }>(raw);
      if (!response.ok) {
        throw new Error(parsed?.error || `Slot-Suche fehlgeschlagen (${response.status})`);
      }

      const slot = parsed?.suggestions?.[0];
      const nextDate = isoDateValue(slot?.date);
      if (!nextDate) {
        setRowMessage(cardId, 'Kein Slot verfuegbar.');
        return;
      }

      const previousStatus = card.status;
      const previousDate = getCardDate(card) || null;
      const previousTime = timeProperty ? getCardPropertyValue(card, timeProperty.id) : '';

      updateCardValue(cardId, CARD_PROPERTY_IDS.date, nextDate);
      if (timeProperty && textValue(slot?.timeLabel)) {
        updateCardValue(cardId, timeProperty.id, normalizeSlotTime(textValue(slot?.timeLabel)));
      }
      if (card.status !== 'Terminiert') {
        moveCardToStatus(cardId, 'Terminiert', APP_CONFIG.defaults.actorName);
      }

      pushUndo(`Slot gesetzt (${getCardTitle(card)})`, () => {
        updateCardValue(cardId, CARD_PROPERTY_IDS.date, previousDate);
        if (timeProperty) updateCardValue(cardId, timeProperty.id, previousTime as CardRecordValue);
        if (previousStatus !== 'Terminiert') {
          moveCardToStatus(cardId, previousStatus, APP_CONFIG.defaults.actorName);
        }
      });

      addComment(cardId, `Tabellen-Slot gesetzt auf ${nextDate}.`, 'Tabellen-Assistenz');
      setRowMessage(cardId, slot?.label ? `Vorschlag: ${slot.label}` : `Vorschlag gesetzt: ${nextDate}`);
    } catch (error) {
      setRowMessage(cardId, error instanceof Error ? error.message : 'Slot-Suche fehlgeschlagen.');
    } finally {
      setRowBusyCardId('');
    }
  };

  const syncRowToGoogle = async (cardId: string) => {
    setRowBusyCardId(cardId);
    setRowMessage(cardId, 'Google Sync laeuft...');

    try {
      const response = await apiFetch('/api/google/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board: {
            cardsById,
            columns: boardColumns,
            database,
          },
          forceResync: false,
        }),
      });

      const raw = await response.text();
      const parsed = parseJson<{ updates?: unknown; errors?: Array<{ message?: string }> }>(raw);
      if (!response.ok) {
        const message = parsed?.errors?.[0]?.message || `Google Sync fehlgeschlagen (${response.status})`;
        throw new Error(message);
      }

      const applied = applyGoogleUpdates(parsed?.updates, cardId);
      setRowMessage(cardId, applied > 0 ? `Google Sync OK (${applied} Updates)` : 'Google Sync OK (keine Aenderung)');
    } catch (error) {
      setRowMessage(cardId, error instanceof Error ? error.message : 'Google Sync fehlgeschlagen.');
    } finally {
      setRowBusyCardId('');
    }
  };

  const renderCell = (card: ServiceCard, column: TableColumn) => {
    if (column.kind === 'actions') {
      const busy = rowBusyCardId === card.id;
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => openCard(card.id)} className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
            Oeffnen
          </button>
          <button
            type="button"
            onClick={() => void suggestSlotForCard(card.id)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Slot
          </button>
          <button
            type="button"
            onClick={() => void syncRowToGoogle(card.id)}
            disabled={busy}
            className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Sync
          </button>
          {rowMessages[card.id] ? <span className="text-[11px] text-gray-500">{rowMessages[card.id]}</span> : null}
        </div>
      );
    }

    if (column.kind === 'sources') {
      return (
        <details>
          <summary className="cursor-pointer list-none rounded-md border border-gray-200 bg-white px-2 py-1 text-left text-xs text-gray-700 hover:bg-gray-50">
            <div className="flex flex-wrap gap-1">
              {card.sources.map((source) => (
                <span key={`${card.id}-${source}`} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700">
                  {source}
                </span>
              ))}
            </div>
          </summary>
          <div className="mt-1 space-y-1 rounded-md border border-gray-200 bg-white p-2 text-xs shadow-sm">
            <div className="grid max-h-32 grid-cols-2 gap-1 overflow-y-auto">
              {sourceOptions.map((source) => (
                <label key={`${card.id}-source-${source}`} className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={sourceInList(card.sources, source)} onChange={(event) => toggleSource(card.id, source, event.target.checked)} />
                  <span>{source}</span>
                </label>
              ))}
            </div>
            <button type="button" onClick={() => addSourceToCard(card.id)} className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50">
              Quelle hinzufuegen
            </button>
          </div>
        </details>
      );
    }

    if (column.kind === 'comments') return <span className="text-xs text-gray-600">{card.comments.length}</span>;
    if (column.kind === 'updated') return <span className="text-xs text-gray-600">{new Date(card.updatedAt).toLocaleString('de-AT')}</span>;
    if (!column.property) return <span className="text-xs text-gray-400">-</span>;

    if (column.kind === 'status') {
      return (
        <select
          value={String(getCardPropertyValue(card, column.property.id))}
          onChange={(event) => {
            const nextStatus = normalizeStatus(event.target.value);
            if (nextStatus) updateStatus(card.id, nextStatus);
          }}
          className="min-w-[150px] rounded-md border border-gray-300 px-2 py-1 text-xs"
        >
          {STATUS_ORDER.map((status) => (
            <option key={`${card.id}-status-${status}`} value={status}>
              {status}
            </option>
          ))}
        </select>
      );
    }

    if (column.kind === 'select') {
      return (
        <select
          value={textValue(getCardPropertyValue(card, column.property.id))}
          onChange={(event) => updateRecord(card.id, column.property!.id, event.target.value)}
          className="min-w-[130px] rounded-md border border-gray-300 px-2 py-1 text-xs"
        >
          {(column.property.options ?? []).map((option) => (
            <option key={`${card.id}-${column.property?.id}-${option}`} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    if (column.kind === 'date') {
      return (
        <input
          type="date"
          defaultValue={isoDateValue(getCardPropertyValue(card, column.property.id))}
          onBlur={(event) => updateRecord(card.id, column.property!.id, event.target.value || null)}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
        />
      );
    }

    return (
      <input
        defaultValue={textValue(getCardPropertyValue(card, column.property.id))}
        onBlur={(event) => updateRecord(card.id, column.property!.id, event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          const target = event.currentTarget as HTMLInputElement;
          target.blur();
        }}
        className="w-full min-w-[120px] rounded-md border border-gray-300 px-2 py-1 text-xs"
      />
    );
  };

  return (
    <section className="mt-3 space-y-3 sm:mt-4">
      <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setIsColumnMenuOpen((prev) => !prev)} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
            <Settings2 className="h-3.5 w-3.5" />
            Spalten
          </button>
          <button type="button" onClick={saveProfile} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
            <Save className="h-3.5 w-3.5" />
            Profil speichern
          </button>
          <select
            value={activeTableViewProfileId ?? ''}
            onChange={(event) => {
              const profileId = event.target.value.trim();
              if (profileId) applyTableViewProfile(profileId);
            }}
            className="min-h-9 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs"
          >
            <option value="">Ansicht waehlen...</option>
            {tableViewProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={removeProfile} disabled={!activeTableViewProfileId} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
            Profil loeschen
          </button>
          <button type="button" onClick={() => { clearTableColumnFilters(); setTableSort(null); }} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
            <Filter className="h-3.5 w-3.5" />
            Filter/Sort reset
          </button>
          <button type="button" onClick={resetTableColumns} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
            <Layers3 className="h-3.5 w-3.5" />
            Spalten reset
          </button>
          <button type="button" onClick={handleUndo} disabled={undoStack.length === 0} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50">
            <Undo2 className="h-3.5 w-3.5" />
            Rueckgaengig
          </button>
          <button type="button" onClick={() => setIsAuditOpen((prev) => !prev)} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
            <History className="h-3.5 w-3.5" />
            Audit
          </button>
          <span className="ml-auto text-xs text-gray-500">Karten: {filteredCards.length}{isVirtualized ? ' (Virtualisierung aktiv)' : ''}</span>
        </div>

        {undoStack[0] ? <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">Letzte Aenderung: {undoStack[0].label}</p> : null}

        {isColumnMenuOpen ? (
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
            <p className="mb-2 text-xs font-semibold text-gray-700">Spalten ein-/ausblenden und Reihenfolge</p>
            <div className="space-y-1">
              {orderedColumnIds.map((columnId) => {
                const column = columnById.get(columnId);
                if (!column) return null;
                const hidden = hiddenTableColumnIds.includes(column.id);

                return (
                  <div key={`column-menu-${column.id}`} className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5">
                    <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={!hidden}
                        disabled={!column.hideable}
                        onChange={(event) => {
                          if (!column.hideable) return;
                          const checked = event.target.checked;
                          setHiddenTableColumnIds(checked ? hiddenTableColumnIds.filter((id) => id !== column.id) : [...hiddenTableColumnIds, column.id]);
                        }}
                      />
                      <span>{column.label}</span>
                    </label>
                    <div className="ml-auto flex items-center gap-1">
                      <button type="button" onClick={() => moveColumn(column.id, 'asc')} className="rounded border border-gray-200 p-1 text-gray-600 hover:bg-gray-50">
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => moveColumn(column.id, 'desc')} className="rounded border border-gray-200 p-1 text-gray-600 hover:bg-gray-50">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
          <p className="mb-2 text-xs font-semibold text-gray-700">Massenaktionen ({selectedVisibleIds.length} markiert)</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={bulkStatus}
              onChange={(event) => {
                const status = normalizeStatus(event.target.value);
                if (status) setBulkStatus(status);
              }}
              className="min-h-9 rounded-md border border-gray-300 px-2 py-1 text-xs"
            >
              {STATUS_ORDER.map((status) => (
                <option key={`bulk-status-${status}`} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <button type="button" onClick={runBulkMove} disabled={!selectedVisibleIds.length} className="min-h-9 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
              Gemeinsam verschieben
            </button>
            <select value={bulkSource} onChange={(event) => setBulkSource(event.target.value)} className="min-h-9 rounded-md border border-gray-300 px-2 py-1 text-xs">
              {sourceOptions.map((source) => (
                <option key={`bulk-source-${source}`} value={source}>
                  {source}
                </option>
              ))}
            </select>
            <button type="button" onClick={runBulkSetSource} disabled={!selectedVisibleIds.length} className="min-h-9 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
              Quelle setzen
            </button>
            <button type="button" onClick={runBulkArchive} disabled={!selectedVisibleIds.length} className="min-h-9 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50">
              Archivieren
            </button>
          </div>
        </div>
      </div>

      {isAuditOpen ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <p className="mb-2 text-sm font-semibold text-gray-900">Aenderungsverlauf (lokal)</p>
          {auditTrail.length === 0 ? <p className="text-xs text-gray-500">Noch keine Aenderungen.</p> : null}
          {auditTrail.length > 0 ? (
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {auditTrail.map((entry) => (
                <div key={entry.id} className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                  <span className="font-medium">{new Date(entry.at).toLocaleString('de-AT')}:</span> {entry.label}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={(event) => {
          if (!isVirtualized) return;
          setScrollTop(event.currentTarget.scrollTop);
        }}
        className={cx('overflow-auto rounded-xl border border-gray-200 bg-white shadow-sm', isVirtualized ? 'max-h-[70vh]' : '')}
      >
        <table className="w-full min-w-[1000px] border-collapse">
          <thead className="sticky top-0 z-10 bg-gray-50">
            <tr>
              <th className="w-10 border-b border-r border-gray-200 px-2 py-2 text-left">
                <input type="checkbox" checked={isAllVisibleSelected} onChange={(event) => toggleAllVisible(event.target.checked)} />
              </th>
              {visibleColumns.map((column) => {
                const sortDirection = tableSort?.columnId === column.id ? tableSort.direction : null;
                return (
                  <th key={`header-${column.id}`} className="border-b border-r border-gray-200 px-2 py-2 text-left align-top last:border-r-0">
                    <button type="button" onClick={() => setTableSort(cycleSort(tableSort, column.id))} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-700 hover:text-gray-900">
                      <span>{column.label}</span>
                      {sortDirection === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : null}
                      {sortDirection === 'desc' ? <ChevronDown className="h-3.5 w-3.5" /> : null}
                    </button>
                    {column.kind !== 'actions' ? (
                      <input
                        value={tableColumnFilters[column.id] ?? ''}
                        onChange={(event) => setTableColumnFilter(column.id, event.target.value)}
                        placeholder="Filter..."
                        className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-700"
                      />
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {isVirtualized && virtualRange.topSpacer > 0 ? (
              <tr>
                <td colSpan={visibleColumns.length + 1} style={{ height: virtualRange.topSpacer }} />
              </tr>
            ) : null}

            {visibleRows.map((card) => (
              <tr key={card.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                <td className="border-r border-gray-100 px-2 py-2 align-top">
                  <input type="checkbox" checked={selectedCardIds.includes(card.id)} onChange={(event) => toggleCardSelection(card.id, event.target.checked)} />
                </td>
                {visibleColumns.map((column) => (
                  <td key={`${card.id}-${column.id}`} className="border-r border-gray-100 px-2 py-2 align-top text-xs last:border-r-0">
                    {renderCell(card, column)}
                  </td>
                ))}
              </tr>
            ))}

            {isVirtualized && virtualRange.bottomSpacer > 0 ? (
              <tr>
                <td colSpan={visibleColumns.length + 1} style={{ height: virtualRange.bottomSpacer }} />
              </tr>
            ) : null}

            {!visibleRows.length ? (
              <tr>
                <td colSpan={visibleColumns.length + 1} className="px-3 py-6 text-center text-sm text-gray-500">
                  Keine Karten mit den aktuellen Filtern gefunden.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
