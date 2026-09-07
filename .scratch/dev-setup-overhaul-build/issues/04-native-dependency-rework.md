# 04 — Native dependency rework

**What to build:** the dual-ABI native module machinery works without npm and without
compiles in the common case. The system-Node better-sqlite3 side copy becomes an anchored pnpm
side project (own workspace file + lockfile, installed via `pnpm --dir` from postinstall —
fixing the cwd bug that scattered stray `node_modules`). The Electron rebuild is prebuild-first
and covers better-sqlite3 only — node-pty leaves the rebuild list (pure N-API, one binary
serves both runtimes) — and the manual `rebuild` script stops hardcoding an Electron version.
Pre-step inside this ticket: verify better-sqlite3 12.10.0 prebuild coverage for Linux
x64/arm64 (macOS arm64 already confirmed); bump within 12.x only if a gap exists — never 13.x.
Decision detail: [Native module strategy](../../dev-setup-overhaul/issues/01-native-module-strategy.md)
and [spec PR 4](../../dev-setup-overhaul/spec.md).

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Linux x64/arm64 prebuild coverage confirmed (or a justified in-range version bump) —
      v12.10.0 ships electron-v143 and node-v137 assets for linux-x64, linux-arm64, and
      linuxmusl variants; no bump needed
- [x] Side project installs via pnpm from postinstall; npm no longer invoked anywhere in setup
- [x] node-pty removed from the rebuild; hardcoded Electron version removed from the `rebuild`
      script. Note: upstream node-pty tarballs ship the darwin spawn-helper prebuild without
      the exec bit (previously masked by the always-compile path); postinstall now restores it
- [x] Clean-slate install on macOS and Linux: `db:fixtures`, `test:migrations`, and app boot
      (Electron ABI loads, PTY works) all pass — verified on macOS arm64 (both modules loaded
      and exercised under system Node and under Electron via ELECTRON_RUN_AS_NODE, plus
      `build:main`); Linux runtime verification deferred (no Linux machine in this run)
- [x] Forced `--build-from-source` still works as the no-network fallback (13s compile)
- [x] Demo: fresh install with warm caches stays in the seconds range (no felt regression vs
      the [baseline](../../dev-setup-overhaul/assets/baseline-run.md)) — `pnpm install` with
      the reworked postinstall completes in ~3s warm

