# Browser Annotations Design

## Objective

Let users leave structured comments on rendered elements inside Emdash's in-app browser and send those annotations to the active task agent by pasting into the active terminal, with optional submit.

This should feel like in-app browser comments: the user points at the rendered UI, writes concise feedback, and the agent receives enough structured context to locate and fix the relevant code.

The implementation must meet the same quality bar as the surrounding Emdash code. It should fit the existing browser, task, conversation, typed RPC, MobX store, and PTY prompt-injection patterns instead of creating parallel systems.

## Non-Goals

- Computed styles in v1.
- MCP or webhook sync.
- DB-backed annotation history.
- Bidirectional agent resolve/acknowledge lifecycle.
- Requiring users to install Agentation into their app.
- Broad browser automation or full CDP developer mode.
- Refactoring unrelated task, terminal, or browser architecture.

## User Workflow

1. User opens a task browser tab.
2. User toggles Annotation mode from the browser toolbar.
3. User clicks a rendered element, selects text, or drags a rectangular area.
4. Emdash opens a trusted annotation composer outside the untrusted page.
5. User enters feedback and saves the annotation.
6. The annotation appears as pending task context.
7. User applies browser annotations to the active agent session, with an option to submit immediately.
8. Emdash pastes formatted annotation context into the active terminal.
9. If paste/send succeeds, consumed annotations are cleared.

## UI And UX Requirements

The UI must feel native to Emdash.

- Match existing browser toolbar density, icon button sizing, menu behavior, spacing, border treatment, text sizing, and disabled/loading states.
- Use existing shared UI primitives where they fit: `Button`, `Tooltip`, popover/menu/dialog primitives, text inputs, and related controls.
- Use lucide icons that match the surrounding browser toolbar style.
- Keep annotation controls compact and task-oriented; do not introduce a marketing-style panel or large instructional surface.
- Annotation mode should have a clear active state in the toolbar.
- Hovered, focused, and selected page targets should use restrained blue accents: a blue outline or translucent blue overlay, with enough contrast to identify the target without obscuring the page.
- Area selections should show a blue selection rectangle with stable dimensions during drag.
- The annotation composer should be small, polished, keyboard-friendly, and anchored near the selected target when practical.
- The composer should support save, cancel, and optional immediate send without forcing the user through a modal unless the existing UI pattern strongly favors one.
- Pending annotations should be visible through a count, compact list, or existing context-action affordance without crowding the browser chrome.
- Keyboard behavior should be predictable: Escape exits annotation/selection/composer state, Enter saves where appropriate, and focus returns to the browser or active terminal after send.
- Text must fit inside controls at normal desktop sizes and not overlap toolbar or page overlay elements.
- Blue accents should be limited to annotation target focus/selection states and not become the dominant page palette.

## Data Model

Create Emdash-owned shared types while keeping Agentation AFS v1.1 naming where practical.

```ts
type BrowserAnnotationKind = 'element' | 'text' | 'area';
type BrowserAnnotationStatus = 'pending' | 'sent' | 'dismissed';

type BrowserAnnotation = {
  id: string;
  taskId: string;
  browserId: string;
  kind: BrowserAnnotationKind;
  status: BrowserAnnotationStatus;
  comment: string;
  url: string;
  title?: string;
  elementPath: string;
  element: string;
  cssClasses?: string;
  nearbyText?: string;
  selectedText?: string;
  x: number;
  y: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  createdAt: string;
  updatedAt: string;
};
```

Computed styles should not be included in v1, but the model should leave a clean extension point for them.

## Architecture

### Browser Feature

Own these pieces under `apps/emdash-desktop/src/renderer/features/browser/`:

- Annotation mode toolbar control.
- Trusted overlay mounted around `BrowserPane`, not inside the page.
- Hover/click/drag interaction state.
- Annotation composer UI.
- Pending annotation display or count.
- Browser annotation store or browser-facing store adapter.

### Shared Types And Formatting

Add shared browser annotation types and formatter near existing shared browser/task context code:

- Prefer a dedicated shared module if `src/shared/browser.ts` becomes too broad.
- Formatter should produce concise agent-readable context, similar in spirit to `src/shared/lineComments.ts`.
- The output should clearly separate annotations and include URL, selector/path, element, classes, text context, bounding box, and feedback.

### Main Browser Domain

Use `apps/emdash-desktop/src/main/core/browser/` if element capture needs bound `WebContents`.

Expected direction:

- Add typed RPC methods to `src/main/core/browser/controller.ts` only if needed.
- Reuse `browserWebContentsRegistry` for browserId to `WebContents` lookup.
- Execute only static inspection JavaScript.
- Return structured JSON data to trusted renderer UI.
- Do not expose app APIs or Node primitives to the page.

### Task Context And Agent Assignment

Integrate with the existing task context flow:

- Extend `src/renderer/features/tasks/conversations/context-actions.ts` with a browser-annotations action.
- Extend `src/renderer/features/tasks/conversations/context-bar.tsx` so browser annotations can be pasted into the active PTY session and optionally submitted.
- Reuse `pastePromptInjection` and `rpc.pty.sendInput`.
- Consume annotations only after successful paste/send.

This should not create a parallel "send to agent" architecture.

## Code Quality Requirements

- Preserve existing file ownership boundaries.
- Prefer small modules inside the browser feature over large mixed-responsibility files.
- Keep shared types and formatters framework-free and testable.
- Keep controller handlers thin; put browser capture logic in a focused helper or service if it grows.
- Do not weaken existing webview security, URL validation, profile partitioning, shortcut routing, screenshot behavior, or DevTools behavior.
- Do not use `any`; keep browser/Electron type escapes narrow and documented when unavoidable.
- Do not use non-null assertions for task/project readiness helpers.
- Do not add persistence, migrations, or settings unless required for the approved behavior.
- Preserve existing tests and add focused tests that match nearby test style.

## Relevant Files

- `apps/emdash-desktop/src/renderer/features/browser/browser-pane.tsx`
- `apps/emdash-desktop/src/renderer/features/browser/browser-toolbar.tsx`
- `apps/emdash-desktop/src/renderer/features/browser/browser-webview-types.ts`
- `apps/emdash-desktop/src/renderer/features/browser/browser-session-store.ts`
- `apps/emdash-desktop/src/renderer/features/browser/browser-tab-provider.tsx`
- `apps/emdash-desktop/src/main/core/browser/controller.ts`
- `apps/emdash-desktop/src/main/core/browser/browser-webcontents-registry.ts`
- `apps/emdash-desktop/src/shared/browser.ts`
- `apps/emdash-desktop/src/shared/events/browserEvents.ts`
- `apps/emdash-desktop/src/renderer/features/tasks/conversations/context-actions.ts`
- `apps/emdash-desktop/src/renderer/features/tasks/conversations/context-bar.tsx`
- `apps/emdash-desktop/src/renderer/features/tasks/diff-view/stores/draft-comments-store.ts`
- `apps/emdash-desktop/src/shared/lineComments.ts`
- `apps/emdash-desktop/src/renderer/features/tasks/stores/task-store.ts`
- `apps/emdash-desktop/src/renderer/features/tasks/task-view-context.tsx`
- `apps/emdash-desktop/src/main/rpc.ts`

## Security Requirements

- Treat page content and returned DOM text as untrusted.
- Do not inject dynamic user-authored JavaScript.
- Do not expose Node, Electron, filesystem, RPC, PTY, or app internals to the page.
- Keep annotation UI outside the webview page context.
- Sanitize or escape annotation output when formatting for the agent.
- Preserve existing webview hardening and navigation restrictions.

## Edge Cases

- No active browser session.
- Webview not ready or navigation in progress.
- Annotation mode active while page navigates.
- Element removed between hover and click.
- Cross-origin iframes that cannot be inspected.
- Shadow DOM elements.
- Text selection spanning multiple nodes.
- Very small or offscreen elements.
- Page zoom and scroll offsets.
- Browser tab hidden but session still mounted.
- No active agent session.
- Terminal paste succeeds but submit fails.
- Annotation limit reached.
- User clears or dismisses annotations before sending.

## Testing Plan

Add focused tests for:

- Annotation formatter escaping and output shape.
- Browser annotation store add/update/delete/consume behavior.
- Context action inclusion, count, and text generation.
- Successful context apply consumes browser annotations.
- Failed context apply does not consume browser annotations.
- Browser toolbar Annotation mode control state.
- Element capture helper behavior for representative DOM nodes.
- Existing browser navigation, screenshot, and webview event tests remain green.

## Validation Commands

Run from the repo root:

```bash
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm run test
```
