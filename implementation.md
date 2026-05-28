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
