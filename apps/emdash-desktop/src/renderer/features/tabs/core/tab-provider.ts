import type React from 'react';
import type { ShortcutSettingsKey } from '@shared/shortcuts';

/**
 * Plain-data identity for a single open tab.
 * The engine stores these and serializes them as { kind, tabId, isPreview, ...payload }.
 * Live view-model state lives in the domain resource returned by initialize().
 */
export interface TabEntry<P = unknown> {
  readonly kind: string;
  readonly tabId: string;
  /** Mutable so the engine can promote a preview to a stable tab (handle.pin()). */
  isPreview: boolean;
  /** Domain ref-count key (conversationId, file path, diff composite, browserId, …). */
  readonly resourceKey: string;
  /** Serializable open args (minus `preview`). Persisted in the DB snapshot. */
  readonly payload: P;
}

/**
 * Minimal shape every domain resource must satisfy.
 * Domain managers retain/release their internal ref counts inside initialize/dispose.
 */
export interface TabResource {
  /** Called when the engine permanently removes the tab. Must be idempotent. */
  dispose(): void;
  /**
   * Called when the tab becomes the active tab in a visible pane.
   * Use for telemetry scope, mark-seen, lazy bootstrap, etc.
   */
  onActivate?(): void;
}

// ---------------------------------------------------------------------------
// TabHandle — injected into initialize() so resources can drive tab operations
// ---------------------------------------------------------------------------

/**
 * Capability handle given to resources at initialize time.
 * Resources use this to drive pin-on-edit, programmatic close, title overrides,
 * and sibling-tab opens — without holding a direct store reference.
 */
export interface TabHandle {
  readonly tabId: string;
  /** Flip isPreview = false. Call when the resource gains user-authored content. */
  pin(): void;
  /** Programmatic close — skips onBeforeClose. */
  close(): void;
  /** User-style close — awaits onBeforeClose veto. */
  requestClose(): void;
  /** Override the display title for this tab (e.g. loaded file name). */
  setTitle(title: string): void;
  /** Open a new tab of the given kind in the same pane (e.g. browser open-in-new-tab). */
  openSibling(kind: string, args: unknown): void;
}

// ---------------------------------------------------------------------------
// CommandEntry — named capability registered on a provider
// ---------------------------------------------------------------------------

/**
 * A named capability surfaced through the tab context menu and command palette.
 * Examples: `rename`, `export`, `duplicate`.
 */
export interface CommandEntry<T> {
  label: string;
  /**
   * Execute the command.
   * For rename commands, `args[0]` is the new name string provided by the inline editor.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec(resource: T, ...args: any[]): void;
  isAvailable?(resource: T): boolean;
  shortcut?: ShortcutSettingsKey;
}

// ---------------------------------------------------------------------------
// Context / props shared across all provider methods
// ---------------------------------------------------------------------------

/**
 * Generic ambient context passed to all tab-kind method implementations.
 * The engine only requires a stable viewId; domain-specific fields
 * (projectId, workspaceId, taskId, modelRootPath) live in TaskTabContext in
 * features/tasks and are accessed via a cast at the provider boundary.
 */
export interface TabViewContext {
  /** Stable identifier for the view that owns this pane (e.g. taskId). */
  viewId: string;
}

/**
 * The composed resolved tab: engine identity stamped with the injected domain resource.
 * Components receive this instead of raw entry data so they never need findEntry().
 */
export type ResolvedTab<T extends TabResource = TabResource> = {
  readonly tabId: string;
  readonly kind: string;
  readonly isPreview: boolean;
  readonly isActive: boolean;
  readonly resource: T;
};

/** Props for a kind's TabItem component (rendered in the tab bar). */
export interface TabItemProps<T extends TabResource> {
  tab: ResolvedTab<T>;
  host: TabHost;
  ctx: TabViewContext;
}

/**
 * Props for a kind's Content component (the pane body area).
 *
 * PaneContent mounts every registered Content unconditionally — the
 * component decides visibility, keepalive, and async loading internally.
 */
export interface TabContentProps {
  host: TabHost;
  ctx: TabViewContext;
}

// ---------------------------------------------------------------------------
// TabCommand — single actionable entry in a tab context menu
// ---------------------------------------------------------------------------

/** A single actionable entry in a tab context menu (close, rename, …). */
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

// ---------------------------------------------------------------------------
// TabHost — narrow interface PaneStore implements for UI chrome
// ---------------------------------------------------------------------------

/**
 * Narrow host interface that PaneStore implements.
 * UI components (tab bar, content panels) receive this instead of the full
 * store so they cannot reach into internal engine state directly.
 */
export interface TabHost {
  readonly resolvedTabs: ReadonlyArray<ResolvedTab>;
  readonly resolvedActiveTabId: string | undefined;
  /** The ambient context for this pane (viewId + any domain-specific fields). */
  readonly ctx: TabViewContext;
  /** True when this pane is the currently focused pane in the main region. */
  readonly isFocused: boolean;

  /** Opens a tab of any registered kind. Untyped for use from resources. */
  openKind(kind: string, args: unknown): void;

  setActiveTab(tabId: string): void;
  /** Sets isPreview = false (no-op when already stable). */
  pin(tabId: string): void;
  /** Force-close — no confirmation dialog, calls dispose, removes entry. */
  closeTab(tabId: string): void;
  /**
   * User-initiated close — awaits onBeforeClose veto, then closes if confirmed.
   */
  requestCloseTab(tabId: string): void;
  /** Closes every open tab except the given one. */
  closeOthers(tabId: string): void;

  readonly renameRequest: { tabId: string; nonce: number } | null;
  requestRename(tabId: string): void;
  clearRenameRequest(): void;
  /** Delegates to the active tab's commands.rename entry. */
  commitRename(tabId: string, name: string): void;
}

// ---------------------------------------------------------------------------
// TabProvider — the core kind contract (4 generics)
// ---------------------------------------------------------------------------

/**
 * The core contract for a tab kind.
 *
 * Generic parameters
 *   K        – literal string kind discriminant
 *   P        – serializable payload (the "open args" stored in the DB snapshot)
 *   T        – the domain resource returned by initialize()
 *   OpenArgs – argument bag for opening a tab of this kind
 *              (may differ from P when onBeforeOpen transforms/enriches args)
 */
export interface TabProvider<
  K extends string = string,
  P = unknown,
  T extends TabResource = TabResource,
  OpenArgs = P,
> {
  readonly kind: K;

  /**
   * 'single': at most one tab per resourceKey across ALL panes in a view.
   *           The engine enforces this at the layout level.
   * 'multi':  multiple tabs with the same resourceKey may coexist (default).
   */
  readonly mount?: 'single' | 'multi';

  /**
   * Pure: derive the domain ref-count / dedup key from the serializable payload.
   * Called by the engine on every open and on deserialization.
   */
  resourceKey(payload: P): string;

  /**
   * Normalize/validate open args, perform synchronous side-effects
   * (e.g. create a browser session), and return the serializable payload.
   * Return null to abort the open.
   *
   * If absent, the engine strips `preview` from args and uses the rest as payload.
   */
  onBeforeOpen?(args: OpenArgs, ctx: TabViewContext): P | null;

  /**
   * Acquire or create the domain resource. Domain managers ref-count here.
   * Returns the resource, which the engine stores keyed by tabId and injects
   * into ResolvedTab.resource for render components.
   */
  initialize(entry: TabEntry<P>, handle: TabHandle, ctx: TabViewContext): T;

  /**
   * Veto a user-initiated close (e.g. show unsaved-changes dialog).
   * Return false (or Promise<false>) to cancel; true or Promise<true> to confirm.
   * Not called for programmatic closes (handle.close() / closeTab()).
   */
  onBeforeClose?(entry: TabEntry<P>, resource: T, ctx: TabViewContext): boolean | Promise<boolean>;

  /**
   * Release the domain resource. Domain managers decrement ref counts here.
   * Called when the engine permanently removes the tab from the view.
   */
  dispose(entry: TabEntry<P>, resource: T, ctx: TabViewContext): void;

  /**
   * Called when a stable open finds an existing tab for the same resourceKey.
   * Use to update mutable resource state that may differ between open calls
   * (e.g. refresh the `status` field on a diff tab, update a URL on a browser tab).
   * The engine promotes isPreview before calling this hook.
   */
  onRetarget?(
    entry: TabEntry<P>,
    resource: T,
    newPayload: P,
    handle: TabHandle,
    ctx: TabViewContext
  ): void;

  /**
   * Optional: override the serialized payload at snapshot time.
   * Implement when the entry payload becomes stale between open and serialize
   * (e.g. browser tabs whose session snapshot evolves as the user browses).
   * Defaults to `entry.payload`.
   */
  getSerializablePayload?(entry: TabEntry<P>, resource: T): P;

  /** Named capabilities surfaced as context-menu items and keyboard commands. */
  commands?: Record<string, CommandEntry<T>>;

  /** Renders the tab's chip in the tab bar. */
  TabItem: React.ComponentType<TabItemProps<T>>;
  /** Renders the drag ghost for this tab kind. */
  DragPreview: React.ComponentType<{ tab: ResolvedTab<T> }>;

  /**
   * The pane body component for this kind.
   * Mounted unconditionally by PaneContent regardless of which kind is active.
   */
  Content: React.ComponentType<TabContentProps>;

  /** Human-readable label used in dialogs (close-confirm, command palette). */
  title(entry: TabEntry<P>, resource: T): string;
}
