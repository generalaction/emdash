# In-App Browser

Emdash includes an Electron `<webview>` browser surface for task workspaces. It is intended for
local frontend preview and ordinary unauthenticated public pages.

## Session Isolation

- Each browser tab has a stable browser ID and a persistent Electron partition derived from the
  project, workspace, task, and browser instance.
- Cookies, local storage, IndexedDB, and cache persist for that browser session across React
  unmounts and app restarts.
- Browser sessions do not share storage with unrelated workspaces, tasks, or browser tabs.
- Closing a browser tab removes its in-memory session state. Use the toolbar clear action to
  intentionally clear the persistent storage for that browser session.

## Safety Model

Browser content is untrusted. Emdash does not reuse a Chrome profile, load browser extensions, or
share signed-in system-browser state.

The main process hardens browser webviews before attachment:

- Node integration is disabled.
- Context isolation, sandboxing, and web security are enabled.
- Page-supplied preload scripts are stripped.
- Only registered Emdash browser partitions can attach.
- Unsupported URL schemes such as `javascript:` and `data:` are blocked.

Supported browser navigation schemes are `http:`, `https:`, and `about:blank`. `file:` URLs are
blocked until path validation and explicit file-preview UX are implemented.

Use the system browser for authenticated flows or pages that require an existing browser profile.
Do not paste secrets into browser pages for agent workflows.

## Diagnostics

The browser captures bounded diagnostics per browser session:

- console messages;
- navigation and load failures;
- current URL, title, favicon, loading, and history state.

Diagnostics are kept in renderer memory with a fixed per-browser entry limit and basic redaction for
common token, password, secret, and bearer-token shapes.

Network request logs are intentionally deferred in this pass. The main-process browser WebContents
registry is the extension point for adding bounded `webRequest` capture per registered browser
partition without routing raw request bodies or credentials into renderer state.

## Page Context Extension

Page element selection and annotation are intentionally deferred until they can use a typed composer
attachment or context pipeline. The browser feature already separates session state, webview
controls, diagnostics, and task-tab integration so a future page-context tool can attach to the
active browser session without rewriting task tabs or webview hardening.

## Manual Verification

Before considering the browser feature complete, verify in the desktop app:

- open a task browser tab from the task command palette or shortcut;
- open `http://localhost:<port>` from a running frontend dev server;
- open a public unauthenticated HTTPS page;
- reload, stop, go back, and go forward;
- trigger a console error and confirm diagnostics show it;
- attempt blocked schemes such as `javascript:` and `data:`;
- clear browser storage through the explicit toolbar confirmation;
- restart the app and confirm the browser tab/session restores as expected.
