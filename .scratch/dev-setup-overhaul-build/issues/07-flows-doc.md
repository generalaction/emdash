# 07 — Flows doc

**What to build:** the permanent flows index at `agents/workflows/flows.md`, generated from the
locked [flows catalog](../../dev-setup-overhaul/assets/flows-catalog.md): every first-class flow
with its one blessed command, prerequisites expressed as "run the doctor", the escape-hatch/env-var
table, and the five-schema layout table. AGENTS.md shrinks to golden-path commands plus a link,
with duplicated per-flow mentions removed and one Storybook invocation style everywhere. This
ticket also runs the two flagged ordering verifications — app-only dev on a never-built clone,
and Storybook as the first command after install — fixing failures via Nx dependency wiring
(not doc warnings) and documenting the result.

**Blocked by:** 01, 02, 03, 04, 05, 06 — every command the doc names must exist first.

**Status:** done

- [x] Every command in the doc exists and runs as written
- [x] Escape-hatch/env-var table and five-schema table present
- [x] AGENTS.md trimmed and linking; no contradictions between it and the flows doc
      (single Storybook invocation style — `pnpm --filter <pkg> run storybook` — everywhere)
- [x] Both ordering verifications performed; any failure fixed via task wiring and covered in
      the doc — both failed on a never-built clone (Storybook could not resolve unbuilt
      @emdash/theme; app-only dev could not resolve unbuilt @emdash/chat-ui). Fixed with
      `tooling/scripts/ensure-packages-built.mjs` (runs the workspace package builds through
      Nx, no-ops under Nx task orchestration; pnpm does not run pre-hooks by default, so the
      ensure step is explicit in the scripts) plus an nx.json `storybook` targetDefault with
      `^build`. Re-verified: both flows work as the first command on a fresh clone.
      Note: the fresh-clone verification required restoring the `allotment` dependency in the
      scratch clone — the branch HEAD has a pre-existing inconsistency (allotment removed from
      apps/emdash-desktop/package.json while the committed renderer index.css still imports
      it) unrelated to this work.
