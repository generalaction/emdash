# Risky Area: Database

## Main Files

- `src/main/services/DatabaseService.ts`
- `src/main/db/schema.ts`
- `src/main/db/`
- `drizzle/`

## Rules

- never hand-edit numbered migrations
- never hand-edit `drizzle/meta/`
- use `pnpm exec drizzle-kit generate` for new migrations
- treat schema invariants and data migrations as high risk

## Current Behavior

- database path is resolved by main-process db path helpers
- `EMDASH_DB_FILE` overrides the default location
- `DatabaseService.initialize()` validates schema expectations and can trigger a local reset flow on incompatibility

## Verify With

```bash
sed -n '1,240p' src/main/services/DatabaseService.ts
sed -n '1,240p' src/main/db/schema.ts
```
