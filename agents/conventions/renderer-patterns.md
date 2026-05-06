# Renderer Patterns

## Modal System (`src/renderer/core/modal/`)

All modals use a registry-based system. Only one modal can be active at a time.

- `registry.ts` — central registry mapping modal IDs to components
- `modal-provider.tsx` — React context managing active modal state
- `modal-renderer.tsx` — renders the currently active modal

**Adding a modal:**
1. Create the component accepting `BaseModalProps<TResult>` (provides `onSuccess` and `onClose` callbacks)
2. Register it in `registry.ts`
3. Open it via the hook:

```tsx
const { showModal } = useModalContext();
showModal('myModal', { projectId: '123', onSuccess: (result) => {...} });
```

**Rules:**
- All modals must be registered in `registry.ts`
- `showModal` is type-safe — TypeScript infers required args from the registry
- `hasActiveCloseGuard` prevents dismissal during critical operations

## View System (`src/renderer/core/view/`)

Views use a registry + parameterized navigation pattern.

- `registry.ts` — view definitions with optional `WrapView`, `TitlebarSlot`, `MainPanel`, `RightPanel`
- `provider.tsx` — state management, navigation, param persistence
- `layout-provider.tsx` — panel collapse/expand/drag state

**Key behaviors:**
- `navigate(viewId, params?)` is type-safe; params are optional when all fields are optional
- Params persist per-view (navigating away and back preserves params)
- Modal automatically closes on navigation
- `updateViewParams(viewId, partial)` updates params without re-navigating

**Rules:**
- Views are singletons — one per ViewId
- MainPanel is required; RightPanel and WrapView are optional
- Add new views to `registry.ts`

## PTY Frontend (`src/renderer/core/pty/`)

Terminal sessions use a registry + pool pattern.

- `pty.ts` — `FrontendPty` class with `FrontendPtyRegistry` (module-level singleton, survives React unmounts)
- `pty-pool.ts` — `TerminalPool` managing up to 16 reusable xterm.js instances
- `use-pty.ts` — React hook integrating FrontendPty + TerminalPool
- `pty-session-context.tsx` — context for session registration
- `pty-pane.tsx` — terminal component (forwardRef)

**Lifecycle:** register → attach → detach → unregister

**Rules:**
- `registerSession()` must happen BEFORE RPC starts the PTY to avoid missing output
- `FrontendPty` buffers output (max 1 MB) when no xterm is attached, drains on `attach()`
- Terminal instances are never disposed — they're parked off-screen and reused from the pool
- `sessionId` format: `makePtySessionId(projectId, taskId, conversationId)` — deterministic
- Panel drag pauses resizing to avoid jank (`panelDragStore`)

## React Query Context Pattern

Context providers use React Query for data fetching with optimistic updates:

```tsx
// Pattern used in AppSettingsProvider, ProjectProvider, etc.
const { data } = useQuery({ queryKey: ['resource'], queryFn: () => rpc.ns.get() });
const mutation = useMutation({
  mutationFn: (args) => rpc.ns.update(args),
  onMutate: async (args) => {
    // optimistic update via queryClient.setQueryData
  },
  onError: () => {
    // rollback via queryClient.setQueryData with previous snapshot
  },
});
```

**Rules:**
- Contexts combine React Query + local state, not standalone useState
- Use `useAppSettingsKey(key)` for fine-grained per-setting hooks
- Optimistic updates must include rollback on error

## State Outside React

For state that must survive React unmounts or be shared across unrelated components:

- **`useSyncExternalStore`-compatible stores** — e.g., `panelDragStore` in `src/renderer/lib/`
- **Module-level singletons** — e.g., `FrontendPtyRegistry`, `TerminalPool`
- **Manager classes** — e.g., `PendingInjectionManager`, `TaskTerminalsStore`
