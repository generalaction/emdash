# 05 — Doctor

**What to build:** a report-only root `pnpm run doctor` that answers "is my environment fine?"
in one command: Node/pnpm versions vs the package.json pins, both better-sqlite3 copies and
node-pty loadable on their respective ABIs, Playwright browsers present (printing the install
command when absent), Docker reachability (flagged as remote-flows-only), stale Nx daemon,
and any active escape-hatch env vars. Test/check failure output tells the user to run it —
this is the setup-broken-vs-HEAD-red disambiguator. Decision detail:
[Golden path design](../../dev-setup-overhaul/issues/07-golden-path-design.md).

**Blocked by:** 04 — Native dependency rework (the doctor checks the reworked native layout).

**Status:** done

- [x] Doctor green on a healthy machine; each degraded state (missing browsers, mismatched
      pin, unloadable ABI, active hatch) produces a specific, actionable report line —
      missing-browsers and active-hatch states demoed live; pin-mismatch and ABI states
      covered by unit tests (Electron-ABI check is an indirect dlopen probe: the
      NODE_MODULE_VERSION in the failure is matched against the installed Electron's ABI
      from node-abi, since an Electron-ABI binary cannot load under system Node)
- [x] Report-only: it fixes nothing, but every failure line names the fixing command
- [x] Test/check failure output references the doctor (root `pnpm run check` failure hint;
      vitest internals untouched)
- [x] Baseline procedure re-run recorded (success-criteria checkpoint from the
      [spec](../../dev-setup-overhaul/spec.md)): one command from clone, zero interventions,
      doctor green — re-run transcript in the build handoff report
