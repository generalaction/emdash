# 03 — Bootstrap pinning

**What to build:** a fresh clone bootstraps with nothing but pnpm on the machine: `package.json`
pins both the package manager (`packageManager`) and the Node runtime (`devEngines.runtime`
with `onFail: "download"`), so `pnpm install` provisions the right Node itself. An optional
committed `mise.toml` gives humans auto-switching; `.nvmrc` remains as a hint. All bootstrap
docs describe the pnpm-only path — `nvm use && corepack enable` disappears (corepack leaves
Node 25+). Decision detail:
[Golden path design](../../dev-setup-overhaul/issues/07-golden-path-design.md) and the
[environment tooling research](../../dev-setup-overhaul/research/environment-tooling-survey.md).

**Blocked by:** None — can start immediately.

**Status:** done

- [x] `devEngines.runtime` added and verified against the pinned pnpm version's behavior
      (node download on mismatch, checksum in lockfile) — pnpm 10.28.2 records
      `node@runtime:24.14.0` with per-platform checksums in `pnpm-lock.yaml`; a scratch
      project pinned to a mismatched 24.13.0 downloaded and used it automatically
- [x] `mise.toml` committed, pinning node + pnpm, required by nothing
- [x] Bootstrap sections of CONTRIBUTING, quickstart, and AGENTS.md rewritten to the pnpm-only
      path
- [x] Demo: in a shell without nvm activation and with a mismatched system Node,
      `pnpm install` succeeds and `pnpm run dev` boots the app — mismatch install verified
      via the scratch-project demo above; app boot verified as part of ticket 04's
      main-process smoke check
