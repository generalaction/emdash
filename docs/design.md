# Design: Emdash In-App Browser

## Problem

Emdash users run agents against frontend code but currently need to leave the app to preview the
rendered result. The browser should make frontend iteration fast: open a local dev server, inspect
the visible page beside the task, capture useful page diagnostics, and give the agent precise page
context without requiring users to switch tools.

## Product Shape

Build a desktop in-app browser, not a marketing page or a generic settings-only feature.

Primary workflows:

- Open a browser from a task workspace.
- Navigate to `http://localhost:<port>` or another unauthenticated URL.
- Browse ordinary public unauthenticated web pages. The feature is not only a localhost preview.
- Keep the browser visible while reviewing code, diffs, conversations, or terminal output.
- Reload after hot module replacement or server restart.
- See page load errors and current URL/title state.
- Use browser diagnostics to debug console and network failures.
- Optionally select visible page context and submit it to an agent if the existing composer
  architecture supports this cleanly.

Secondary workflows:

- Open the current URL in the system browser.
- Clear a browser session's storage intentionally.
- Open devtools in development builds.
- Restore browser tabs/sessions after navigation or app restart.

## Competitor/Reference Notes

Paseo's open-source implementation is a useful reference, but do not copy it blindly. Relevant
patterns to consider:

- Electron desktop uses `<webview>` for a real embedded browser pane.
- Browser records live in a renderer store keyed by `browserId`.
- Each browser uses a persistent partition such as `persist:<app-browser-prefix>-<browserId>`.
- The main process hardens `will-attach-webview`, strips preload, disables Node integration, enables
  context isolation/sandbox/web security, and registers attached browser `WebContents`.
- The app exposes small desktop bridge operations for open devtools, clear partition, and active
  browser tracking.
- Browser UI includes a compact toolbar and URL input.
- Page element selection can be serialized into text context for an agent, including URL, selector,
  text, bounded HTML, computed styles, bounding rect, and source information when available.

Cursor/Codex-style browser features suggest future direction:

- browser actions visible in the chat;
- efficient console/network log handling that can be searched rather than dumped into context;
- screenshots or visual feedback for agents;
- dev-server awareness;
- annotation/style feedback on page elements;
- allow/block lists for agent-controlled navigation.

For this pass, ship the first-class in-app browser and leave Browser Use/MCP automation and design
sidebar functionality as deliberate extension points unless they are already naturally supported.

## Architecture

### Existing Codebase Anchors

Use the current Emdash architecture instead of creating a parallel shell:

- `src/main/app/window.ts` already enables `webviewTag`; add hardened browser-specific attachment
  handling there or in a focused helper imported from there.
- `src/preload/index.ts` should stay small. Add direct bridge methods only for Electron primitives
  that cannot fit typed RPC.
- `src/main/rpc.ts` and `src/main/core/*/controller.ts` are the normal path for new typed
  main-process operations.
- `src/shared/view-state.ts` owns persisted task tab/view snapshots.
- `src/renderer/features/tasks/tabs/tab-manager-store.ts` currently owns task tab entries for
  `conversation`, `file`, and `diff`.
- `src/renderer/features/tasks/view/pane-renderer.ts` and
  `src/renderer/features/tasks/view/pane-content.tsx` choose the active task pane content.
- `src/renderer/features/tasks/view/tab-bar.tsx` and `src/renderer/features/tasks/view/tab-bar/*`
  render task tabs and drag previews.
- `src/renderer/features/tasks/commands.ts` registers task-scoped commands.
- `src/renderer/features/settings/use-app-settings-key.ts` and `src/main/core/settings/*` are the
  existing settings path if browser settings are needed.

If the task-tab route is chosen, add a `browser` tab kind through these existing seams rather than
special-casing the browser outside the tab manager. Browser-specific state and behavior should still
live in `src/renderer/features/browser/`.

### Pluggable Browser Boundary

Implement the browser as a feature subsystem with small typed boundaries:

- **Session model**: creates, updates, persists, restores, and removes browser sessions.
- **Embedder adapter**: abstracts Electron `<webview>` operations such as navigation, reload,
  history, focus, and event subscription. The React component can use the Electron implementation,
  but callers should not reach into raw webview DOM methods everywhere.
- **Main-process registry**: tracks browser `WebContents` by `browserId` for devtools, active
  browser routing, partition clearing, and future automation attachment.
- **Diagnostics sink**: accepts console/network/load events and applies bounds/redaction.
- **Task integration adapter**: maps browser sessions into task tabs/commands/view snapshots.
- **Future automation hook**: reserve a typed extension point for Browser Use/MCP tooling to locate
  an active browser session and request approved actions. Do not implement broad automation in V1.

This keeps the feature maintainable and lets Emdash later add browser automation, annotations, or a
design sidebar without rewriting the browser pane or task tab model.

### Session Identity

Introduce explicit browser session identity. A session should include:

- `browserId`: stable unique ID for the browser instance;
- `projectId`;
- `workspaceId` or task workspace ID;
- `taskId` when task-scoped;
- `partition`: derived from the app prefix plus sanitized identity;
- persisted UI state: current URL, title, favicon, loading/error state, history capability, created
  time, updated time.

Prefer stable IDs and snapshots that fit the existing task tab/view-state model. Avoid storing raw
untrusted URLs in places that expect IDs or file paths.

### Renderer

Create a browser feature boundary, likely under:

```text
src/renderer/features/browser/
```

Expected pieces:

- browser types and URL helpers;
- browser store/session manager;
- browser pane component;
- browser toolbar;
- optional diagnostics panel/model;
- tests colocated with the feature or under existing renderer test locations.

Integrate with task workspace infrastructure. Inspect the current tab manager and command provider
before choosing the final shape. A task tab is likely the most natural fit if file/diff/conversation
tabs already share the main panel. A split pane can be chosen if existing UI already supports it more
cleanly.

If implemented as a task tab:

- extend `TabDescriptor` with a `browser` variant containing only stable session identity and
  preview/pinning metadata;
- add a `BrowserTabEntry` and `ResolvedBrowserTab` in the tab manager;
- keep mutable browser URL/title/loading/history/diagnostics state in the browser feature store;
- add a browser pane renderer instead of placing webview JSX in generic tab code;
- add browser tab item and drag preview components matching existing tab styling;
- update tab close cleanup so browser sessions do not leave stale active IDs or partitions.

The browser pane should:

- render only in Electron desktop where `<webview>` is available;
- show a clear unavailable state in unsupported renderer contexts if needed;
- keep toolbar dimensions stable;
- use lucide icons for navigation/action buttons;
- normalize user-entered URLs by adding `http://` for localhost-like inputs and defaulting public
  domains to `https://`;
- support ordinary public HTTPS pages and not assume the page is part of the local project;
- avoid layout jumps when title, favicon, loading state, or errors change.

### Main Process and IPC

Prefer typed RPC controllers for new main-process operations. Use direct preload bridge surface only
when the operation truly depends on the sender or Electron primitive in a way the RPC router cannot
represent.

Main-process responsibilities:

- harden webview attachment in `src/main/app/window.ts` or a browser-specific helper imported there;
- validate that an attaching webview belongs to an Emdash browser session;
- enforce safe web preferences:
  - `nodeIntegration: false`;
  - `nodeIntegrationInSubFrames: false`;
  - `nodeIntegrationInWorker: false`;
  - `contextIsolation: true`;
  - `sandbox: true`;
  - `webSecurity: true`;
  - no untrusted preload;
  - no `allowRunningInsecureContent`;
- register/deregister browser `WebContents` by `browserId`;
- open devtools for registered browser sessions in development or when explicitly allowed;
- clear a session partition on explicit user action;
- optionally route app-level reload/location shortcuts to the active browser.

Keep the preload bridge small. Do not expose arbitrary JavaScript execution to the renderer or page.

### URL and Protocol Safety

Supported protocols for browser navigation:

- `http:`;
- `https:`;
- `file:` only if the implementation validates file paths safely and the UX explicitly supports
  file-backed previews;
- `about:blank`.

Blocked or externally routed protocols:

- `javascript:`;
- `data:`;
- `file:` if safe path validation is not implemented;
- custom app protocols unless there is a documented reason;
- anything not explicitly allowed.

Manual navigation by the user and future agent-controlled navigation should be treated separately.
If allow/block lists are implemented, scope them to agent/browser automation first. Manual user
navigation may be more permissive but must still avoid dangerous protocols and untrusted preload.

### Diagnostics

Diagnostics should help frontend debugging without flooding UI state or model context.

Capture, at minimum where feasible:

- console messages with severity, URL, line/column, timestamp, and bounded text;
- navigation/load failures;
- request failures or a bounded network log if Electron APIs make this straightforward;
- current URL/title/loading state.

Prefer grep-friendly text files or bounded structured stores for verbose logs. Keep a maximum line
count or byte size per browser session. Preserve existing secret redaction behavior if logs can
contain sensitive values.

### Page Context / Annotation Extension

The first version may either implement or intentionally defer page-context selection.

If implemented, serialize selected element context as bounded text suitable for agent input:

- URL;
- stable selector;
- tag;
- visible text;
- bounded outer HTML;
- key computed styles;
- bounding rectangle;
- parent chain;
- nearby child text;
- React source metadata only if naturally available.

Do not inject long-lived privileged scripts. Any selection helper injected into the page must be
bounded, removable, and run in the untrusted page context without exposing Emdash internals.

If deferred, leave a small, typed extension point and document the intended shape.

### Settings and Documentation

Add settings only when they are useful in V1:

- enable/disable in-app browser if the feature is optional;
- clear browser sessions/storage;
- future allow/block lists for agent-controlled navigation.

Documentation should explain:

- browser session isolation;
- no Chrome profile reuse, extensions, or authenticated browser profile support;
- page content is untrusted;
- when to use the system browser instead.

### Telemetry

If telemetry is added, keep it optional and coarse:

- browser opened;
- URL opened by origin category such as localhost/public/file, not full URL;
- devtools opened;
- storage cleared.

Never record full URLs, page contents, console text, cookies, tokens, or local file paths in
telemetry.

## Testing Plan

Automated tests should cover:

- URL normalization and protocol blocking;
- browser session ID and partition derivation;
- browser store create/update/remove/restore behavior;
- tab/view-state snapshot behavior;
- toolbar state and URL submission;
- cleanup of active browser ID on close;
- diagnostics bounds/redaction if implemented;
- selected element serialization if implemented.

Manual desktop verification should cover:

- start a local frontend dev server and open the route in the browser;
- reload and navigate back/forward;
- trigger a console error and verify diagnostics capture;
- close and reopen the browser session;
- restart the app and verify expected persistence;
- attempt blocked protocols;
- clear storage and verify session data is removed.

## Implementation Order

1. Add pure types/helpers/store and tests.
2. Add main-process webview registration/hardening and tests for pure helpers.
3. Add renderer browser UI and task workspace integration.
4. Add diagnostics and local-dev-server affordances.
5. Add persistence, docs/settings, manual verification, and polish.

Keep each step releasable. Do not defer security hardening until the end.
