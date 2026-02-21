# Import/Export Versioning

## Current format

Client export (`useBoardStore.exportState`) writes:

- `formatVersion`
- `exportedAt`
- `board` (`schemaVersion`, `cardsById`, `columns`, `database`)
- `ui` (`dashboardLabel`, `dashboardSubtitle`)

Server state uses independent persistence in `server/data/state.json`.

## Migration policy

1. Increment `formatVersion` on breaking export changes
2. Keep import backwards-compatible for N-1 version when possible
3. Add normalization for missing/new fields
4. Keep `schemaVersion` migration in store middleware and server `ensureStateShape`

## Checklist for schema changes

- Add/adjust normalizer in `src/store/boardStore.ts`
- Add/adjust normalizer in `server/index.mjs` (`ensureStateShape`)
- Add regression test for import of old snapshot
- Update this document with new version notes

## Restore compatibility

- Backup files are raw server state snapshots (`state-*.json`)
- Restore path normalizes content before writeback (`ensureStateShape`)
- Invalid backups are rejected early (filename + JSON parse validation)
