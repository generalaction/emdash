# Risky Area: Database

## Main Files

- `src/main/db/schema.ts`
- `src/main/db/initialize.ts`
- `drizzle/`

## Rules

- never hand-edit numbered migrations
- never hand-edit `drizzle/meta/`
- use `pnpm exec drizzle-kit generate` for new migrations
- treat schema invariants and data migrations as high risk

## Current Behavior

- database path is resolved by main-process db path helpers
- `EMDASH_DB_FILE` overrides the default location
- database initialization happens in `src/main/db/initialize.ts`

## Development Workflow

### Tooling folder

All dev and test infrastructure lives in `tooling/` at the repo root. Nothing
in `tooling/` is part of the production Electron bundle — the `@tooling` alias
only exists in `vitest.config.ts`, not in `electron.vite.config.ts`.

```
tooling/
├── byoi/               SSH BYOI provisioning (Docker)
├── docker-ssh/         SSH test container (Docker)
├── db/                 gitignored — per-developer dev database
├── fixtures/           committed SQLite snapshots (empty.db, baseline.db)
├── seeds/              seed functions that populate fixtures
├── generate-fixtures.ts  fixture generator script (run via vitest)
└── utils/
    └── db.ts           openFixture() helper for migration tests
```

### Isolated dev database

Use `pnpm run db:dev` instead of `pnpm run dev` when working on migrations.
This writes to `tooling/db/dev.db` (gitignored) instead of your personal
emdash database, so schema experiments cannot corrupt your real app data.

```bash
pnpm run db:dev        # start app with isolated dev database
pnpm run db:dev:reset  # wipe the dev database and start fresh
```

### Fixture databases

Two committed SQLite snapshots live in `tooling/fixtures/`:

- `empty.db` — all migrations applied, no data
- `baseline.db` — 2 projects, 4 tasks, conversations (see seeds in `tooling/seeds/`)

Regenerate after any schema change:

```bash
pnpm run db:fixtures   # rebuilds better-sqlite3 for Node, writes .db files
pnpm run rebuild       # restore better-sqlite3 for Electron after running db:fixtures
```

> **Note:** `pnpm run db:fixtures` rebuilds `better-sqlite3` for system Node so
> Vitest can load it. After running it, the Electron app needs `pnpm run rebuild`
> to restore Electron compatibility.

### Migration authoring checklist

1. **Isolate your dev DB**: run `pnpm run db:dev` so you're working against `tooling/db/dev.db`

2. **Snapshot the pre-migration baseline**:
   ```bash
   cp tooling/fixtures/baseline.db tooling/fixtures/pre-XXXX.db
   ```
   Commit this snapshot. It is the starting state your migration test will run against.

3. **Write the migration**: edit `src/main/db/schema.ts`, then generate the SQL:
   ```bash
   pnpm run db:generate
   ```

4. **Write a migration test** in `src/main/db/__tests__/migrations/` using `openFixture('pre-XXXX')`.
   See `example.test.ts` in that directory for the pattern.

5. **Regenerate fixtures** so `baseline.db` and `empty.db` include the new schema:
   ```bash
   pnpm run db:fixtures
   pnpm run rebuild
   ```

6. **Run migration tests**:
   ```bash
   pnpm run test:migrations
   pnpm run rebuild   # restore Electron after the test run
   ```

7. **Commit everything together**: migration SQL (`drizzle/`), `drizzle/meta/`,
   `pre-XXXX.db`, updated `tooling/fixtures/*.db`, the migration test.

### Testing utilities

- `openFixture(name)` in `tooling/utils/db.ts` — copies a named fixture to a
  temp file, applies any pending migrations (via our own `initializeDatabase()`),
  returns a `DrizzleClient`. Each call is fully isolated; `close()` deletes the temp file.
  Import via `@tooling/utils/db` (alias available in all Vitest projects).
- Migration tests live in `src/main/db/__tests__/migrations/` and run via
  `pnpm run test:migrations` (separate from the main test suite because they
  require `better-sqlite3` compiled for system Node).
