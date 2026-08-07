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

**Status:** merged-to-wss — `dev-setup-final-fd513861` merged into `wss` 2026-08-06 (clean
merge). **The gate must not reach main/CI until the suite is green — it is still RED.**
Post-merge verification on `wss`: `pnpm run test` fails with **10 failures**, all in the
mementos family of `@emdash/emdash-desktop` (`memento-client` 7, `memento-service` 3);
`@emdash/workspace-server`, `@emdash/core`, and `@emdash/plugins` failures from the earlier
29-failure baseline are gone. Note the earlier desktop count (24) was the Electron-ABI
better-sqlite3 crash masking the real state: those tests run in the `node` vitest project,
which had no `tooling/node-deps` alias. Fixed post-merge (vitest.config.ts now applies
`toolingAlias` to the `node` project); the remaining 10 are genuine wire-refactor behavioral
failures (poke-driven invalidation after deletes, and fake-timer debounce paths time out).

- [ ] `pnpm run test` green on main verified before the gate lands — **NOT MET** (10 memento
      failures above; the gate is merged to `wss` but must not land on main until the
      wire-refactor effort fixes or quarantines them)
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
