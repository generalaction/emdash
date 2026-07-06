# Browser Annotations Goal

Use this as the `/goal` text for the implementation agent.

```text
/goal Fully implement browser annotations in Emdash's in-app task browser, with code and UI that fit the existing cleanliness, architecture, structure, state boundaries, naming, test style, and interaction patterns of this codebase. Verify with focused unit/browser tests plus format, lint, typecheck, and test passing, while preserving existing browser navigation, screenshot, profile, task context, and terminal prompt-injection behavior.

Build the full v1 feature:
- Users can toggle Annotation mode in an in-app browser tab.
- Users can annotate rendered page elements, selected text, and rectangular areas.
- Annotations are task-scoped and browser-session aware.
- Annotations capture structured Agentation-style context: id, comment, url, title, element/tag, selector/path, cssClasses, nearbyText or selectedText, viewport/document coordinates, boundingBox, status, createdAt, and updatedAt.
- Computed styles are explicitly out of v1 and should be left as a clean extension point.
- Users can paste browser annotations into the active agent terminal and optionally submit.
- Sent annotations are consumed only after successful paste/send.
- Page content remains untrusted; do not expose Node or app internals to the page.
- Prefer static page-inspection JavaScript through the existing browser/webContents boundary, with structured data returned to trusted Emdash UI.

Use existing Emdash patterns:
- Read AGENTS.md and relevant agents docs first.
- Keep browser interaction UI under src/renderer/features/browser.
- Use typed RPC/events for main-process browser operations.
- Reuse the task context/action and PTY prompt-injection flow rather than inventing a parallel agent-send path.
- Avoid database persistence unless needed; task-lifetime state is acceptable if consistent with existing draft comments.
- Avoid unrelated refactors.
- Do not create parallel state systems, parallel IPC, parallel agent-send flows, or broad abstractions that collide with existing browser/task/conversation architecture.
- Keep types explicit, shared boundaries clean, and tests colocated with comparable existing tests.

UI and UX quality bar:
- The browser annotation UI must feel native to Emdash, not bolted on.
- Match existing toolbar density, spacing, icons, popovers, buttons, text sizing, disabled states, and keyboard behavior.
- Focused, hovered, and selected page targets should use restrained blue accents so the annotated area is clear without overwhelming the page.
- Annotation composer and pending annotation UI should be compact, polished, keyboard-friendly, and consistent with existing Emdash controls.
- Do not add explanatory in-app copy beyond what the workflow needs.

Between iterations:
- Inspect current browser/task/conversation code before editing.
- Make the smallest coherent vertical slice, test it, then continue.
- Keep a running list of changed files, tests added, and remaining gaps.

Stop as blocked only if:
- Electron webview limitations prevent safe element capture without a different architecture.
- The active-agent send path cannot be reused without broader conversation subsystem changes.
- Required behavior conflicts with repo security constraints.

Completion evidence:
- Focused tests cover annotation formatting, store behavior, context action inclusion/consumption, browser annotation controls, and browser capture behavior.
- pnpm run format
- pnpm run lint
- pnpm run typecheck
- pnpm run test
```
