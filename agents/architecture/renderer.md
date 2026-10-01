# Renderer

All paths are relative to `apps/emdash-desktop/`.

## Main Entry Points

- `src/renderer/main.tsx`: renderer bootstrap — seeds the wire connection and navigation host,
  creates the app store scope, then mounts React
- `src/renderer/App.tsx`: top-level provider composition
- `src/renderer/app/workspace.tsx`: main post-onboarding shell
- `src/core/primitives/wire/browser/connection.ts`: seeded wire-connection seam
  (`seedWireConnection` / `getWireConnection` / `domainClient`); every slice exposes a typed
  domain client from its `api/` built on `domainClient`
- `src/core/manifests/browser/view-catalog.ts`: aggregated view catalog; view definitions are
  contributed by slices (`contributions/views.ts`) via `defineView` from
  `src/core/primitives/views/`

## App Shell (`src/renderer/app/`)

- `workspace.tsx`, `welcome.tsx` — shell and top-level views (the home view is workbench-owned:
  `src/core/features/workbench/browser/home-view.tsx`)
- `app-menu-events.tsx` — native app menu event wiring
- `app-shutdown-lifecycle.tsx` — quit-confirmation and shutdown-flush handling

Modal and view registration are manifest-owned, not shell-owned:
`src/core/manifests/browser/modal-catalog.ts` and `src/core/manifests/browser/view-catalog.ts`
aggregate slice contributions.

## Feature Areas (`src/core/features/*/browser/`)

Feature-owned React components, hooks, and MobX stores live beside their portable API and Node
implementation. Major browser slices include `tasks`, `projects`, `conversations`, `automations`,
`browser`, `integrations`, `settings`, `skills`, `mcp`, and `library`. Workbench-owned tabs,
sidebar, command palette, and onboarding UI live under `src/core/features/workbench/browser/`.
Cross-slice task-view lifecycle and workspace composition live in
`src/core/features/workbench/api/browser/task-composition.ts` and
`src/core/features/workbench/browser/task-composition-state.ts`; task, project, and workspace
stores expose feature-owned children through scoped-store tokens.

Task children have two explicit lifetimes: lightweight persistent stores survive session teardown
for as long as the task row exists (`task-persistent-stores.ts`), while operational task stores are
disposed when the task session is torn down (`task-scoped-stores.ts`).

Task attention indicators aggregate unseen events from saved Conversations, independently of open
tabs. A successful user close of either an ACP or terminal conversation tab acknowledges its
existing notification through the resource's `onClose` hook; later background events can notify
again. Generic disposal (including snapshot restoration, preview replacement and teardown) only
releases resources. Conversation managers reconcile membership on successful list reloads and
deletion events, preserving membership changes received during an in-flight reload. Stream gaps
invalidate the list so a gap during a reload schedules another fetch. Failed reloads preserve the
current stores. An empty pane can still have background attention, but a task with no Conversations
has no agent status indicator.

Notification clicks wait for the task composition and saved conversation record, then resolve
its tab kind through the Conversations API. Opening through the pane layout focuses an existing
ACP chat or terminal conversation tab across panes; unavailable targets expire without opening a tab.

The Tasks slice owns current-task workspace activation in its app-scoped
`TaskActivationCoordinator`. It derives activation from navigation, Project context hydration,
Task state, and Host generation readiness. Views and navigation handlers only express which Task
is current; they do not opportunistically provision it. Explicit Retry and Re-provision actions
remain direct user commands.

Feature views, modals, and task tabs are exposed through `contributions/` and aggregated by
`src/core/manifests/browser/browser-contributions.ts` and
`src/core/manifests/browser/task-tab-contributions.ts`.

The command palette uses the same static contribution model. Owning slices export
`PaletteProviderDef` arrays from `contributions/browser/`, and
`src/core/manifests/browser/palette-provider-catalog.ts` aggregates the five providers for
commands, tasks, conversations, files, and projects. The workbench modal only renders
`PaletteController` output. Argumentless commands opt in separately through
`CommandPaletteItemDef` contributions aggregated by
`src/core/manifests/shared/command-palette-catalog.ts`; command matching stays in the renderer,
while task, conversation, and project providers request kind-filtered candidates through the
search slice.

## Shared Renderer Infrastructure (`src/renderer/lib/`)

`src/renderer/lib/` is a thin host shell; portable browser infrastructure lives in
`src/core/primitives/`.

- `runtime/` — bootstrap seeding (`seed-desktop-wire.ts`, `seed-navigation-host.ts`) and the
  renderer-internal aggregate Wire client (`desktop-wire-client.ts`); slices use their own
  domain clients instead
- `modal/modal-renderer.tsx` — renders the active modal from the manifest catalog; modal
  definitions, store, and close guards live in `src/core/primitives/modals/react/`
- `layout/` — workspace layout and right-sidebar composition
- `keybindings/` — keybinding dispatcher mount and browser shortcut forwarding
- `stores/` — navigation telemetry wiring; app-lifetime stores are slice-owned and ride the app
  scope (`src/core/manifests/browser/app-scoped-stores.ts`)
- `providers/`, `hooks/` — shared providers and hooks (theme, feature flags, multi-select)

Navigation lives in `src/core/primitives/navigation/`; commands and the palette live in
`src/core/primitives/commands/`, `src/core/primitives/view-scopes/`, and
`src/core/primitives/palette/`. The PTY frontend is owned by the terminals slice
(`src/core/features/terminals/`). Monaco, file rendering, file-tree projection, and
renderer-facing file runtime access are owned by `src/core/features/editor/browser/`.

The renderer error boundary offers a state-preserving Reload app action, collapsible error details,
and a Reset UI state and reload fallback under "Still having trouble?". Reset discards pending
memento writes before clearing saved presentation state (including unsent drafts), and only reloads
once deletion succeeds. A failed reset stays visible above the disclosures so it can be retried.

## Tests

- Renderer unit tests: `src/renderer/tests/`
- Playwright-backed browser tests: `src/renderer/tests/browser/`

## When Editing Here

- Check `agents/conventions/renderer-patterns.md` for modal, view, PTY frontend, and store patterns.
- Call renderer-main methods through the owning slice's typed domain client.
- Add feature views, modals, and task tabs through the owning slice's contributions.
- The preload bridge (`src/entry/preload.ts`) exposes only `requestWirePort` and
  `getPathForFile`; keep application traffic on Wire.

## ACP Transcript Synchronization

`SessionState.transcript` publishes a coherent `{ generation, historyRevision,
lastCommittedTurnSeq, activeTurn }` snapshot. Generations change when the runtime rebuilds
history, not when a renderer reconnects. Every committed turn and amendment advances the
history revision; live chunks do not. The legacy `activeTurn` model remains available for
older consumers, but new renderers use the coherent snapshot rather than combining independently
coalesced live models.

History pages carry the same position plus half-open coverage (`fromSeq`, `beforeSeq`, with
null denoting an unbounded edge). Chat UI merges only that range, rejects obsolete pages, and
keeps observed outgoing turns visible until authoritative history acknowledges them. Retention
never invents a turn outcome or finalizes running tools. A generation change keeps the old
presentation until replacement history arrives, then discards the old generation even if IDs
repeat. Pending submissions are acknowledged by prompt ID independently of the mounted view.

The conversation store refreshes history on revision changes, including entirely unobserved
turns and direct A-to-B queue handoffs. Refreshes can run while a successor streams and cover
the already loaded range, so pagination and old tool amendments survive catch-up. Initial live
content determines presentation readiness; history, config, usage, plan, terminals, and MCP
metadata must not block displaying it. Optional metadata has safe defaults while loading.
Older runtimes without version metadata use the legacy synchronization path and cannot provide
the same missed-update guarantees.


## Editor language services

TypeScript and JavaScript buffers use the host LSP runtime for hover, definition,
type definition, references and diagnostics. Install or select
`typescript-language-server` in the host's machine dependencies (the offered npm
command installs TypeScript too; Node.js 22.22.2 or newer is required), then use
the language-service status button in
the file toolbar to restart. The executable must be on the host containing the
worktree; a local installation does not provide language services for SSH files.
Remote language services require workspace protocol 11.1 or newer.

`editor/browser/lsp/monaco-language-services.ts` registers providers once during
lazy Monaco bootstrap. File tabs register the originating task and workspace
root before their buffer models are created. Only `emdash-buffer:` models are
replicated; disk and Git snapshots never enter the language server. Shared model
lifetime owns open/close, so split panes and dirty buffers surviving tab closure
remain consistent. `DocumentSynchronizer` coalesces edits and flushes every open
buffer before a query. The shared file store emits successful saves. Results
preserve host identity and the originating task when navigating outside the root.

`LanguageSession` leases typed live state through the editor Wire domain. The
Node editor controller routes to `RuntimeBroker`; it does not own processes or
LSP protocol state. `packages/core/src/runtimes/lsp/` owns process framing,
initialization, document versions, cancellation, capabilities, diagnostics and
shutdown. It runs as a worker on both desktop and workspace-server, with one
server per renderer client, workspace root and server ID. Server commands come
from host dependency descriptors, never renderer-supplied shell text. A live-state
lease keeps the server alive; the last detach releases it after a short grace
period. Explicit restart replays unsaved buffers, and replacement generations
invalidate renderer synchronization caches.

This initial server registry supports TS/JS, including JSX and TSX, with UTF-16
positions and a two-million-character document limit. It leaves completion,
formatting and workspace-edit operations on their existing editor paths. Adding
another server means adding a host descriptor/registry entry and a language
mapping, then exercising its capability negotiation and synchronization behavior.
`vscode-languageserver-protocol` (MIT) supplies standard JSON-RPC framing and
cancellation. `typescript-language-server` (Apache-2.0) is a development-only
fixture for real-server integration tests; neither adds native build hooks.

Tests cover protocol state and actual server behavior in Core, host routing and
buffer policy in desktop Node tests, and Monaco providers/navigation in browser
tests. `language-services.e2e.browser.test.ts` carries actual Wire frames through
Playwright bindings into the production editor controller and host runtime,
then checks cross-file unsaved types, definitions, diagnostics and restart with
a real TypeScript server. The bindings exist only in Vitest's test harness.
