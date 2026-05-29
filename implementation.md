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

## Step 5: Tool Calls and Permissions

Completed the tool-call and permission phase from `docs/design.md`.

Files and modules changed:

- Extended structured agent-event payloads and the event enricher to preserve provider request,
  tool-call, tool-status, tool-input, tool-output, and tool-error metadata.
- Updated the Codex chat adapter to map tool-call events into stable timeline items, map Codex
  permission prompts into pending permission-request items, and send Codex permission responses
  through the active PTY backend.
- Extended the chat timeline store with conversation-scoped stable upserts, pending permission
  lookup, permission resolution, pending permission cancellation, and delivery-status update
  predicates for pending, started, delivered, and cancelled states.
- Hardened the chat runtime permission-response flow, cancellation/dehydration cleanup, backend-exit
  cleanup, and task-level teardown/detach cleanup.
- Added renderer actions for permission responses, expanded tool-call rendering, and added
  status-gated permission cards with inline response errors.
- Added focused main-process, DB-backed, adapter, and renderer tests for structured hook fields,
  tool-call upserts, permission response ordering, cancellation, backend failures, dehydrate/delete
  cleanup, task teardown, and renderer response behavior.

Key decisions:

- Provider-specific tool-call and permission mapping stays inside chat provider adapters; renderer
  code consumes provider-neutral timeline item types.
- Stable provider ids are persisted as conversation-scoped timeline ids to avoid cross-conversation
  primary-key collisions, then restored to provider-visible ids when rows are listed or emitted.
- Permission delivery is backend-first. If backend delivery fails, the permission card stays pending
  and retryable; if timeline resolution fails after delivery, the runtime moves forward and records a
  best-effort error marker.
- Pending permission requests are cancelled on user cancellation, backend exit, conversation
  dehydrate/delete, and task teardown/detach to avoid stale actionable rows after restart.
- Codex permission responses are a best-effort TUI mapping until a native structured permission API
  is available.

Validation:

- Focused impacted suite:
  `pnpm exec vitest run src/main/core/conversations/chat/provider-adapters/codex-chat-adapter.test.ts src/main/core/conversations/chat/chat-conversation-runtime.test.ts src/main/core/conversations/chat/chat-timeline-store.db.test.ts src/main/core/conversations/dehydrateConversation.test.ts src/main/core/agent-hooks/event-enricher.db.test.ts src/renderer/features/tasks/conversations/conversation-timeline-store.test.ts src/renderer/features/tasks/conversations/conversation-manager.test.ts src/renderer/features/tasks/conversations/chat-conversation-panel.test.ts`:
  passed, 8 files / 139 tests.
- `pnpm run format`: passed.
- `pnpm run lint`: passed.
- `pnpm run typecheck`: passed.
- `pnpm run test`: passed, 200 files / 1371 tests.

Review loop:

- Round 1 found high/medium issues around cross-conversation stable-id collisions and stale
  cancelled permission rows. Fixed with conversation-scoped persisted ids and pending permission
  cancellation on cancel, backend exit, dehydrate, and delete paths.
- Round 2 found high/medium issues around cancellation-in-flight races, backend-send failure
  ordering, post-send timeline-resolution failures, and dehydrate/remount stale rows. Fixed with
  runtime guards, backend-first permission delivery, retryable backend failures, best-effort
  post-send error markers, renderer status gating, and dehydrate/delete cleanup.
- Round 3 found a medium issue around task-level teardown leaving pending permission rows. Fixed by
  making chat task dehydration asynchronous and awaiting pending-permission cleanup during task
  manager teardown and project detach.
- Round 4 found a remaining ordering issue where permission resolution could still happen before
  backend delivery in one path and its tests. Fixed the final ordering and assertions.
- Final architecture, test, and logic reviewers found no high/medium issues.

Remaining risks and follow-ups:

- Broader provider-native tool and permission schemas are still deferred to the broader provider
  phase.
- Codex permission responses remain TUI-keystroke based and should be revisited if Codex exposes a
  structured permission-response API.

## Step 6 Follow-up: Codex App-Server Replacement

Replaced the incorrect Codex TUI-backed chat runtime with a Codex app-server runtime boundary,
following the current `docs/goal.md` direction to mirror Paseo's Codex server approach while keeping
terminal UI as the fallback.

Changes made:

- Removed the chat runtime dependency on Codex TUI/PTY startup, terminal hook forwarding, backend
  exit classifiers, and `y`/`n` permission keystroke injection.
- Added a JSON-RPC stdio transport and typed Codex app-server client for `initialize`,
  `thread/start`, `thread/loaded/list`, `thread/resume`, `turn/start`, `turn/interrupt`,
  `thread/compact/start`, and goal methods.
- Reworked `CodexChatAdapter` to spawn `codex app-server --listen stdio://`, gate
  `--enable goals` by Codex version, map app-server notifications into timeline/status events, and
  answer command/file/question permission requests with method-specific JSON-RPC result shapes.
- Updated `ChatConversationRuntime` so chat conversations activate app-server sessions directly,
  persist provider thread ids, append DB-backed user/timeline rows, handle out-of-band `/compact`
  and supported `/goal` commands without storing them as prompts, and clear or preserve responding
  state correctly across completion, command handling, cancellation, send failure, permission
  failure, and app-server exit.
- Added renderer command routing so advertised slash commands use the command RPC while unadvertised
  slash text falls through as a normal prompt.
- Added Codex user-input question metadata and answer transport, including multi-select answers,
  through the shared timeline response type, renderer permission card, runtime, and adapter.
- Serialized provider event forwarding so streamed app-server deltas cannot persist out of order.
- Bounded Codex version probing before app-server launch and fall back to goals disabled on probe
  failure or timeout.
- Added task workspace metadata needed by the chat runtime and kept SSH or unsupported providers on
  terminal fallback.
- Added conversation command RPC endpoints and renderer timeline-store handling for out-of-band
  command sends that do not return a persisted user message.
- Added a focused `test:coverage:chat` script and Vitest coverage thresholds for the changed
  chat/app-server scope.

Validation:

- `pnpm run format`: passed.
- `pnpm run lint`: passed.
- `pnpm run typecheck`: passed.
- `pnpm run test`: passed, 202 files / 1354 tests.
- `pnpm run test:coverage:chat`: passed, 8 files / 72 tests, with 91.74% statements, 80.63%
  branches, 92.00% functions, and 95.23% lines for the configured chat/app-server scope.

Review loop:

- Round 1 architecture and logic reviewers found high issues around app-server events not reaching
  runtime state, invalid Codex sandbox policy shapes, slash commands wedging `awaitingResponse`,
  malformed user-input permission responses, and app-server exits leaving conversations stuck. Fixed
  with direct runtime event forwarding, Codex `workspaceWrite` / `dangerFullAccess` sandbox policy
  objects, out-of-band command handling before user-message append, question-specific `{ answers }`
  responses, and transport/client exit propagation.
- Round 1 test reviewer found high/medium issues around missing app-server lifecycle/timeline
  coverage, permission method coverage, slash command coverage, and unenforced coverage goals.
  Fixed with fake app-server adapter tests, app-server client/transport tests, runtime state tests,
  DB-backed create/hydrate tests, renderer timeline-store tests, and the focused coverage gate.
- Round 2 architecture reviewer found issues around disabled `/goal` still being intercepted,
  Codex multi-select user-input requests being collapsed to one answer, and command RPC/runtime
  ownership. Fixed by making disabled `/goal` fall through to normal prompt sends, adding
  multi-answer question response support, routing renderer-recognized commands through the command
  RPC, and guarding command RPC execution with runtime state.
- Round 2 logic reviewer found issues around cancel-before-`turn/started`, concurrent provider
  event persistence ordering, and unbounded Codex version probing. Fixed by distinguishing
  pre-start cancellation, serializing provider event forwarding, and adding a timeout to the version
  probe.
- Round 3 logic reviewer found active-turn interrupt failures could clear runtime state while Codex
  may still run. Fixed by preserving the blocked runtime state on active-turn interrupt failure
  while still clearing the pre-start pending state.
- Final architecture, logic, and test reviewers found no high/medium issues.

Remaining risks and follow-ups:

- This step hardens the main-process Codex app-server runtime boundary. The renderer still needs the
  full Paseo-inspired chat composer/command UX using Emdash base components in the later UI step.
- The Codex app-server protocol mapping is intentionally narrower than Paseo's complete mapper; more
  detailed tool-call schemas and history replay can be expanded after the base server path is clean.

## Step 5 Follow-up: Recovery and Teardown Hardening

Completed the reviewer-driven hardening pass for chat permission recovery, hydration replay, and
provider teardown.

Changes made:

- Made chat hydration recovery idempotent for already-active conversations and restored cancelled
  permission rows when hydration activation or backend resume fails.
- Hardened permission-response races across backend exit, dehydrate, completion, cancellation,
  failed cancellation, and backend-write failure so retryable permission rows remain retryable and
  stale states do not resurrect.
- Preserved correct conversation status when hydration replay completes, including idle prompts with
  assistant text and working-to-idle recovery.
- Made local and SSH conversation tmux cleanup best-effort for both per-conversation stop and
  task-level destroy paths.
- Kept delete semantics DB-first while making backend/runtime cleanup best-effort after successful
  deletion.
- Added regression coverage for restored-chat hydration failure, activation failure, repeated
  hydration, clean/error backend exits, cancellation races, permission backend-write races, and
  local/SSH tmux cleanup failures.

Validation:

- Focused runtime/provider suites passed repeatedly while fixing reviewer findings.
- `pnpm run format:check`: passed.
- `pnpm run lint`: passed.
- `pnpm run typecheck`: passed.
- `pnpm run test`: passed, 200 files / 1417 tests.

Review loop:

- Architecture, coverage, and logic reviewers found medium issues across hydration activation,
  cancellation/permission races, delete/teardown ordering, and tmux cleanup. Each issue was fixed
  with targeted runtime/provider changes and regression tests.
- Per the updated reviewer-loop instruction, roles that returned clean were not rerun for the same
  step. Logic returned clean first; after the final hardening pass, architecture and coverage also
  returned no high/medium findings.

## Step 6 Follow-up: Paseo Notification Parity

Expanded the Codex app-server adapter toward Paseo-equivalent notification behavior.

Changes made:

- Added Codex app-server parsing for plan, diff, token usage, Codex event item lifecycle, exec
  command begin/end/output deltas, terminal interaction, patch apply begin/end, file-change output
  deltas, task-complete, and turn-aborted notifications.
- Mapped progress notifications into Emdash timeline rows using the existing provider-neutral
  `tool_call`, `assistant_message`, `reasoning`, `error`, and status models.
- Preserved command metadata across exec begin/end and canonical `commandExecution` mirror events.
- Buffered command and file-change output deltas and consumed them into completed tool rows.
- Prevented canonical mirrored `commandExecution` items from overwriting authoritative exec rows
  while still allowing richer mirrors to fill sparse exec completions.
- Ignored non-tool lifecycle rows such as assistant, agent, reasoning, and user-message items.
- Finalized progress and running tool rows as completed, cancelled, or failed on turn completion,
  abort, failure, and app-server exit so hydration cannot replay stale running rows.
- Cancelled pending app-server permission requests when terminal turn statuses arrive, including
  abort/idle status.

Validation:

- `pnpm run format`: passed.
- `pnpm run lint`: passed.
- `pnpm run typecheck`: passed.
- `pnpm run test`: passed, 202 files / 1357 tests.
- `pnpm run test:coverage:chat`: passed, 8 files / 75 tests, with 92.70% statements, 82.30%
  branches, 93.10% functions, and 95.89% lines for the configured chat/app-server scope.

Review loop:

- Architecture reviewer found medium issues around mirrored `commandExecution` rows overwriting
  authoritative exec rows and turn buffers surviving abort/completion. Fixed with richer exec mirror
  handling, per-turn buffer cleanup, and running-row finalization.
- Logic reviewer found medium issues around abort status, pending permission cleanup, non-zero exit
  codes, base64-shaped plain output chunks, text item casing, failed progress finalization, user
  message lifecycle rows, and app-server exit leaving running rows. Fixed each path and added
  regression coverage.
- Test reviewer found medium coverage gaps for exit-code handling, base64-shaped chunks, command
  preservation, sparse exec-end plus mirror ordering, begin/end/mirror ordering, and running tool
  rows on abort/failure/exit. Added focused fake app-server tests for those cases.
- Final architecture, test, and logic reviewer reruns found no high/medium issues.

Remaining risks and follow-ups:

- The mapping now covers the documented Paseo notification families, but Emdash still renders them
  through the current generic tool-call timeline model. Richer per-tool UI can be layered on top of
  these persisted rows later.

## Step 7: Slash Command Suggestions

Added the Paseo-style slash command suggestion path to the Emdash chat composer.

Changes made:

- Wired `ChatComposer` to load conversation-scoped slash commands through the existing
  `conversations.listCommands` path.
- Added an Emdash-native inline command menu that appears when the draft starts with `/`, filters
  known commands locally, and displays command names and descriptions.
- Added mouse, Tab, Enter, and arrow-key interaction for the command menu. Enter selects a
  highlighted partial match instead of sending an unrecognized partial slash command to the agent.
- Kept command execution at the existing panel boundary: selected text is still submitted through
  the same `executeCommand` path used by direct `/compact` and `/goal` entry.
- Cached successful command lists per conversation scope and allowed failures to retry on the next
  slash activation instead of caching an empty failure result.
- Added renderer regression tests for command-menu rendering, mouse selection, Enter selection, and
  command-list load caching.

Validation:

- Focused `chat-conversation-panel` suite passed, 21 tests.
- `pnpm run format`: passed.
- `pnpm run lint`: passed.
- `pnpm run typecheck`: passed.
- `pnpm run test`: passed, 202 files / 1360 tests.
- `pnpm run test:coverage:chat`: passed, 8 files / 75 tests, with 92.70% statements, 82.30%
  branches, 93.10% functions, and 95.89% lines for the configured chat/app-server scope.

Review loop:

- Architecture reviewer found a medium issue where command loading was coupled to every slash-query
  edit and transient failures were cached. Fixed with conversation-scoped successful caching,
  local filtering, and retryable failed loads.
- Test and logic reviewers found a medium issue where Enter on a highlighted partial slash command
  sent the partial command as a normal message. Fixed Enter selection and added regression coverage.
- Final architecture, test, and logic reviewer reruns found no high/medium issues.

## Step 8: Paseo Slash Command Parity

Expanded Codex slash command behavior to cover Paseo-style prompt commands and skills, and tightened
the command submission boundary.

Changes made:

- Added `skills/list` support to the Codex app-server client and preserved skill metadata, including
  descriptions, paths, and disabled state.
- Listed built-in out-of-band commands, app-server skills, fallback filesystem skills, and
  `CODEX_HOME/prompts/*.md` custom prompts as slash suggestions.
- Split command metadata into `out-of-band` and `prompt` execution modes. The renderer now submits
  slash text through `sendMessage`; the runtime intercepts `/compact` and `/goal` before persistence,
  while prompt-like skills and custom prompts flow through normal `turn/start`.
- Converted app-server skills into Codex skill input blocks, fallback filesystem skills into `$skill`
  prompt text, and custom prompts into expanded prompt text with Paseo-compatible `$ARGUMENTS`,
  positional, named, and escaped-dollar substitution.
- Added custom prompt filename validation so unsafe names fall back to visible slash text instead of
  reading outside the prompts directory.
- Filtered disabled app-server skills and disabled fallback `SKILL.md` entries. App-server skill
  metadata is treated as authoritative once loaded, including the empty-list case; fallback
  filesystem discovery only runs when app-server skill metadata is unavailable.
- Preserved the last successful app-server skill metadata across later `skills/list` failures.
- Added cancellable turn-preparation handling for prompt-like slash input so slow skill metadata
  lookup cannot start a turn after the user cancels. Overlapping preparations are tracked by
  generation to avoid stale cleanup from one send affecting another.
- Updated the fake app-server test harness to handle async request handlers.

Validation:

- Focused runtime/provider/panel suites passed, 69 tests.
- `pnpm run format`: passed.
- `pnpm run lint`: passed.
- `pnpm run typecheck`: passed.
- `pnpm run test`: passed, 202 files / 1370 tests.
- `pnpm run test:coverage:chat`: passed, 8 files / 84 tests, with 91.80% statements, 81.00%
  branches, 92.94% functions, and 95.07% lines for the configured chat/app-server scope.

Review loop:

- Architecture reviewer found medium issues around prompt-like commands being routed through
  out-of-band execution and unsafe custom prompt names. Fixed with command execution metadata,
  prompt-name validation, and renderer routing changes.
- Test reviewer found high/medium gaps around actual UI routing, empty custom prompt expansion, and
  cache-preservation coverage. Fixed with panel and adapter regressions.
- Logic reviewer found medium issues around disabled skills, fallback reintroduction, cache clearing,
  successful empty app-server metadata, prompt-resolution cancellation, overlapping preparation
  cancellation, and submit-time command lookup in the renderer. Fixed each path with focused
  runtime/provider/renderer tests.
- Final architecture, test, and logic reviewer reruns found no high/medium issues.
