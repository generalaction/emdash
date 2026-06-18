# @emdash/chat-ui — Public API

A Solid-based chat transcript renderer with a pretext layout engine. It
virtualizes long conversations, renders markdown/code/diffs/tool calls, and
exposes a small imperative handle for streaming and scroll control.

The package ships two entry points:

- `@emdash/chat-ui` — the Solid mount function `mountChat`.
- `@emdash/chat-ui/react` — a thin React wrapper component `ChatTranscript`.

Everything below is the supported surface. Internals (components, layout
engine, stores) are not exported and may change without notice.

---

## Installation & styles

```ts
import { mountChat } from '@emdash/chat-ui';
import '@emdash/chat-ui/style.css';
```

Optionally map the renderer's colors onto the host design-system tokens by
importing the theme bridge and applying an `.emlight` / `.emdark` class on an
ancestor element:

```ts
import '@emdash/chat-ui/chat-theme.css';
```

The mount container must have a **fixed height** — the virtualizer measures the
scroll viewport, so a zero-height or auto-height container renders nothing.

---

## Quick start (Solid / vanilla)

```ts
import { mountChat } from '@emdash/chat-ui';
import '@emdash/chat-ui/style.css';

const handle = mountChat(document.getElementById('chat')!, {
  stickToBottom: true,
  commands: {
    onOpenFile: ({ path }) => openInEditor(path),
  },
});

// Seed historical items.
handle.transcript.seed([
  { kind: 'message', id: 'u1', role: 'user', text: 'Hello!' },
]);

// Stream a turn.
handle.transcript.dispatch({ type: 'message_chunk', id: 'a1', role: 'assistant', text: 'Hi ' });
handle.transcript.dispatch({ type: 'message_chunk', id: 'a1', role: 'assistant', text: 'there.' });
handle.transcript.dispatch({ type: 'turn_done' });

// Tear down when done.
handle.dispose();
```

## Quick start (React)

```tsx
import { ChatTranscript, type ChatHandle } from '@emdash/chat-ui/react';
import '@emdash/chat-ui/style.css';

function Chat() {
  const handleRef = useRef<ChatHandle | null>(null);
  return (
    <div style={{ height: '100%' }}>
      <ChatTranscript
        stickToBottom
        commands={{ onOpenFile: ({ path }) => openInEditor(path) }}
        onReady={(h) => {
          handleRef.current = h;
          h.transcript.seed(initialItems);
        }}
      />
    </div>
  );
}
```

---

## `mountChat(container, options?)`

```ts
function mountChat(container: HTMLElement, opts?: MountChatOptions): ChatHandle;
```

Mounts the Solid renderer into `container` and returns a `ChatHandle`. Call
`handle.dispose()` to unmount and release all DOM and caches.

### `MountChatOptions`

| Option | Type | Description |
| --- | --- | --- |
| `theme` | `ChatTheme` | Typography + density. Defaults to `DEFAULT_THEME`. |
| `stickToBottom` | `boolean` | Auto-scroll to bottom as content streams in. |
| `transcript` | `TranscriptApi` | Reuse an existing transcript store; otherwise one is created. |
| `viewState` | `ViewState` | Reuse an existing collapse store; otherwise one is created. |
| `class` | `string` | Extra class on the full-width scroll container. |
| `contentClass` | `string` | Class for the centered content column (defaults to a max-width column). |
| `padTop` | `number` | Top padding (px) baked into the virtualizer coordinate space. |
| `padBottom` | `number` | Bottom padding (px) — use to clear a floating composer. |
| `commands` | `ChatCommands` | User-interaction callbacks (see below). |
| `onReachStart` | `() => void` | Fires when scrolled near the top and history is exhausted. |
| `onAtBottomChange` | `(atBottom: boolean) => void` | Fires when the "at bottom" sticky state changes. |

### `ChatHandle`

| Member | Signature | Description |
| --- | --- | --- |
| `transcript` | `TranscriptApi` | Seed/stream data into the transcript. |
| `viewState` | `ViewState` | Manage per-row collapse state. |
| `setContentPadding` | `(p: { top?: number; bottom?: number }) => void` | Update canvas padding without remounting. |
| `scrollToBottom` | `(opts?: { behavior?: ScrollBehavior }) => void` | Scroll to the latest row. |
| `scrollToItem` | `(id: string, opts?: ScrollToItemOptions) => void` | Scroll to a row by item id. |
| `loadOlder` | `(items: ChatItem[]) => void` | Prepend history while preserving scroll position. |
| `setCommands` | `(commands: ChatCommands) => void` | Swap command callbacks without remounting. |
| `dispose` | `() => void` | Unmount the Solid root and remove all DOM. |

### `ChatCommands`

```ts
type ChatCommands = {
  onOpenFile?: (arg: { path: string; itemId: string; source: 'diff' | 'file-op' }) => void;
};
```

Invoked when the user clicks a file path in a diff header or a file-op row.

### `ScrollToItemOptions`

```ts
type ScrollToItemOptions = {
  align?: 'start' | 'center' | 'end'; // default: 'start'
  offset?: number;                    // default: 0
  behavior?: ScrollBehavior;          // default: 'auto'
};
```

`scrollToItem` is best-effort precise: if the target was off-screen (its height
was estimated, not measured), it settles within a frame or two.

---

## React adapter — `@emdash/chat-ui/react`

```tsx
function ChatTranscript(props: ChatTranscriptProps): React.ReactElement;
```

`ChatTranscriptProps` is `MountChatOptions` minus the imperative bits, plus:

| Prop | Type | Description |
| --- | --- | --- |
| `onReady` | `(handle: ChatHandle) => void` | Called once after mount with the handle. |
| `style` | `React.CSSProperties` | Style for the wrapper `div`. |
| `className` | `string` | Class for the wrapper `div`. |
| `padTop` / `padBottom` | `number` | Pushed reactively via `setContentPadding` (no remount). |
| `commands` | `ChatCommands` | Pushed reactively so inline callbacks never go stale. |
| `onReachStart` | `() => void` | Pushed reactively. |
| `onAtBottomChange` | `(atBottom: boolean) => void` | Pushed reactively. |

The component mounts the Solid root on mount, exposes the handle via `onReady`,
and disposes on unmount. `commands`, padding, and callbacks are forwarded
reactively so React re-renders never produce stale closures.

Also re-exported from this entry point: `ChatHandle`, `ChatCommands`,
`ScrollToItemOptions`, and `LoadOlderFn = (items: ChatItem[]) => void`.

---

## Data model

A transcript is an array of `ChatItem`s. Each item is a discriminated union on
`kind`. Every item has a stable, unique `id` (used as the React/Solid key and
the layout memo key — keep references stable across updates).

```ts
type ChatItem =
  | ChatMessage
  | ChatToolCall
  | ChatThinking
  | ChatFileOpToolCall
  | ChatExecute
  | ChatDiff;

type ChatRole = 'user' | 'assistant' | 'thought';
type ToolStatus = 'running' | 'done' | 'error';
type ThinkingStatus = 'thinking' | 'done';
type FileOpKind = 'read' | 'edit' | 'delete' | 'move';
type FileOp = { path: string };
```

### `ChatMessage`

```ts
type ChatMessage = {
  kind: 'message';
  id: string;
  role: ChatRole;
  text: string;        // markdown source
  streaming?: boolean; // true while the agent is still writing
};
```

### `ChatToolCall`

```ts
type ChatToolCall = {
  kind: 'tool';
  id: string;
  name: string;
  status: ToolStatus;
  inputSummary?: string; // one-line synopsis shown next to the name
};
```

### `ChatThinking`

```ts
type ChatThinking = {
  kind: 'thinking';
  id: string;
  status: ThinkingStatus;
  text: string;        // accumulating reasoning text
  startedAt: number;   // epoch ms; drives the live duration
  durationMs?: number; // frozen once status flips to 'done'
};
```

While `thinking`, the row shows a fixed-height streaming window with the tail
faded at the top. When `done`, it collapses to a "Thought for {duration}s"
header that expands to the full text.

### `ChatFileOpToolCall`

```ts
type ChatFileOpToolCall = {
  kind: 'file-op';
  id: string;
  op: FileOpKind;
  status: ToolStatus;
  ops: FileOp[]; // replaced (not appended) on each update
};
```

A single file renders as a one-liner ("Read foo.tsx"); multiple files render as
a collapsible "Read 2 files ›" header. Collapse semantics are **inverted**: the
stored "collapsed" flag means "expanded".

### `ChatExecute`

```ts
type ChatExecute = {
  kind: 'execute';
  id: string;
  command: string;     // e.g. "ls -a"; empty until the command arrives
  status: ToolStatus;
  startedAt: number;   // epoch ms
  durationMs?: number; // frozen once done; omitted when unavailable
};
```

### `ChatDiff`

```ts
type ChatDiff = {
  kind: 'diff';
  id: string;            // `${toolCallId}:${path}`
  path: string;
  oldText: string | null; // null => new file (all newText lines are adds)
  newText: string;
  status: ToolStatus;
};
```

Renders a compact preview of the first changed region (≤12 lines, ±1 context)
with syntax + diff highlighting. One `ChatDiff` per changed file.

---

## `TranscriptApi`

The store you reach through `handle.transcript`. It keeps a two-tier state:
`committed` items (immutable) and an `activeTurn` that accumulates streaming
updates until `turn_done` moves it into `committed`.

```ts
type TranscriptApi = {
  readonly state: TranscriptState;
  seed(history: ChatItem[]): void;
  dispatch(event: TranscriptEvent): void;
  reset(): void;
  prependHistory(items: ChatItem[]): void;
  findIndexById(id: string): number;
};
```

| Method | Description |
| --- | --- |
| `seed(history)` | Replace the entire transcript (e.g. session replay). |
| `dispatch(event)` | Feed one streaming event (see `TranscriptEvent`). |
| `reset()` | Clear all state. |
| `prependHistory(items)` | Prepend older items above current ones; keep stable references. |
| `findIndexById(id)` | Absolute index (committed-first), or `-1`. |

> For pagination, pair `onReachStart` with `handle.loadOlder(items)` rather than
> calling `prependHistory` directly — `loadOlder` also preserves scroll position.

### `TranscriptEvent`

A discriminated union on `type`. Deltas (text/reasoning chunks) are appended;
`ops`/`command`/`status` updates patch the matching item by `id`.

| `type` | Payload | Effect |
| --- | --- | --- |
| `message_chunk` | `{ id, role, text }` | Append a text chunk to a message (creates it on first chunk). |
| `tool_start` | `{ id, name, inputSummary? }` | Begin a tool call. |
| `tool_update` | `{ id, status?, name?, inputSummary? }` | Patch a tool call. |
| `thinking_chunk` | `{ id, text, startedAt? }` | Append reasoning text (creates the row on first chunk). |
| `thinking_done` | `{ id, durationMs? }` | Freeze reasoning to `done`. |
| `file_op_start` | `{ id, op, ops }` | Begin a file-operation call. |
| `file_op_update` | `{ id, status?, ops? }` | Patch a file-op (full `ops` replacement). |
| `execute_start` | `{ id, command, startedAt? }` | Begin an execute call. |
| `execute_update` | `{ id, command?, status? }` | Patch an execute call. |
| `diff_start` | `{ id, path, oldText, newText }` | Begin a diff preview. |
| `diff_update` | `{ id, status?, oldText?, newText? }` | Patch a diff row. |
| `turn_done` | `{}` | Finalize the active turn into `committed`. |

Dispatching a content event after reasoning auto-finalizes any still-open
`thinking` row, so you rarely need an explicit `thinking_done`.

---

## `ViewState`

Per-row collapse state, reached through `handle.viewState`.

```ts
type ViewState = {
  isCollapsed(id: string): boolean;
  toggleCollapsed(id: string): void;
  setCollapsed(id: string, value: boolean): void;
  expandAll(): void;
};
```

Note the **inverted** semantics for `thinking` and `file-op` rows: a stored
"collapsed" flag is treated as "expanded".

---

## Theming

```ts
type DensityScale = {
  blockGap: number;       // gap between blocks of different tiers
  proseGap: number;       // tighter gap between two prose blocks
  inlineCodePadX: number; // inline-code chip horizontal padding (px)
  inlineCodePadY: number; // inline-code chip vertical padding (px)
};

type ChatTheme = {
  version: number;        // bump on any change so the layout memo invalidates
  fonts: FontConfig;
  density: DensityScale;
};

function buildTheme(fonts?: FontConfig): ChatTheme;
const DEFAULT_THEME: ChatTheme;
```

`ChatTheme` is the single injection point for measurement inputs (typography +
shared density). Build a custom theme with `buildTheme(fonts)` and pass it via
`MountChatOptions.theme`. Always bump `version` when cloning a theme with
changed values so the renderer's identity-based layout cache invalidates.

Colors are CSS-driven (the `--chat-*` variables in `chat-theme.css`), not part
of `ChatTheme`.

---

## Test / story helper

```ts
function generateMockTranscript(count?: number, seed?: number): ChatItem[];
```

Returns a deterministic mock transcript (default `count = 6000`, `seed = 1`)
mixing messages, tool calls, thinking, file-ops, execute rows, and markdown
blocks. Useful for stories, performance testing, and demos.

---

## Exports at a glance

**`@emdash/chat-ui`**

- Values: `mountChat`, `buildTheme`, `DEFAULT_THEME`, `generateMockTranscript`
- Types: `MountChatOptions`, `ChatHandle`, `ChatCommands`, `ScrollToItemOptions`,
  `ChatTheme`, `DensityScale`, `TranscriptApi`, `TranscriptEvent`, `ViewState`,
  `ChatItem`, `ChatMessage`, `ChatToolCall`, `ChatThinking`,
  `ChatFileOpToolCall`, `ChatExecute`, `ChatDiff`, `ChatRole`, `FileOpKind`,
  `FileOp`, `ToolStatus`

**`@emdash/chat-ui/react`**

- Values: `ChatTranscript`
- Types: `ChatTranscriptProps`, `ChatHandle`, `ChatCommands`,
  `ScrollToItemOptions`, `LoadOlderFn`

**Styles**

- `@emdash/chat-ui/style.css` — required renderer styles
- `@emdash/chat-ui/chat-theme.css` — optional color bridge to `.emlight` / `.emdark`
