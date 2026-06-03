# Goal: Add a First-Class In-App Browser to Emdash

Follow this goal document and the companion design in `docs/design.md`. Implement the feature
end to end in small, verified milestones. The finished repository should contain a secure,
usable in-app browser for Emdash's Electron desktop app so users can quickly preview and test
frontend changes without leaving the task workspace.

## Goal State

When the work is complete:

- Emdash has a first-class browser surface inside the desktop app, available from task workspaces
  through the existing navigation/tab/command patterns.
- A user can open a browser tab or pane, enter a URL, navigate to local dev servers, file-backed
  previews where safe, and normal public unauthenticated web pages, then use back, forward,
  reload/stop, and open externally. The browser must not be local-dev-only.
- Browser sessions are isolated per workspace/task/browser instance. Cookies, local storage, and
  IndexedDB persist for that isolated session across React unmounts and app restarts, but do not
  leak across unrelated workspaces or tasks.
- The Electron `<webview>` integration is hardened: no Node integration, no preload script from
  visited pages, context isolation and sandboxing enabled, unsupported protocols blocked or routed
  to the existing external-link flow, and destructive/session-clearing actions explicit.
- Browser state is represented in typed local stores and persisted view/task snapshots where the
  existing architecture expects it. Closing a browser session cleans up its in-memory state and,
  when appropriate, clears its dedicated browser partition.
- The implementation is pluggable: browser domain logic, Electron webview control, task-tab
  integration, diagnostics, and future automation hooks are separated behind small typed interfaces
  or feature boundaries. The browser feature must not become a pile of ad hoc task-view conditionals.
- The browser UI fits Emdash's existing renderer style: compact toolbar, lucide icons, no marketing
  layout, no nested cards, stable dimensions, and no text overflow at desktop or narrow widths.
- The browser is useful for frontend iteration:
  - local dev server URLs are easy to open;
  - loading and error states are visible;
  - current URL/title/favicon state is kept up to date;
  - console and network diagnostics are captured or exposed in a way that can be searched/read
    without flooding the UI or agent context;
  - users can select or annotate visible page context for an agent task if the existing composer
    or attachment architecture has a natural integration point.
- Keyboard and command-palette access exists, including a shortcut for opening/focusing the browser
  and commands for reload, focus URL, open externally, and close browser tab where those match local
  patterns.
- Settings/security behavior is documented in UI copy only where needed and in repository docs.
  Browser content is treated as untrusted. The app must never ask users to paste secrets into
  browser flows.

## Explicit Non-Goals for This Pass

- Do not build a full visual design sidebar with CSS sliders and code-apply workflows.
- Do not build autonomous browser MCP tooling unless a small bridge already exists and can be
  completed without derailing the browser surface.
- Do not support signed-in Chrome profile reuse, browser extensions, or existing system-browser tabs.
- Do not weaken existing external-link handling, PTY environment allowlists, shell escaping, path
  validation, telemetry opt-out behavior, or secret redaction.
- Do not hand-edit generated Drizzle migrations or `drizzle/meta/`.

## Required Discovery Before Editing

Read only the docs needed for the files you will touch:

- `docs/design.md`
- `agents/architecture/overview.md`
- `agents/architecture/main-process.md`
- `agents/architecture/renderer.md`
- `agents/conventions/ipc.md`
- `agents/conventions/renderer-patterns.md`
- `agents/conventions/typescript.md`
- `agents/workflows/testing.md`
- If you touch `src/main/core/pty/`, `src/main/core/ssh/`, `src/main/db/`, or updater code, first
  read the corresponding `agents/risky-areas/` document.

Also inspect existing task tab, command, settings, IPC, telemetry, and view-state patterns before
adding new abstractions.

## Suggested Implementation Milestones

Work milestone by milestone. After each milestone, enter the verification loop below and do not
continue until high and medium issues are fixed.

1. **Architecture and state**
   - Add shared browser types for session identity, URL normalization, browser state snapshots, and
     diagnostics metadata.
   - Add renderer browser store(s) following existing MobX/React Query/task-view patterns.
   - Design the browser as a feature module with explicit interfaces for session state,
     embedder/webview operations, diagnostics, and task integration.
   - Decide whether browser sessions live as task tabs, a task split pane, or another existing
     workspace surface. Prefer the smallest integration that feels native in Emdash.
   - If task tabs are chosen, extend the current tab system intentionally:
     `src/shared/view-state.ts`, `src/renderer/features/tasks/tabs/tab-manager-store.ts`,
     `src/renderer/features/tasks/view/pane-renderer.ts`,
     `src/renderer/features/tasks/view/pane-content.tsx`,
     `src/renderer/features/tasks/view/tab-bar.tsx`, and tab drag-preview/close handling.
     Keep browser-specific state in `src/renderer/features/browser/`, not embedded directly in
     generic tab code.
   - Add focused unit tests for URL normalization, snapshot restore, session identity, and cleanup.

2. **Electron security and main-process integration**
   - Harden `will-attach-webview` in the main window for Emdash browser webviews.
   - Add typed RPC handlers or the minimal preload bridge needed for operations that require
     `WebContents`: register browser webcontents, open devtools, clear a browser partition, and
     set/fetch active browser state.
   - Ensure browser webviews use isolated persistent partitions derived from stable, sanitized
     browser session IDs.
   - Add tests for protocol validation and any pure security helpers. If Electron event behavior
     cannot be unit-tested, document the manual verification path.

3. **Browser UI**
   - Add the browser pane/component under an appropriate `src/renderer/features/browser/` boundary.
   - Include a compact toolbar with URL input, back, forward, reload/stop, open externally, devtools
     in development where appropriate, and clear-session only if the UX is explicit.
   - Handle loading, navigation errors, title/favicon updates, and narrow-width layout.
   - Verify public unauthenticated websites as well as localhost. Do not bake in assumptions that
     every target is `localhost`.
   - Integrate the browser into task workspace commands, tabs/titlebar/sidebar controls as chosen
     in milestone 1.
   - Add renderer tests for toolbar behavior, disabled states, URL submission, and tab/session
     lifecycle.

4. **Frontend-testing workflow**
   - Add local-dev-server affordances using existing dev-server/task terminal state if available:
     show likely localhost URLs, preserve the last URL per workspace, and avoid starting duplicate
     servers.
   - Capture browser diagnostics in a searchable, bounded form. Prefer files or structured stores
     with grep-friendly text over dumping verbose logs into React state.
   - Add page-context selection or annotation only if it can be built cleanly on existing composer
     attachment/context patterns. If not, leave a documented extension point and ship diagnostics.
   - Add tests for diagnostics bounds, redaction if applicable, and selected-context serialization
     if implemented.

5. **Polish, persistence, and documentation**
   - Persist browser session state through existing view/task snapshot infrastructure.
   - Add or update settings/docs that explain session isolation, unsupported auth/profile behavior,
     and safety expectations.
   - Verify the browser manually in the desktop app against:
     - `http://localhost:<port>` for a local dev server;
     - a simple `file://` preview if supported;
     - a public unauthenticated HTTPS page;
     - blocked unsupported schemes such as `javascript:` or `data:`.

## Verification Loop After Each Milestone

Run a tight loop before moving to the next milestone:

1. Run the focused tests for the changed area.
2. Run formatting, linting, and type checks at the smallest reliable scope. At minimum, run the
   full commands at the end:

   ```bash
   pnpm run format
   pnpm run lint
   pnpm run typecheck
   pnpm run test
   ```

3. Check that every new behavior from the milestone has either automated coverage or an explicit
   manual verification note.
4. Run 2-3 review subagents if available. Ask them to report `high`, `medium`, and `low` issues:
   - architecture/patterns reviewer: local architecture, IPC boundaries, state ownership, view/tab
     integration, maintainability;
   - logic/security reviewer: Electron webview hardening, URL/protocol handling, session isolation,
     cleanup, edge cases;
   - tests/UX reviewer: coverage gaps, usability, accessibility, layout, command/keyboard behavior.
5. Fix all high and medium issues. Repeat the review loop until no high or medium issues remain.
   Track low issues and either fix them or explain why they are deferred.

If subagents are unavailable in the current Codex surface, perform the same three reviews yourself
and record the findings before continuing.

## Acceptance Criteria

The final implementation is accepted only if all of the following are true:

- Browser surface exists in the desktop app and can be opened/focused from an expected task workflow.
- URL entry and navigation controls work for supported URLs, including localhost and ordinary
  public HTTPS pages.
- Browser sessions are isolated and persistent per workspace/task/browser instance.
- Browser code is modular enough that future Browser Use/MCP automation can attach to browser
  sessions without rewriting task tabs or Electron security setup.
- Main-process webview attachment is hardened and tested where practical.
- Unsupported protocols are blocked or routed safely.
- Browser state survives view changes and app restart where the design says it should.
- Closing/removing browser sessions cleans up state and does not leave stale active browser IDs.
- Console/network diagnostics are captured or intentionally deferred with a clear reason and an
  extension point.
- The implementation includes meaningful unit/component/browser tests for new state, URL/security
  helpers, UI behavior, and lifecycle behavior.
- Manual desktop verification was performed and documented for local dev server preview.
- `pnpm run format`, `pnpm run lint`, `pnpm run typecheck`, and `pnpm run test` complete
  successfully, or every failure is unrelated, pre-existing, and documented with evidence.

## Final Response Requirements

When finished, summarize:

- the browser workflows implemented;
- security/session-isolation decisions;
- where diagnostics/page context live;
- tests and commands run;
- manual desktop/browser verification performed;
- any intentionally deferred follow-up work.
