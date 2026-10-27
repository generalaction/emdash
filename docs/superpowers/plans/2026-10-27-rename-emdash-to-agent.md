# Rename emdash -> Agent (plan)

1. Content: perl over `git grep -lI -i emdash` (excluding drizzle/), protecting kept tokens.
2. Paths: `git mv` every tracked path containing emdash (deepest first).
3. `pnpm install` to relink workspace packages / refresh lockfile.
4. `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`; fix collisions/failures.
