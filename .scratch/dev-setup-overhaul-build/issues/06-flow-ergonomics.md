# 06 — Flow ergonomics

**What to build:** three ergonomic commands the flows catalog locked. A root `pnpm run check`
runs the full merge gate (format, lint, typecheck, test) through Nx. A unified `db:generate`
dispatcher covers all five Drizzle schemas (the app schema plus the four in packages/core),
takes the target schema, and prints the follow-up obligations (fixtures regeneration, migration
tests) after generating. `db:reset` honors `EMDASH_DB_FILE` and loses its hardcoded
platform-specific paths. Decision detail:
[Flows catalog](../../dev-setup-overhaul/assets/flows-catalog.md) decisions E/F and flow 8.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] `pnpm run check` is equivalent to running the four gate commands (sequential
      `pnpm run format/lint/typecheck/test` via a portable node script)
- [x] Dispatcher generates into the correct drizzle directory for each of the five schemas and
      prints the follow-ups (unit-tested mapping + exercised live for `app` and
      `workspace-registry`)
- [x] `db:reset` deletes the right file when `EMDASH_DB_FILE` is set and the default dev DB
      otherwise; no raw `rm -f` with hardcoded mac paths (portable node script, unit-tested
      target resolution incl. sibling DBs and SQLite sidecars)
- [x] Demo: schema author generates a migration for a packages/core store via the dispatcher
      and is told exactly what to run next (`pnpm run db:generate workspace-registry` prints
      the core-test follow-up obligations)
