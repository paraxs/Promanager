import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from './uiStore';

const resetUiStore = () => {
  useUiStore.setState((state) => ({
    ...state,
    searchQuery: '',
    quickFilter: 'all',
    viewMode: 'cards',
    tableColumnOrder: [],
    hiddenTableColumnIds: [],
    tableColumnFilters: {},
    tableSort: null,
    tableViewProfiles: [],
    activeTableViewProfileId: null,
  }));
};

describe('uiStore table configuration', () => {
  beforeEach(() => {
    resetUiStore();
  });

  it('sets and clears per-column filters', () => {
    const store = useUiStore.getState();

    store.setTableColumnFilter('status', 'Warteschlange');
    store.setTableColumnFilter('date', '2026-02-21');

    const withFilters = useUiStore.getState();
    expect(withFilters.tableColumnFilters).toEqual({
      status: 'Warteschlange',
      date: '2026-02-21',
    });

    withFilters.clearTableColumnFilters();
    expect(useUiStore.getState().tableColumnFilters).toEqual({});
  });

  it('stores sort state and allows reset to null', () => {
    const store = useUiStore.getState();

    store.setTableSort({ columnId: 'date', direction: 'desc' });
    expect(useUiStore.getState().tableSort).toEqual({ columnId: 'date', direction: 'desc' });

    store.setTableSort(null);
    expect(useUiStore.getState().tableSort).toBeNull();
  });

  it('saves, applies and deletes view profiles', () => {
    const store = useUiStore.getState();
    store.setTableColumnOrder(['title', 'status', 'date']);
    store.setHiddenTableColumnIds(['comments']);
    store.setTableColumnFilter('status', 'Warteschlange');
    store.setTableSort({ columnId: 'date', direction: 'asc' });

    const profileId = store.saveTableViewProfile('Disposition');
    expect(profileId).toBeTruthy();

    const profile = useUiStore.getState().tableViewProfiles.find((entry) => entry.id === profileId);
    expect(profile?.name).toBe('Disposition');
    expect(profile?.tableColumnOrder).toEqual(['title', 'status', 'date']);

    useUiStore.getState().setTableColumnOrder(['status', 'title']);
    useUiStore.getState().setHiddenTableColumnIds([]);
    useUiStore.getState().clearTableColumnFilters();
    useUiStore.getState().setTableSort(null);

    useUiStore.getState().applyTableViewProfile(profileId);
    const applied = useUiStore.getState();
    expect(applied.tableColumnOrder).toEqual(['title', 'status', 'date']);
    expect(applied.hiddenTableColumnIds).toEqual(['comments']);
    expect(applied.tableColumnFilters).toEqual({ status: 'Warteschlange' });
    expect(applied.tableSort).toEqual({ columnId: 'date', direction: 'asc' });
    expect(applied.activeTableViewProfileId).toBe(profileId);

    useUiStore.getState().deleteTableViewProfile(profileId);
    expect(useUiStore.getState().tableViewProfiles).toHaveLength(0);
    expect(useUiStore.getState().activeTableViewProfileId).toBeNull();
  });
});
