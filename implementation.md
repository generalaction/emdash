# Chat UI Implementation Log

## Step 1: Settings and Renderer Split

Completed phase 1 from `docs/design.md`.

Files and modules changed:

- Added `conversationUiMode` to interface settings schema/defaults and exposed it in the Interface
  settings UI with a terminal/chat segmented control.
- Added persisted `runtimeMode` to conversations, generated migration `0012`, regenerated DB
  fixtures, and added migration coverage.
- Added shared runtime helpers in `src/shared/conversations.ts`:
  `supportsChatRuntime`, `shouldUseChatRuntime`, and `resolveConversationRuntimeMode`.
- Kept `terminalOnly` as provider chat-UI capability metadata while gating runnable chat behavior
  separately through implemented runtime support.
- Added a minimal Codex chat runtime boundary under `src/main/core/conversations/chat/`.
- Updated create, hydrate, dehydrate, delete, and task restoration paths so terminal and chat
  runtimes are not active simultaneously.
- Split `ConversationsPanel` into a mode switch plus `TerminalConversationPanel` and
  `ChatConversationPanel`.
- Updated renderer conversation session management so PTY sessions are created only for terminal
  fallback/runtime paths.
- Added DB-backed create/hydrate tests, renderer branch/store tests, settings selection tests, shared
  provider/runtime tests, migration tests, and supporting fixture updates.

Key decisions:

- Chat UI selection is persisted per conversation as `runtimeMode`; the global app setting applies
  only to new conversations.
- `terminalOnly: false` means a provider is known to support a chat UI model, but it does not by
  itself mean Emdash has a runnable chat adapter.
- Codex is the first implemented chat runtime boundary in this step. Other chat-capable providers
  still fall back to terminal until an adapter exists.
- Chat runtime state is intentionally minimal in this step; timeline/RPC/message streaming remain
  later phases.
- Existing terminal conversations and terminal-only providers continue through the PTY path.

Validation:

- `pnpm run db:fixtures`: passed.
- `pnpm run test:migrations`: passed.
- `pnpm run format`: passed.
- `pnpm run lint`: passed.
- `pnpm run typecheck`: passed.
- `pnpm run test`: passed, 188 files / 1201 tests.
- One SSH transport test failed once during an earlier full run, then passed on focused rerun and on
  the final full gate.
- Playwright's browser installer did not support this Ubuntu 26.04 image; system Chromium was
  installed and made available so the browser project could run.

Review loop:

- Architecture reviewer initially found high issues around inert chat conversations and conflated
  provider capability/runtime support. Fixed by separating provider chat UI metadata from runnable
  chat runtime support and adding a runtime boundary.
- Logic reviewer initially found the same high fallback issue. Fixed with the same runtime boundary
  and terminal fallback changes.
- Test reviewer initially found the same high issue plus medium issues around over-mocked
  create/hydrate tests, missing mounted renderer coverage, and fallback coverage using a chat-capable
  provider. Fixed by using DB-backed tests with the real `taskManager` lookup path, adding mounted
  `ConversationsPanel` branch coverage, and using `grok` for terminal-only fallback tests.
- Follow-up architecture and logic reviewers found no high/medium issues.
- Follow-up test reviewer found no high/medium issues.

Remaining risks and follow-ups:

- Chat timeline storage, structured provider event streaming, composer send/cancel, permission
  handling, and durable replay are still future phases.
- The minimal Codex chat runtime tracks active conversations but does not yet execute provider work.
- Broader provider adapters should only be enabled in `supportsChatRuntime` when their real runtime
  path exists.

## Step 2: DB-Backed Timeline, RPC, and Chat Runtime Execution Boundary

Completed the timeline/RPC phase from `docs/design.md`.

Files and modules changed:

- Added shared conversation timeline item types, send inputs, permission response types, and status
  types in `src/shared/conversation-timeline.ts`.
- Added `conversation_timeline_items` via migration `0013`, updated Drizzle schema relations/types,
  regenerated fixtures, and added migration coverage.
- Added `ChatTimelineStore` for canonical DB-backed timeline append/list/tail reads, per-conversation
  sequence assignment, payload validation, event emission, and latest assistant-message lookup.
- Added typed conversation timeline/status/permission events.
- Added conversation RPC methods for timeline fetch, message send, cancellation, and permission
  response.
- Extended `ConversationProvider` with `sendInput` and `interruptSession` so chat runtime backend
  execution stays behind the provider boundary.
- Updated local and SSH conversation providers to write/interrupt their managed PTY sessions through
  that provider interface.
- Updated Codex chat runtime so chat-mode conversations start the provider backend, persist user
  timeline items before sending backend input, append error timeline items on backend send failures,
  interrupt on cancel, explicitly reject unsupported permission responses, and initialize assistant
  dedupe from persisted timeline state.
- Forwarded Codex idle hook stdin to the hook server so assistant payloads can be extracted when the
  provider supplies them; wired hook/classifier events into chat timeline recording.
- Added renderer `ConversationTimelineStore` with event merging and stale-load protection.
- Updated renderer conversation management and chat panel so chat timelines are created for chat
  conversations, started only when the chat panel is active, and send through RPC.
- Removed the temporary `initialPrompt` config handoff; new chat prompts are stored in timeline rows.
- Added focused unit, DB, migration, renderer, and hook tests for the new boundary.

Key decisions:

- The DB timeline is the canonical chat display/replay boundary. Terminal output remains separate.
- Codex chat mode uses the existing provider PTY as the execution backend for this phase, while the
  chat UI persists and renders timeline rows.
- Provider side effects happen only through `ConversationProvider`; the chat runtime does not reach
  into PTY registry internals.
- Timeline reads return the latest tail by default, then sort ascending for rendering.
- Permission response RPC is present as a typed boundary but intentionally returns an explicit
  unsupported error until provider-specific permission delivery exists.

Validation:

- `pnpm run db:fixtures`: passed.
- `pnpm run test:migrations`: passed.
- `pnpm run format`: passed.
- `pnpm run lint`: passed.
- `pnpm run typecheck`: passed.
- `pnpm run test`: passed, 197 files / 1244 tests.

Review loop:

- Round 1 found high/medium issues around inert Codex chat execution, missing status/recency wiring,
  eager timeline loading, oldest-first default timeline reads, stale renderer load overwrites, and
  missing coverage. Fixed by starting a provider backend for Codex chat, wiring status/input events,
  lazy-starting timeline stores, returning latest timeline tails, merging stale loads, and adding
  tests.
- Round 2 found medium issues around direct PTY coupling, no-op cancel/permission behavior, missing
  compensation coverage, missing backend coverage, and a missing component branch test. Fixed by
  routing backend input/interrupt through `ConversationProvider`, interrupting on cancel, explicitly
  rejecting permission responses, restoring `ConversationsPanel` coverage, and adding compensation
  and missing-backend tests.
- Round 3 found medium issues around provider side effects before durable timeline writes, runtime
  registration after backend startup, assistant-message capture/dedupe durability, and the component
  branch test file state. Fixed by persisting timeline rows before backend input, recording backend
  send failures as timeline errors, registering runtime before backend startup, forwarding Codex idle
  hook stdin, initializing assistant dedupe from persisted timeline, and restoring the component test.
- Final architecture, logic, and test reviewers found no high/medium issues.

Remaining risks and follow-ups:

- Permission response delivery still needs provider-specific implementation.
- Assistant-message capture depends on provider hook payloads exposing assistant text; richer
  provider-native parsing may still be needed in later phases.
- The chat panel rendering is intentionally basic in this step; richer Paseo-inspired message
  layout and composer polish remain future UI work.
