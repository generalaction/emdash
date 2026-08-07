# Renderer Patterns

All paths are relative to `apps/emdash-desktop/`.

## Modal System

Modals are renderer-only feature contributions. They render as a stack, with only the top modal
responding to outside presses and close commands.

- `src/core/primitives/modals/react/` — modal definitions, catalog types, host context, and typed API
- `src/core/features/*/contributions/browser.ts` — feature-owned `modalDefs`
- `src/core/manifests/browser/modal-catalog.ts` — application modal catalog
- `src/renderer/lib/modal/api.ts` — catalog-bound `openModal`, `useOpenModal`, and
  `useModalController`
- `src/renderer/lib/modal/modal-renderer.tsx` — resolves and renders the active catalog definition
- `src/renderer/lib/modal/modal-store.ts` — active modal state and promise outcomes
- `src/renderer/lib/modal/use-close-guard.ts` — close-guard hook

**Adding a modal:**
1. Create the component in its feature slice. Caller data is ordinary component props; completion
   uses `useModalController(id)`.
2. Define it with `defineModal<TResult>()({ id, component, ...chrome })`.
3. Add the definition to the owning slice's `modalDefs`.
4. Open it through the typed API and branch on the outcome:

```tsx
const openMyModal = useOpenModal('myModal');
const outcome = await openMyModal({ projectId: '123' });
if (outcome.success) {
  useResult(outcome.data);
}
```

**Rules:**
- The manifest catalog is the only runtime registry; do not add renderer-local registrations
- Keep the catalog import type-only outside runtime resolution points
- Use standalone `openModal` outside React and `useOpenModal` inside components
- Use `useCloseGuard` during critical operations that must block passive dismissal
- `useModalController` exposes `hasActiveCloseGuard` when modal UI must reflect guard state
- Use `outcome.error.reason` when a chained flow must distinguish explicit back/cancel actions from
  passive or navigation dismissal

## View System

Views use a registry + parameterized navigation pattern.

- `src/renderer/app/view-registry.ts` — view definitions (required `MainPanel`, optional
  `WrapView` and `TitlebarSlot`) plus navigation guards (`setupNavigationGuards`)
- `src/renderer/lib/layout/` — `provider.tsx`, `navigation-provider.tsx` (navigation and
  param persistence), `layout-provider.tsx` (workspace chrome context: reads the
  per-project workspace chrome command store and exposes the layout-storage facade)

**Key behaviors:**
- `navigate(viewId, params?)` (from `useNavigate`) is type-safe; params are optional when all fields are optional
- Params persist per-view (navigating away and back preserves params)
- `updateViewParams(viewId, partial)` updates params without re-navigating

**Rules:**
- Views are singletons — one per ViewId
- Add new views to `src/renderer/app/view-registry.ts`

## Workbench Layout State

Workbench layout follows a strict ownership model (see
`.scratch/workbench-state-architecture/spec.md` history for rationale):

- **Chrome state lives in command stores, one per subject.** Task chrome
  (`sidebarCollapsed`, `sidebarTab`, `terminalDrawerOpen`) and workspace chrome
  (`leftSidebarOpen`, `zen`) are memento-backed state objects mutated only through
  named commands (`toggleSidebar`, `openSidebarTab`, `enterZenMode`, ...) — never
  through field setters. The shared mechanism is `defineChromeStore` in
  `src/core/primitives/chrome-stores/`.
- **Panel visibility is store-driven conditional rendering, never programmatic panel
  writes.** Closed = unmounted. Collapsible surfaces bind through
  `useCollapsiblePanelBinding` from `@emdash/ui` (next to `Resizable`), which turns
  drag-below-threshold into a semantic close command. No `panel.collapse()` /
  `expand()` / `resize()` / `setLayout()` calls exist in app code, and no
  `display:none` toggling of workbench surfaces.
- **Pixel sizes belong to react-resizable-panels alone**, persisted via
  `useResizableDefaultLayout` with a memento-backed `LayoutStorage` facade
  (`createLayoutStorage` in `src/core/primitives/mementos/browser/`). Sizes are never
  MobX observables and never persisted to localStorage.
- **Persisted view state renders below a hydration gate.** The task view gates on
  `space.isHydrated`; the storage facade dev-asserts on reads before hydration.

## PTY Frontend (`src/renderer/lib/pty/`)

- `pty.ts` — `FrontendPty` class; subscribing fetches the main-process ring buffer and
  registers the consumer in one synchronous tick, so there is no renderer-side buffer
  and no missed output
- `pty-session.ts` — session lifecycle
- `pty-pool-provider.tsx` — `TerminalPoolProvider` managing reusable xterm.js instances
- `pty-pane.tsx` — terminal pane component
- `prompt-injection.ts`, `pty-input-buffer.ts`, `pty-keybindings.ts`, `pty-clipboard.ts` — input handling

**Rules:**
- Historical output comes from the main-process ring buffer; do not add renderer-side buffering
- `sessionId` format: `makePtySessionId(projectId, scopeId, leafId)` from
  `src/core/primitives/pty/api/pty-session-id.ts` — deterministic

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

- **`useSyncExternalStore`-compatible stores** — e.g., the memento hooks in
  `src/core/primitives/mementos/react/` and the layout-storage facade in
  `src/core/primitives/mementos/browser/`
- **Cross-feature stores** — `src/renderer/lib/stores/` (navigation, dependencies, resource monitor, ...)
- **MobX task and project stores** — `src/core/features/tasks/browser/stores/` and
  `src/core/features/projects/browser/stores/`; access them through selectors
  (`task-selectors.ts`, `project-selectors.ts`) and task view hooks, never directly
