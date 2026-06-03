# Browser Verification Notes

Last automated verification in this worktree:

- `pnpm run format` passed.
- Focused browser tests passed:
  - `src/shared/browser.test.ts`
  - `src/main/core/browser/webview-security.test.ts`
  - `src/renderer/features/browser/browser-session-store.test.ts`
  - `src/renderer/features/browser/browser-diagnostics-store.test.ts`
  - `src/renderer/features/browser/browser-webview-events.test.ts`
  - `src/renderer/features/browser/browser-toolbar-actions.test.ts`
  - `src/renderer/features/tasks/tabs/tab-manager-store.test.ts`
  - `src/renderer/features/tasks/commands.test.ts`
- `pnpm run typecheck` passed.
- `pnpm run lint` passed.
- `pnpm exec vitest run --project node --project main-db --project migrations` passed.
- `pnpm run build` passed.

Known environment blockers in this shell:

- `pnpm run test` fails before browser-project tests can run because Playwright Chromium is missing.
- `pnpm exec playwright install chromium` fails with:
  `ERROR: Playwright does not support chromium on ubuntu26.04-x64`.
- Desktop manual verification cannot run from this shell because `DISPLAY` and `WAYLAND_DISPLAY`
  are unset and `xvfb-run` is unavailable.

Manual desktop verification still required on a supported desktop environment:

- open a task browser tab from command palette or shortcut;
- open `http://localhost:<port>` from a running frontend dev server;
- open a public unauthenticated HTTPS page;
- use back, forward, reload, stop, and open externally;
- trigger a console error and confirm diagnostics capture;
- attempt blocked schemes such as `javascript:` and `data:`;
- clear storage through the explicit confirmation action;
- restart the app and confirm browser tab/session restore.
