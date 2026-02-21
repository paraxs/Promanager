import { create } from 'zustand';

export type CardQuickFilter = 'all' | 'overdue' | 'today_tomorrow' | 'missing_core';
export type BoardViewMode = 'cards' | 'table';
export type TableSortDirection = 'asc' | 'desc';
export type TableSortState = {
  columnId: string;
  direction: TableSortDirection;
} | null;

export type TableViewProfile = {
  id: string;
  name: string;
  tableColumnOrder: string[];
  hiddenTableColumnIds: string[];
  tableColumnFilters: Record<string, string>;
  tableSort: TableSortState;
};

const UI_STORE_STORAGE_KEY = 'promanager-ui-store-v2';

type UiStoreState = {
  searchQuery: string;
  quickFilter: CardQuickFilter;
  viewMode: BoardViewMode;
  tableColumnOrder: string[];
  hiddenTableColumnIds: string[];
  tableColumnFilters: Record<string, string>;
  tableSort: TableSortState;
  tableViewProfiles: TableViewProfile[];
  activeTableViewProfileId: string | null;
};

type UiStoreActions = {
  setSearchQuery: (query: string) => void;
  setQuickFilter: (filter: CardQuickFilter) => void;
  setViewMode: (mode: BoardViewMode) => void;
  setTableColumnOrder: (order: string[]) => void;
  setHiddenTableColumnIds: (ids: string[]) => void;
  setTableColumnFilter: (columnId: string, value: string) => void;
  setTableColumnFilters: (filters: Record<string, string>) => void;
  clearTableColumnFilters: () => void;
  setTableSort: (sort: TableSortState) => void;
  resetTableColumns: () => void;
  saveTableViewProfile: (name: string, profileId?: string | null) => string;
  applyTableViewProfile: (profileId: string) => void;
  deleteTableViewProfile: (profileId: string) => void;
  clearFilters: () => void;
};

export type UiStore = UiStoreState & UiStoreActions;

type PersistedUiStore = {
  viewMode: BoardViewMode;
  tableColumnOrder: string[];
  hiddenTableColumnIds: string[];
  tableColumnFilters: Record<string, string>;
  tableSort: TableSortState;
  tableViewProfiles: TableViewProfile[];
  activeTableViewProfileId: string | null;
};

const isBoardViewMode = (value: unknown): value is BoardViewMode => value === 'cards' || value === 'table';

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
};

const normalizeFilters = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object') return {};
  const next: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof key !== 'string' || typeof raw !== 'string') continue;
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    const normalizedValue = raw.trim();
    if (!normalizedValue) continue;
    next[normalizedKey] = normalizedValue;
  }
  return next;
};

const normalizeSort = (value: unknown): TableSortState => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<{ columnId: string; direction: TableSortDirection }>;
  const columnId = typeof candidate.columnId === 'string' ? candidate.columnId.trim() : '';
  const direction = candidate.direction;
  if (!columnId) return null;
  if (direction !== 'asc' && direction !== 'desc') return null;
  return { columnId, direction };
};

const toProfileId = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '') || `view-${Date.now()}`;

const normalizeProfiles = (value: unknown): TableViewProfile[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: TableViewProfile[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Partial<TableViewProfile>;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    next.push({
      id,
      name,
      tableColumnOrder: normalizeStringArray(raw.tableColumnOrder),
      hiddenTableColumnIds: normalizeStringArray(raw.hiddenTableColumnIds),
      tableColumnFilters: normalizeFilters(raw.tableColumnFilters),
      tableSort: normalizeSort(raw.tableSort),
    });
  }
  return next;
};

const defaultPersistedState = (): PersistedUiStore => ({
  viewMode: 'cards',
  tableColumnOrder: [],
  hiddenTableColumnIds: [],
  tableColumnFilters: {},
  tableSort: null,
  tableViewProfiles: [],
  activeTableViewProfileId: null,
});

const readPersistedUiStore = (): PersistedUiStore => {
  if (typeof window === 'undefined') return defaultPersistedState();
  try {
    const raw = window.localStorage.getItem(UI_STORE_STORAGE_KEY);
    if (!raw) return defaultPersistedState();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return defaultPersistedState();
    const data = parsed as Partial<PersistedUiStore>;
    const tableViewProfiles = normalizeProfiles(data.tableViewProfiles);
    const profileIds = new Set(tableViewProfiles.map((profile) => profile.id));
    const activeTableViewProfileId =
      typeof data.activeTableViewProfileId === 'string' && profileIds.has(data.activeTableViewProfileId)
        ? data.activeTableViewProfileId
        : null;
    return {
      viewMode: isBoardViewMode(data.viewMode) ? data.viewMode : 'cards',
      tableColumnOrder: normalizeStringArray(data.tableColumnOrder),
      hiddenTableColumnIds: normalizeStringArray(data.hiddenTableColumnIds),
      tableColumnFilters: normalizeFilters(data.tableColumnFilters),
      tableSort: normalizeSort(data.tableSort),
      tableViewProfiles,
      activeTableViewProfileId,
    };
  } catch {
    return defaultPersistedState();
  }
};

const persistUiStore = (
  state: Pick<
    UiStoreState,
    | 'viewMode'
    | 'tableColumnOrder'
    | 'hiddenTableColumnIds'
    | 'tableColumnFilters'
    | 'tableSort'
    | 'tableViewProfiles'
    | 'activeTableViewProfileId'
  >,
): void => {
  if (typeof window === 'undefined') return;
  try {
    const payload: PersistedUiStore = {
      viewMode: state.viewMode,
      tableColumnOrder: normalizeStringArray(state.tableColumnOrder),
      hiddenTableColumnIds: normalizeStringArray(state.hiddenTableColumnIds),
      tableColumnFilters: normalizeFilters(state.tableColumnFilters),
      tableSort: normalizeSort(state.tableSort),
      tableViewProfiles: normalizeProfiles(state.tableViewProfiles),
      activeTableViewProfileId: state.activeTableViewProfileId,
    };
    window.localStorage.setItem(UI_STORE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage issues.
  }
};

const persistedDefaults = readPersistedUiStore();

const persistFromState = (state: UiStoreState): void => {
  persistUiStore({
    viewMode: state.viewMode,
    tableColumnOrder: state.tableColumnOrder,
    hiddenTableColumnIds: state.hiddenTableColumnIds,
    tableColumnFilters: state.tableColumnFilters,
    tableSort: state.tableSort,
    tableViewProfiles: state.tableViewProfiles,
    activeTableViewProfileId: state.activeTableViewProfileId,
  });
};

export const useUiStore = create<UiStore>((set) => ({
  searchQuery: '',
  quickFilter: 'all',
  viewMode: persistedDefaults.viewMode,
  tableColumnOrder: persistedDefaults.tableColumnOrder,
  hiddenTableColumnIds: persistedDefaults.hiddenTableColumnIds,
  tableColumnFilters: persistedDefaults.tableColumnFilters,
  tableSort: persistedDefaults.tableSort,
  tableViewProfiles: persistedDefaults.tableViewProfiles,
  activeTableViewProfileId: persistedDefaults.activeTableViewProfileId,

  setSearchQuery: (query) => set({ searchQuery: query }),
  setQuickFilter: (filter) => set({ quickFilter: filter }),

  setViewMode: (mode) =>
    set((state) => {
      const next: UiStoreState = { ...state, viewMode: mode };
      persistFromState(next);
      return { viewMode: mode };
    }),

  setTableColumnOrder: (order) =>
    set((state) => {
      const tableColumnOrder = normalizeStringArray(order);
      const next: UiStoreState = { ...state, tableColumnOrder };
      persistFromState(next);
      return { tableColumnOrder };
    }),

  setHiddenTableColumnIds: (ids) =>
    set((state) => {
      const hiddenTableColumnIds = normalizeStringArray(ids);
      const next: UiStoreState = { ...state, hiddenTableColumnIds };
      persistFromState(next);
      return { hiddenTableColumnIds };
    }),

  setTableColumnFilter: (columnId, value) =>
    set((state) => {
      const key = columnId.trim();
      if (!key) return {};
      const nextFilters = { ...state.tableColumnFilters };
      const normalized = value.trim();
      if (!normalized) delete nextFilters[key];
      else nextFilters[key] = normalized;

      const next: UiStoreState = { ...state, tableColumnFilters: nextFilters };
      persistFromState(next);
      return { tableColumnFilters: nextFilters };
    }),

  setTableColumnFilters: (filters) =>
    set((state) => {
      const tableColumnFilters = normalizeFilters(filters);
      const next: UiStoreState = { ...state, tableColumnFilters };
      persistFromState(next);
      return { tableColumnFilters };
    }),

  clearTableColumnFilters: () =>
    set((state) => {
      const next: UiStoreState = { ...state, tableColumnFilters: {} };
      persistFromState(next);
      return { tableColumnFilters: {} };
    }),

  setTableSort: (sort) =>
    set((state) => {
      const tableSort = normalizeSort(sort);
      const next: UiStoreState = { ...state, tableSort };
      persistFromState(next);
      return { tableSort };
    }),

  resetTableColumns: () =>
    set((state) => {
      const next: UiStoreState = {
        ...state,
        tableColumnOrder: [],
        hiddenTableColumnIds: [],
        tableColumnFilters: {},
        tableSort: null,
        activeTableViewProfileId: null,
      };
      persistFromState(next);
      return {
        tableColumnOrder: [],
        hiddenTableColumnIds: [],
        tableColumnFilters: {},
        tableSort: null,
        activeTableViewProfileId: null,
      };
    }),

  saveTableViewProfile: (name, profileId) => {
    const normalizedName = name.trim();
    if (!normalizedName) return '';
    const targetId = (profileId ?? '').trim() || toProfileId(normalizedName);
    set((state) => {
      const profile: TableViewProfile = {
        id: targetId,
        name: normalizedName,
        tableColumnOrder: state.tableColumnOrder,
        hiddenTableColumnIds: state.hiddenTableColumnIds,
        tableColumnFilters: state.tableColumnFilters,
        tableSort: state.tableSort,
      };

      const existingIdx = state.tableViewProfiles.findIndex((entry) => entry.id === targetId);
      const tableViewProfiles =
        existingIdx >= 0
          ? state.tableViewProfiles.map((entry, idx) => (idx === existingIdx ? profile : entry))
          : [...state.tableViewProfiles, profile];

      const next: UiStoreState = { ...state, tableViewProfiles, activeTableViewProfileId: targetId };
      persistFromState(next);
      return { tableViewProfiles, activeTableViewProfileId: targetId };
    });
    return targetId;
  },

  applyTableViewProfile: (profileId) =>
    set((state) => {
      const profile = state.tableViewProfiles.find((entry) => entry.id === profileId);
      if (!profile) return {};
      const next: UiStoreState = {
        ...state,
        tableColumnOrder: profile.tableColumnOrder,
        hiddenTableColumnIds: profile.hiddenTableColumnIds,
        tableColumnFilters: profile.tableColumnFilters,
        tableSort: profile.tableSort,
        activeTableViewProfileId: profile.id,
      };
      persistFromState(next);
      return {
        tableColumnOrder: profile.tableColumnOrder,
        hiddenTableColumnIds: profile.hiddenTableColumnIds,
        tableColumnFilters: profile.tableColumnFilters,
        tableSort: profile.tableSort,
        activeTableViewProfileId: profile.id,
      };
    }),

  deleteTableViewProfile: (profileId) =>
    set((state) => {
      const tableViewProfiles = state.tableViewProfiles.filter((profile) => profile.id !== profileId);
      const activeTableViewProfileId =
        state.activeTableViewProfileId === profileId ? null : state.activeTableViewProfileId;
      const next: UiStoreState = { ...state, tableViewProfiles, activeTableViewProfileId };
      persistFromState(next);
      return { tableViewProfiles, activeTableViewProfileId };
    }),

  clearFilters: () => set({ searchQuery: '', quickFilter: 'all' }),
}));
