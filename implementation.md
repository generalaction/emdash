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

## Step 3: Codex Provider Adapter Boundary

Completed the first provider-adapter phase from `docs/design.md`.

Files and modules changed:

- Added `ChatProviderAdapter` and runtime event types in
  `src/main/core/conversations/chat/types.ts`.
- Added the Codex chat adapter under `src/main/core/conversations/chat/provider-adapters/`.
- Moved Codex prompt formatting, cancellation, status mapping, assistant message mapping, and error
  mapping out of `ChatConversationRuntime` and behind the adapter boundary.
- Updated `ChatConversationRuntime` to select adapters by provider id, persist user messages before
  provider delivery, emit mapped adapter statuses/timeline rows, dedupe assistant messages, and
  fence cancelled turns from late provider events.
- Extended `ChatTimelineStore` with deferred item emission and deletion so failed or cancelled sends
  do not leak optimistic user messages into the renderer.
- Extended deferred user-message persistence with explicit pending, delivery-started, and
  delivered-pending-emit states so recovery can distinguish unsent rows, uncertain delivery, and
  confirmed backend delivery.
- Added backend readiness invalidation across backend exits, delivery failures, and cancellation so
  TUI-backed chat sends wait for a fresh prompt after session disruption.
- Updated classifier wiring so classifier status/error labels are not treated as assistant text and
  chat timeline recording completes before renderer `agent:event` emission.
- Updated renderer conversation management so chat conversations ignore raw agent lifecycle and PTY
  session-exit status paths, relying on `conversation:status` instead.
- Added a chat cancel path through the renderer timeline store, conversation manager, and chat panel,
  and disabled sends while the provider turn is working.
- Split the chat panel rendering/composer into focused renderer components while keeping state
  changes routed through the existing conversation manager/timeline stores.
- Moved chat conversation deletion to stop the provider session before deleting the conversation row.
- Updated conversation hydration reconciliation so workspace resume can hydrate conversations again
  after disposal.
- Added a lightweight main-process session-exit hook so providers can notify the chat runtime about
  backend exits without importing the runtime from PTY provider implementations.
- Added focused adapter, runtime, classifier, renderer, and DB-backed cancellation coverage.

Key decisions:

- Provider-specific chat behavior lives in adapters; the runtime owns persistence/order,
  cancellation fencing, and event emission.
- Classifier `message` remains a status/error label. Only hook/provider-native
  `lastAssistantMessage` can become an assistant timeline row.
- User timeline rows are written before provider input delivery, but hidden until the runtime either
  confirms backend delivery or recovers them with an explicit uncertainty marker.
- Cancellation interrupts the provider before marking the turn cancelled; the cancellation timeline
  marker is best-effort and must not block backend interruption.
- Chat sends remain pending until backend delivery succeeds, then stay blocked while the provider is
  responding until a mapped completion, error, or attention status arrives.

Validation:

- `pnpm run format`: passed.
- Focused regression tests for adapter/runtime/timeline/provider/task/renderer paths: passed,
  11 files / 94 tests.
- `pnpm run lint`: passed.
- `pnpm run typecheck`: passed.
- `pnpm run test`: passed, 200 files / 1322 tests.

Review loop:

- Round 1 found medium issues around weak Codex wire-format assertions, classifier status labels
  being persisted as assistant messages, raw renderer agent events still owning chat state, late
  cancelled-turn events, and classifier event emission racing timeline persistence. Fixed with exact
  adapter tests, classifier payload changes, renderer chat guards, cancellation fencing, and awaited
  classifier timeline recording.
- Round 2 found medium issues around provider delivery before durable user-message persistence,
  cancellation append ordering, PTY session-exit status ownership, and missing DB-backed cancellation
  coverage. Fixed by persisting before provider send, interrupting before cancellation state/marker,
  ignoring PTY session exits for chat conversations, and adding DB-backed cancellation replay
  coverage.
- Round 3 found medium issues around provider events arriving while message persistence or
  cancellation interruption was in flight, plus classifier notification failures blocking agent-event
  emission. Fixed by buffering mapped provider events during a pending send, only marking
  cancellation after interrupt succeeds, and making notification failures non-fatal.
- Round 4 found medium issues around cancellation racing a send that was waiting on timeline
  persistence, missing DB coverage for normal mapped hook events, timeline append failures blocking
  later status updates, and overlapping sends while the provider turn was still running. Fixed by
  cancelling unsent pending turns without provider delivery, adding DB-backed assistant/error event
  coverage, continuing status mapping after timeline append failures, and blocking new sends until a
  mapped terminal/attention status arrives.
- Round 5 found medium issues around cancellation while backend delivery was in flight, stale
  cancelled-turn output leaking into the next pending send, backend-send rollback failures skipping
  error status, initial prompts not blocking overlapping sends, and idle startup prompts marking chat
  conversations completed. Fixed by treating cancellation as fatal after backend delivery resolves,
  suppressing buffered events for the next send after cancellation, making silent rollback failures
  non-fatal, marking initial prompts as awaiting a response, and ignoring completion/attention
  statuses when no response is active.
- Round 6 found medium issues around later sends being able to clear cancellation state for an
  earlier in-flight send, chat initial prompts bypassing the chat adapter/runtime send boundary, and
  missing coverage for pending-send overlap and startup prompt behavior. Fixed by keeping cancelled
  pending turns until their original backend delivery resolves, routing chat initial prompts through
  `sendMessage` after backend startup, persisting user messages silently before backend delivery, and
  adding focused runtime/DB/renderer coverage.
- Round 7 found high/medium issues around failed cancellation leaving pending turns marked
  cancelled, retry sends inheriting event suppression from failed sends/cancelled turns, pending
  silent rows replaying after process restart, chat backend exits no longer clearing runtime state,
  and initial chat prompts bypassing PTY startup readiness. Fixed by restoring pending-turn
  cancellation state on interrupt failure, scoping orphan-event suppression to the failed turn,
  storing silent rows with a durable pending-delivery marker that replay filters until commit,
  translating provider session exits through a decoupled main-process hook, and waiting for the
  existing initial-prompt readiness gate before sending chat initial prompts through the adapter.
- Round 8 found high/medium issues around unsupported Codex permission prompts looking actionable in
  chat UI, intentional stop/delete exits mutating active chat status, cancellation showing idle while
  the original send was still resolving, backend exits racing in-flight backend delivery, and
  awaiting-input not keeping the composer in a cancelable state. Fixed by surfacing unsupported
  interactive prompts as explicit timeline errors while keeping the turn cancelable, deactivating
  chat runtime before intentional provider stops, keeping cancellation status blocked until the
  original send resolves, deferring backend-exit handling until the delivered user message is
  committed, and treating awaiting-input as a blocked/cancelable composer state.
- Round 9 found high/medium issues around content-bearing hook events being dropped after stale
  classifier completion, unsupported interactive prompts being blocked only by renderer state,
  initial-prompt status races forcing new chat conversations to working, intentional task teardown
  being recorded as backend failure, stale pending-delivery rows lacking recovery, backend-exit
  races during pending flush, dehydrate/delete dropping runtime state on failed stops, and next-turn
  event suppression losing real provider events. Fixed by ignoring only status-only stale
  notifications, blocking unsupported interactive prompts in the main runtime, avoiding renderer
  forced-working for new chat conversations, suppressing backend-exit handling during task teardown,
  deleting stale pending user rows on runtime activation, carrying pending backend exits through
  flush, preserving runtime state when stop fails, and removing next-turn provider-event
  suppression.
- Rounds 10-16 found medium issues around clearing `awaitingInput` on cancellation, preserving
  events during failed cancellation, startup readiness for hydrated chat sends, pending user-message
  crash recovery, backend exits while awaiting input, optimistic create-time status races,
  backend-readiness lifetime, delivered-marker failure recovery, crash-atomic uncertainty recovery,
  cancellation during delivery-start marking, successful-cancel readiness invalidation, backend exits
  racing the pre-send window, cancelled turns being marked delivered, orphan provider output after
  pre-delivery aborts, and cancellation being misclassified as backend send failure. Fixed by
  restoring blocked status on failed cancellation, buffering cancellation-in-flight events,
  centralizing readiness in the chat runtime, adding pending/delivery-started/delivered recovery
  states, making delivery-started recovery transactional, checking backend-exit generations before
  external writes, invalidating readiness on exits/failures/cancel, suppressing orphan events after
  pre-delivery aborts, and treating in-flight cancellation as cancellation rather than send failure.
- Final reviewer state: logic reviewer reported no high/medium issues in round 2; architecture and
  test reviewers reported no high/medium issues in round 7 after the follow-up fixes.

Remaining risks and follow-ups:

- Permission responses are still typed but unsupported until the tool-call/permission phase.
- Codex remains the only registered chat adapter; broader provider support is intentionally deferred.
- The chat UI is still MVP-level and will be refined in the dedicated UI step.

## Step 4: Chat UI MVP

Completed the chat UI MVP phase from `docs/design.md`.

Files and modules changed:

- Updated the renderer chat timeline store to add optimistic user messages, pass stable message ids
  through `sendMessage`, reconcile the canonical persisted row, and roll back failed sends.
- Expanded the chat composer with pending send/cancel state, local error display, IME-aware Enter
  handling, duplicate-send protection, draft restoration on real send failure, and cancellation
  handling that does not resurrect cancelled drafts.
- Kept cancel available while a chat turn is working or awaiting input, including while the send RPC
  is still settling.
- Hardened `ChatConversationRuntime` around cancellation races before backend delivery, including
  hidden-row cancellation markers, guarded delivery-start writes, stale-turn ownership checks, and
  late cancelled readiness/append/delivery-start failures.
- Added durable cancelled-delivery recovery behavior to `ChatTimelineStore` so cancelled hidden user
  rows do not replay after restart.
- Added focused renderer, runtime, DB, and timeline-store coverage for optimistic sends, rollback,
  reconciliation, composer keyboard behavior, cancellation availability, stale cancelled sends, and
  cancelled-row recovery.

Key decisions:

- The renderer may optimistically display only the user's own draft message; the DB-backed timeline
  remains canonical and reconciles by message id.
- Cancellation before backend delivery removes hidden user rows from the visible timeline and records
  a cancellation marker rather than surfacing a backend-send error.
- A cancelled turn owns only its own pending async work. Late failures from a cancelled or stale turn
  must not clear, suppress, or mark error on a newer turn.
- Chat composer state treats cancellation as an expected outcome for the cancelled send, not as a
  reason to restore an old draft over newer user input.

Validation:

- Focused runtime tests:
  `pnpm exec vitest run src/main/core/conversations/chat/chat-conversation-runtime.test.ts src/main/core/conversations/chat/chat-conversation-runtime.db.test.ts`:
  passed, 70 tests.
- `pnpm run format`: passed.
- `pnpm run lint`: passed.
- `pnpm run typecheck`: passed.
- `pnpm run test`: passed, 200 files / 1353 tests.

Review loop:

- Architecture reviewer found medium issues around cancelled hidden user rows being recoverable after
  restart and cancellation racing delivery-start marking. Fixed with a durable cancelled delivery
  marker, guarded delivery-start writes, recovery filtering, and DB coverage.
- Test reviewer found medium issues around optimistic renderer sends, composer duplicate/error/cancel
  behavior, cancellation race coverage, and stale cancelled sends. Fixed with renderer store/component
  tests, runtime unit tests, and DB-backed recovery tests.
- Logic reviewer found medium issues around stale cancelled sends clearing newer turns, cancellation
  being misreported as backend send failure, and cancel availability while a send RPC was pending.
  Fixed with turn ownership checks, cancellation-aware failure handling, and composer run-id guards.
- Follow-up test review found one remaining medium issue for cancelled pre-backend sends whose
  pending readiness/append/delivery-start operation later rejected without a newer turn. Fixed by
  treating already-cleared cancelled turns as cancellation and adding targeted coverage for all three
  failure points.
- Final architecture, logic, and test reviewers found no high/medium issues.

Remaining risks and follow-ups:

- Tool calls and permission responses remain intentionally unsupported until the next design phase.
- The UI is functionally complete for the MVP but still intentionally plain; richer message/tool-call
  rendering belongs in the next steps.
- Codex remains the only implemented chat runtime target.
