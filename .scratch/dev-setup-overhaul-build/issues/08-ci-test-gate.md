# 08 — CI test gate

**What to build:** PRs can no longer silently break tests: `test` joins the `nx affected`
targets in the consistency-check workflow, with the app's Playwright `browser` Vitest project
excluded from the CI run initially. Because CI installs with `--ignore-scripts`, the test job
explicitly installs the native side project before running so the DB-backed test projects work.
Decision detail: [Green-HEAD policy](../../dev-setup-overhaul/issues/09-green-head-policy.md).

**PRECONDITION (external):** HEAD's existing wire-refactor test failures (24 at the time of the
baseline) are fixed or quarantined — landing this gate on a red HEAD blocks every PR. Verify
`pnpm run test` is green on main before merging.

**Blocked by:** 07 — Flows doc (the spec sequences this strictly last), plus the external
precondition above.

**Status:** done — `dev-setup-final-fd513861` merged into `wss` 2026-08-06 (clean merge), and
the suite is **green** on `wss` as of 2026-08-06. The 10 memento failures from the post-merge
baseline (`memento-client` 7, `memento-service` 3) are fixed: one product fix in the memento
client's flush path (saves now apply an optimistic patch and sync the MobX mirror before the
local draft is dropped, so values no longer flap across the authoritative echo) plus test
updates for the kernel's intentionally-async poke-driven invalidation after deletes and the
query's timer-scheduled initial fetch under fake timers. Historical context: the earlier
desktop count (24) was the Electron-ABI better-sqlite3 crash masking the real state; the
`node` vitest project now applies `toolingAlias` (fixed post-merge in vitest.config.ts).

- [x] `pnpm run test` green on main verified before the gate lands — full workspace suite
      green on `wss` 2026-08-06 (desktop: 418 test files / 2363 tests passing, 1 skipped;
      all other packages green)
- [ ] A PR that breaks a unit test is blocked by CI; a docs-only PR is not slowed by unrelated
      test runs (affected scoping works) — by construction (`nx affected -t … test`), but only
      demonstrable on the first real PR run; watch it
- [x] Browser project excluded from the CI test run, with a note on the criteria for admitting
      it later — via `EMDASH_TEST_SKIP_BROWSER=1` (job env), which makes the app and chat-ui
      vitest configs omit their `browser` projects; **scope extension:** chat-ui's `browser`
      project is excluded too, since its `test` script also needs Playwright and CI provisions
      no browsers at all. Admission criteria: add a `pnpm exec playwright install chromium`
      step (plus browser caching), prove the browser projects stable on runners for a few
      weeks, then drop the env var
- [x] CI test job provisions the native side project despite `--ignore-scripts` —
      `pnpm --dir apps/emdash-desktop/tooling/node-deps install --frozen-lockfile` step; the
      side project's own `pnpm-workspace.yaml` allowlists the better-sqlite3 build so the
      system-Node binding is built/downloaded there
- [ ] Consistency-check wall time remains acceptable on a typical PR — unverifiable without a
      CI run (no push from this workstream); the test gate adds `^build` of affected projects
      plus the suites themselves

**First-CI-run watch items:** with `--ignore-scripts`, the repo-root `better-sqlite3` and
`node-pty` copies have no compiled bindings on the runner (node-pty also ships no Linux
prebuilds). The `node` vitest project now resolves `better-sqlite3` to the `tooling/node-deps`
copy (some slice tests open real SQLite unmocked), so the workflow's node-deps install step
covers it; `node-pty` is still only loaded mocked (e.g. `node-pty-spawner.test.ts`). The first
CI run where those packages are affected is the real proof. If a suite loads a native module
unmocked, either mock it or add a targeted `pnpm rebuild <pkg>` step.
