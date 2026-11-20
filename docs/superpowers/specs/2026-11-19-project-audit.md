# Project audit — 2026-11-19

Read-only audit of the `upstream-sync` worktree (the build installed in /Applications). Four
parallel reviewers: dead code, architecture, fork-only logic, performance. Items marked ✔ were
re-verified by hand; others are reviewer findings with file:line evidence.

## P0 — bugs in fork code (fix first)

1. ✔ Flutter picker types into a running `flutter run`. `flutter-device-picker.tsx:45`
   `onOpenChange` → `refreshTargets()` sends `printf …; flutter devices` into the run's stdin
   (`r` hot-reloads, `d` detaches); `busy()` also flips phase `running` → `idle`.
   Fix: skip refresh/select while starting/running; disable picker.
2. ✔ `flutter-runner.ts:240` `exec()` never times out; a closed terminal leaves `busyCount` > 0,
   Run stays disabled until reload. Fix: timeout + reject on terminal exit.
3. `claimOwnUpstream` (`primitives/git/api/own-upstream.ts`) drops intentional upstreams:
   `main` → `upstream/master`, local-tracking (`remote = .`). Fix: only re-point when
   `<remote>/<branch>` exists; never unset (push already publishes to own name).
4. `lspCapabilitiesSchema.formatting` is required: an SSH host on an older runtime fails
   validation and loses all LSP. Fix: `.default(false)`.
5. Format-on-save past 3 s applies edits after the write → buffer dirty again. Fix: check model
   version / cancel on timeout.
6. `'**/build/**'` watcher exclude hits non-Flutter repos (`apps/emdash-desktop/build/`).
   Fix: keep `.dart_tool`, `ios/Pods`, `.gradle`; drop generic `build`.
7. `commit-message.ts:103` `child.stdin` has no `'error'` handler → EPIPE can crash the
   agent-config runtime when the CLI exits early.
8. Input-dropped warnings log once per keystroke → log flood during reconnect.

## P1 — performance (the "1 minute lag")

1. ✔ `git-checkout-store.ts:683` reads every untracked file (≤2 MB each, unbounded parallel, no
   cache) on every status change just to count lines. Fix: reuse registry diff stats or cache by
   path+mtime and cap concurrency.
2. `workspace-registry/node/scan/scheduler.ts:165` any content event in a worktree requests a
   repository-wide scan (`git status -uall` + numstat for every worktree). Fix: scan only that
   workspace.
3. ✔ `DEFAULT_SEARCH_EXCLUDE` lacks `.dart_tool`, `Pods`, `.gradle`; file-search still indexes
   and rebuilds on FSEvents drops. Fix: add them.
4. Three separate recursive FSEvents streams per worktree (files / git+registry / search use
   different ignore lists). Fix: share `workspaceContentWatchIgnore()`.
5. Per-repo git queue serializes `status -uall` for every task before stage/commit/switch.
   Fix: run read-only status/head outside the mutation lane.
6. `checkout-resource.ts:330` refreshes status on any event, including gitignored paths.
7. Status live model publishes `replace` (full map up to 10k entries) instead of `diff`.

## P2 — dead code (~2,000 lines, 30 files, 6 deps)

✔ spot-checked: `stacked-diff-view.tsx` + `stacked-diff-panel-store.ts`, `modal-context-bar.tsx`
+ `prompt-actions-menu.tsx`, `editor/browser/diffUtils.ts`, chat-ui `ShrinkWrap`,
`host-dependency-store.ts`, `useTelemetryConsent.ts`, `waitlist-card.tsx` (orphaned by the fork),
old tab entries (`acp-chat-registry.ts`, `*-tab-entry.ts`), `branch-picker-field.tsx`,
`workspace-summary-alert.tsx`, `rate-limiter.ts`, `use-multi-select.ts`,
`preserve-pattern-safety.ts`, `useLocalStorage.ts`, `shellEscape.ts`, `file-errors.ts`.
Unused deps: `jsonc-parser`, `pidusage`, `@types/pidusage`, `vitest-browser-react`
(desktop), `@tiptap/extension-placeholder` (ui), `@shikijs/themes` (chat-ui).

## P3 — architecture

1. Import cycle workbench ↔ editor introduced by format-on-save
   (`editor-view-store.ts` → `browser/lsp/language-services` → workbench). Fix: inject
   `formatBeforeSave` or move the registry into `editor/api/browser`.
2. Slice `api/` importing its own `browser/` layer (≈10 files); add a lint rule.
3. 40 bidirectional slice pairs; god files: `workspace-registry/node/runtime.ts` (2,090 lines),
   `editor-file-tree.tsx` (840-line component), `chat-ui/ChatRoot.tsx` (1,540-line component).
4. `globalThis.__monaco` coupling, `as any` in `wire/browser/connection.ts:60`, used re-exports.

Mostly upstream code: P3 items 2–4 and most of P2 conflict with future upstream merges; prefer
fixing in upstream or leaving alone unless the fork owns the file.

## P0 impact notes (before any fix)

Each note: why the current behavior exists → what the fix keeps → what it changes → risk → test.

### P0-1 Flutter picker while running
- **Why it exists:** the runner owns one hidden "Flutter" shell; every command (`flutter devices`,
  `flutter emulators`, emulator boot) is typed into it. Opening the picker refreshes the device
  list so only online devices are offered; picking an offline emulator boots it.
- **Keep:** picker stays usable while running — run mode switch (affects next run) and choosing an
  online device (only remembers `lastDevice`, no shell command) still work. Cached device list is
  shown.
- **Change:** `refreshTargets()` and emulator boot are skipped while `state` is `starting` or
  `running` (the shell belongs to `flutter run`, typed keys become hot-reload/detach commands).
  Picking an offline emulator during a run shows "Stop the app to boot an emulator".
- **Risk:** after a renderer reload during a run the list was never loaded → picker shows
  "Loading devices…" until the run stops; acceptable, refresh happens on next open after stop.
- **Test:** runner test: while `running`, `refreshTargets()` sends nothing to the terminal.

### P0-2 `exec()` waits forever
- **Why:** commands are typed into a shell; completion is detected by an end marker in the log.
  No time limit is intentional-ish: first-run `flutter` can download the SDK for minutes.
- **Keep:** no time-based timeout (slow but healthy commands must still finish).
- **Change:** reject only when the Flutter terminal disappears (closed/killed) — the exact case
  where the marker can never print; listener removed, `busyCount` released, Run re-enabled.
- **Risk:** none for live terminals. Ctrl+C inside the terminal still prints the end marker.
- **Test:** closing the terminal rejects a pending `exec` and phase returns to `idle`.

### P0-3 `claimOwnUpstream` drops upstreams
- **Why:** user wants a branch cut from `origin/dev` to track its own name, not `dev`.
- **Keep:** deliberate tracking — `main → upstream/master` (fork triangular), local tracking
  (`remote = .`), PR task branches (`emdash-pr-url`), fork PR refs (`refs/pull/...`).
- **Change:** act only when git itself set the tracking at creation: the branch's first reflog
  entry is `branch: Created from <remote>/<merge-branch>`. Then re-point to `<remote>/<branch>` if
  it exists, else unset (first Push publishes to own name). Anything else is left untouched.
- **Risk:** someone who ran `git checkout -b x --track origin/dev` on purpose gets it reset on
  switch; rare. No reflog → untouched.
- **Test:** extend own-upstream test: `main` tracking `upstream/master` (set via
  `--set-upstream-to`) keeps it; branch created from `origin/dev` is reset.

### P0-4 LSP `formatting` capability required
- **Why:** capability flag tells the client whether the server formats.
- **Keep:** same meaning.
- **Change:** `formatting: z.boolean().default(false)` — a host runtime built before this field
  (SSH/workspace-server) still parses; missing means "no formatting".
- **Risk:** none; only affects payloads lacking the field.
- **Test:** schema parses a state without `formatting` as `false`.

### P0-5 Format-on-save after timeout
- **Why:** 3 s timeout so a slow server never blocks a save.
- **Keep:** Format Document command (Shift+Alt+F) unchanged; save never blocked > 3 s.
- **Change:** save path requests edits from the LSP provider directly with an abort signal; edits
  are applied (one undo step) only if they arrived within 3 s and the model version is unchanged.
  Late results are discarded instead of dirtying the saved buffer.
- **Risk:** behavior identical when formatting is fast.
- **Test:** provider resolving after the timeout leaves the model unchanged.

### P0-6 `**/build/**` watcher exclude too broad
- **Why:** Flutter writes Android/iOS build output into `<root>/build/`, flooding FSEvents.
- **Keep:** exclusion of Flutter build output, `.dart_tool`, `ios/Pods`, `.gradle`.
- **Change:** `'**/build/**'` → `'build/**'` (workspace root only). Nested `build/` folders that
  hold tracked sources (e.g. `apps/emdash-desktop/build/`) are watched again.
- **Risk:** Flutter apps inside a monorepo subfolder (`apps/x/build/`) are no longer excluded;
  user can add it via Settings → Watcher exclusions.
- **Test:** profile test asserts `build/**` present and nested `apps/x/build/y` not matched.

### P0-7 commit-message stdin EPIPE
- **Why:** prompt is piped via stdin (argv size limit, CLIs wait for stdin otherwise).
- **Keep:** same.
- **Change:** `child.stdin.on('error', () => {})`; the exit code/stderr path already reports
  the failure ("not logged in", bad flag) to the user.
- **Risk:** none.

### P0-8 input-dropped log flood
- **Why:** diagnostic added while chasing the terminal lag (root cause turned out to be watcher
  load).
- **Keep:** one warning when input starts being dropped.
- **Change:** warn once per drop streak; reset when an input is sent successfully.
- **Risk:** none.

## P1/P3 impact notes (round 2)

### P1-1 Untracked line counts re-read every file on every status change
- **Why it exists (upstream code):** git's numstat reports 0 lines for untracked files, so the
  Changes panel reads each untracked file to show `+N` per file and in the task total.
- **Keep:** identical numbers per file and total; files > 2 MB still show 0 (unchanged cap).
- **Change:** per-store cache keyed by path → `{size, mtimeMs, lines}`. Each refresh does a cheap
  `stat`; the file is read only when size/mtime changed. Reads/stats run at most 8 at a time.
  Cache entries for files no longer untracked are dropped.
- **Risk:** a rewrite that keeps both size and mtime identical would show the old count — same
  stat-key rule the workspace registry already uses for its totals.
- **Test:** second refresh with unchanged stat does not call `readText`; changed mtime re-reads.

### P1-3 File search indexes `.dart_tool`, `Pods`, `.gradle`
- **Why:** `DEFAULT_SEARCH_EXCLUDE` lists generated/dependency folders (node_modules, build,
  target…) so quick-open/content search stay fast and relevant; Flutter/iOS/Android ones are missing.
- **Keep:** everything else searchable; Flutter detection (`pubspec.yaml` at root) unaffected.
- **Change:** add `.dart_tool`, `Pods`, `.gradle` (folder names, any depth) — same as node_modules.
- **Risk:** searching inside CocoaPods sources no longer finds them (like node_modules today);
  user can override in Settings → Search exclusions.
- **Test:** exclusion test asserts `ios/Pods/x.h` and `.dart_tool/y` excluded, `lib/main.dart` not.

### P1-6 Git status refresh for gitignored paths
- **Why:** any worktree file event may change `git status`, so the checkout invalidates status.
- **Keep:** every event on a non-ignored path refreshes exactly as today; `.gitignore` edits and
  watcher resyncs always refresh.
- **Change:** a batch whose paths are all gitignored (per `git check-ignore`, which never reports
  tracked files) skips the refresh. If the check fails, refresh anyway.
- **Risk:** one extra quick `git check-ignore` per event batch; it replaces a `git status -uall` +
  numstat chain only when the whole batch is ignored. Gain is smaller now that P0-6 already
  excludes build/.dart_tool/Pods/.gradle from the watcher.
- **Test:** ignored-only batch → no status refetch; mixed batch → refetch; `.gitignore` → refetch.

### P3-1 Import cycle workbench ↔ editor (from format-on-save)
- **Why:** `EditorViewStore.saveFile` (editor `api/`) imported `getLanguageServices` from the
  editor `browser/lsp` layer, which imports workbench, which imports `EditorViewStore`.
- **Keep:** format-on-save behaviour identical.
- **Change:** `editor-view-store.ts` exposes `setBeforeSaveHook(fn)`; `installLanguageServices`
  registers `ref => services.formatBeforeSave(ref)`. The `api → browser` import disappears.
- **Risk:** none; before Monaco loads there is no hook, same as today (no services = no format).
- **Test:** existing LSP/save tests; typecheck confirms no import from `browser/lsp` in `api/`.
