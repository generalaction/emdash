# Renderer

All paths are relative to `apps/emdash-desktop/`.

## Main Entry Points

- `src/renderer/main.tsx`: renderer bootstrap
- `src/renderer/App.tsx`: top-level provider composition
- `src/renderer/app/workspace.tsx`: main post-onboarding shell
- `src/renderer/app/view-registry.ts`: view definitions and navigation guards; switches between views
- `src/renderer/lib/runtime/desktop-wire-client.ts`: typed desktop Wire client

## App Shell (`src/renderer/app/`)

- `workspace.tsx`, `home-view.tsx`, `welcome.tsx` — shell and top-level views
- `modal-registry.ts` — central modal registry; all modals are registered here
- `view-registry.ts` — central view registry; all views are registered here
- `app-menu-events.tsx` — native app menu event wiring

## Feature Areas (`src/core/features/*/browser/`)

Feature-owned React components, hooks, and MobX stores live beside their portable API and Node
implementation. Major browser slices include `tasks`, `projects`, `conversations`, `automations`,
`browser`, `integrations`, `settings`, `skills`, `mcp`, and `library`. Workbench-owned tabs,
sidebar, command palette, and onboarding UI live under `src/core/features/workbench/browser/`.
Cross-slice task-view lifecycle and workspace composition live in
`src/core/features/workbench/browser/task-composition.tsx`; task, project, and workspace stores
expose feature-owned children through scoped-store tokens.

Feature views, modals, and task tabs are exposed through `contributions/` and aggregated by
`src/core/manifests/browser/browser-contributions.ts` and
`src/core/manifests/browser/task-tab-contributions.ts`.

## Shared Renderer Infrastructure (`src/renderer/lib/`)

- `runtime/desktop-wire-client.ts` — typed Wire client
- `modal/` — modal provider, renderer, store, and close-guard infrastructure
- `layout/` — layout, navigation, and panel drag providers
- `commands/` — command registry (`registry.ts`) and view-level `commandProvider` hooks
- `pty/` — frontend PTY sessions, pool provider, panes, prompt injection
- `stores/` — cross-feature stores (navigation, dependencies, resource monitor, ...)
- `providers/`, `hooks/`, `components/`, `ui/`, `theme/` — shared providers, hooks, and UI primitives

Monaco, file rendering, file-tree projection, and renderer-facing file runtime access are owned by
`src/core/features/editor/browser/`.

## Tests

- Renderer unit tests: `src/renderer/tests/`
- Playwright-backed browser tests: `src/renderer/tests/browser/`

## When Editing Here

- Check `agents/conventions/renderer-patterns.md` for modal, view, PTY frontend, and store patterns.
- Call renderer-main methods through the typed desktop Wire client.
- Add feature views, modals, and task tabs through the owning slice's contributions.
- The preload bridge (`src/entry/preload.ts`) exposes only `requestWirePort` and
  `getPathForFile`; keep application traffic on Wire.
