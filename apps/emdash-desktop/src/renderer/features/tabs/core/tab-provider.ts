import type React from 'react';
import type { ShortcutSettingsKey } from '@shared/shortcuts';

/**
 * Minimal shape every tab entry must satisfy. The engine stores entries as
 * this type so it can operate on them without knowing the concrete kind.
 * Domain entry classes (ConversationTabEntry, FileTabStore, …) extend this.
 */
export interface TabEntryBase {
  readonly kind: string;
  readonly tabId: string;
  isPreview: boolean;
}

/**
 * Generic ambient context passed to all tab-kind method implementations
 * (resolve, open, serialize, deserialize, onClose, mount). The library
 * only requires a stable viewId; domain-specific fields (projectId,
 * workspaceId, taskId, modelRootPath) live in TaskTabContext in
 * features/tasks and are accessed via a cast at the provider boundary.
 */
export interface TabViewContext {
  /** Stable identifier for the view that owns this pane (e.g. taskId). */
  viewId: string;
}

/**
 * Context passed to resolve(). Extends TabViewContext with the derived
 * isActive flag so a kind can make activity-dependent decisions when
 * building its resolved view model.
 */
export interface ResolveContext extends TabViewContext {
  isActive: boolean;
}

/**
 * The composed resolved tab: engine identity fields stamped onto the
 * kind-derived domain data (RD). The engine constructs this in the
 * resolvedTabs computed by combining entry identity + RD returned by
 * the definition's resolve().
 *
 * RD must NOT include tabId / kind / isPreview / isActive — those are
 * always owned and stamped by the engine.
 */
export type ResolvedTab<RD extends object = object> = {
  readonly tabId: string;
  readonly kind: string;
  readonly isPreview: boolean;
  readonly isActive: boolean;
} & RD;

/**
 * Props for a kind's TabItem component (rendered in the tab bar).
 * host and ctx are provided so the component can dispatch actions
 * (select, pin, close, rename…) without importing PaneStore.
 */
export interface TabItemProps<RD extends object> {
  tab: ResolvedTab<RD>;
  host: TabHost;
  ctx: TabViewContext;
}

/**
 * Props for a kind's Content component (the pane body area).
 *
 * PaneContent mounts every registered Content unconditionally — the
 * component itself decides visibility, keepalive, and async loading.
 */
export interface TabContentProps {
  host: TabHost;
  ctx: TabViewContext;
}

/** A single actionable entry in a tab context menu. */
export interface TabCommand {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Grouping key for separator placement. */
  group?: 'close' | (string & {});
  /** App-shortcut key whose effective hotkey is rendered next to the command. */
  shortcut?: ShortcutSettingsKey;
  /** Hides the command when false (default: always visible). */
  isAvailable?(): boolean;
  run(): void | Promise<void>;
}

/**
 * Narrow host interface that PaneStore implements.
 * Definition methods (open, Renderer, mount, confirmClose) receive
 * this instead of the full store so that kinds cannot reach into
 * internal store state directly.
 */
export interface TabHost {
  readonly resolvedTabs: ReadonlyArray<ResolvedTab>;
  readonly resolvedActiveTabId: string | undefined;
  /** The ambient context for this pane (viewId + any domain-specific fields). */
  readonly ctx: TabViewContext;
  /** True when this pane is the currently focused pane in the main region. */
  readonly isFocused: boolean;
  /** Opens a tab of any registered kind. Used by mount() callbacks that listen for
   * cross-tab events (e.g. browser open-in-new-tab). Untyped for use in mount(). */
  openKind(kind: string, args: unknown): void;

  /**
   * Returns the first tab-order entry that satisfies the type predicate.
   * Use this in open() for deduplication ("is this path already open?").
   */
  findEntry<E extends object>(predicate: (e: object) => e is E): E | undefined;

  /**
   * Appends an entry and optionally activates it.
   * Replaces the scattered entries.set + addTabId + activeTabId triples.
   */
  attachEntry(
    entry: { readonly kind: string; readonly tabId: string; isPreview: boolean },
    opts?: { activate?: boolean }
  ): void;

  setActiveTab(tabId: string): void;
  /** Sets isPreview = false (no-op when already stable). */
  pin(tabId: string): void;
  /**
   * Swaps an existing entry for a new one at the same tab-order position.
   * Used by kinds that replace a preview in-place (e.g. diff preview).
   */
  replaceEntry(
    existingTabId: string,
    newEntry: { readonly kind: string; readonly tabId: string; isPreview: boolean },
    opts?: { activate?: boolean }
  ): void;
  /** Force-close — no confirmation dialog, calls onClose, removes entry. */
  closeTab(tabId: string): void;
  /**
   * User-initiated close — awaits confirmClose hook (e.g. unsaved-changes
   * dialog), then calls closeTab if confirmed.
   */
  requestCloseTab(tabId: string): void;
  /** Closes every open tab except the given one. */
  closeOthers(tabId: string): void;
  /**
   * The current pending rename request, if any. Observed by tab chips
   * so they can start inline editing when their tabId matches.
   */
  readonly renameRequest: { tabId: string; nonce: number } | null;
  /** Signal the tab chip for tabId to begin inline editing. */
  requestRename(tabId: string): void;
  /** Called by the tab chip after it has consumed a rename request. */
  clearRenameRequest(): void;
  /** Delegates to provider.rename() to persist the new name. */
  commitRename(tabId: string, name: string): void;
}

/**
 * The core contract for a tab kind.
 *
 * Generic parameters
 *   K        – literal string kind discriminant
 *   E        – the mutable observable entry (FileTabStore, BrowserTabEntry, …)
 *   RD       – kind-derived resolved fields (beyond tabId/kind/isPreview/isActive)
 *   Data     – serialized form written to / read from the DB snapshot
 *   OpenArgs – argument bag for opening a tab of this kind
 */
export interface TabProvider<
  K extends string = string,
  E extends object = object,
  RD extends object = object,
  Data = unknown,
  OpenArgs = unknown,
> {
  readonly kind: K;

  /**
   * Pure function: maps an entry to kind-specific view-model fields.
   * Returns null when the entry exists but is not yet renderable (e.g.
   * the conversation store hasn't loaded). Runs inside a MobX computed
   * — must have no side-effects or I/O.
   */
  resolve(entry: E, ctx: ResolveContext): RD | null;

  /**
   * Serialize entry to its persisted form.
   * Return null to skip persistence for this instance.
   */
  serialize(entry: E): Data | null;

  /**
   * Reconstruct an entry from its persisted form. Must be synchronous —
   * any async loading (external files, image data-URLs) belongs in
   * the kind's Renderer via useEffect.
   */
  deserialize(data: Data, ctx: TabViewContext): E;

  /** Renders the tab's chip in the tab bar. */
  TabItem: React.ComponentType<TabItemProps<RD>>;
  /** Renders the drag ghost for this tab kind. */
  DragPreview: React.ComponentType<{ tab: ResolvedTab<RD> }>;

  /**
   * The pane body component for this kind.
   *
   * Mounted unconditionally by PaneContent regardless of which kind is
   * active. The component is responsible for:
   *   - reading host.resolvedTabs and filtering to its own kind
   *   - controlling its own visibility (show/hide when not active)
   *   - keepalive semantics (mount-all vs mount-active-only)
   *   - async data loading via useEffect
   */
  Content: React.ComponentType<TabContentProps>;

  /** Human-readable label used in dialogs (close-confirm, command palette). */
  title(tab: ResolvedTab<RD>): string;

  /**
   * Opens (or focuses / preview-replaces) a tab of this kind.
   * Must be synchronous — all async work belongs in the Renderer.
   */
  open(args: OpenArgs, host: TabHost, ctx: TabViewContext): void;

  /**
   * Called before a user-initiated close. Return false (or a Promise that
   * resolves to false) to veto the close — e.g. to show an unsaved-changes
   * dialog. Not invoked for programmatic closes (closeTab).
   */
  confirmClose?(entry: E, host: TabHost, ctx: TabViewContext): boolean | Promise<boolean>;

  /**
   * Called after a tab of this kind becomes the active tab in its pane.
   * Use for side-effects that should only run when the tab is brought into
   * focus (e.g. updating telemetry scope). Not called on initial open.
   */
  onActivate?(entry: E, ctx: TabViewContext): void;

  /**
   * Synchronous teardown after an entry is removed from the store.
   * Use for resource cleanup that the engine cannot know about
   * (e.g. browser session teardown).
   */
  onClose?(entry: E, ctx: TabViewContext): void;

  /**
   * Called once when a PaneStore is constructed. Wire store-lifetime
   * reactions and event subscriptions here (e.g. auto-close when a
   * conversation is deleted, open-in-new-tab listener). Return a disposer
   * that the store calls when it is disposed.
   */
  mount?(host: TabHost, ctx: TabViewContext): () => void;

  /**
   * Persist a new name for this tab's backing entity. Presence marks the
   * kind as renamable — the engine exposes Cmd+Shift+R and the context-menu
   * "Rename" command only when the active tab's provider defines this.
   */
  rename?(entry: E, name: string, ctx: TabViewContext): void;
}
