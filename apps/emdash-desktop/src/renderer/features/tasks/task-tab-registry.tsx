/**
 * Task-view tab registry.
 *
 * `createTabView` wires all four concrete providers into a fully typed surface.
 * `taskTabView` is the singleton for task views; import from it to get typed
 * store-creator, hook, and derived types:
 *
 *   const paneLayout = taskTabView.createPaneLayoutStore(ctx);
 *   paneLayout.open('file', { path: '/foo.ts' });   // typed ✓
 *
 * `TaskTabKind`, `TaskOpenArgsOf`, etc. are derived from the provider set,
 * so they stay in sync automatically.
 */

import { type ReactNode } from 'react';
import { browserTabProvider } from '@renderer/features/browser/browser-tab-provider';
import type { TabViewContext } from '@renderer/features/tabs/core/tab-provider';
import {
  createTabRegistry,
  type KindOf,
  type OpenArgsOf,
  type TypedTabRegistry,
  type AnyTabProvider,
} from '@renderer/features/tabs/core/tab-provider-registry';
import {
  PaneLayoutProvider,
  usePaneLayoutContext,
} from '@renderer/features/tabs/pane-layout-context';
import { PaneLayoutStore } from '@renderer/features/tabs/pane-layout-store';
import { conversationTabProvider } from './conversations/conversation-tab-provider';
import { diffTabProvider } from './diff-view/diff-tab-provider';
import { fileTabProvider } from './editor/file-tab-provider';
import { TaskTabViewPersistor } from './stores/task-tab-view-persistor';

// ── Generic factory ───────────────────────────────────────────────────────────

function createTabView<const P extends readonly AnyTabProvider[]>(providers: P) {
  type R = TypedTabRegistry<P>;

  const registry = createTabRegistry(providers);

  /** Creates a typed PaneLayoutStore suitable for threading into a MobX state tree. */
  function createPaneLayoutStore(ctx: TabViewContext): PaneLayoutStore<R> {
    return new PaneLayoutStore<R>(registry, ctx, new TaskTabViewPersistor(ctx.viewId));
  }

  /**
   * Typed wrapper around `usePaneLayoutContext()`.
   * Must be called inside a PaneLayoutProvider.
   */
  function useTabLayout(): PaneLayoutStore<R> {
    return usePaneLayoutContext() as PaneLayoutStore<R>;
  }

  /**
   * Typed React context provider for the layout store.
   * Delegates to the generic `PaneLayoutProvider` so `usePaneLayoutContext()`
   * in the generic chrome (e.g. tab-drag-preview.tsx) continues to resolve.
   */
  function TabLayoutProvider({
    layout,
    children,
  }: {
    layout: PaneLayoutStore<R>;
    children: ReactNode;
  }): ReactNode {
    return <PaneLayoutProvider paneLayout={layout}>{children}</PaneLayoutProvider>;
  }

  return { registry, createPaneLayoutStore, useTabLayout, TabLayoutProvider };
}

// ── Task-view instance ────────────────────────────────────────────────────────

export const taskTabView = createTabView([
  conversationTabProvider,
  fileTabProvider,
  diffTabProvider,
  browserTabProvider,
] as const);

// ── Derived types ─────────────────────────────────────────────────────────────

type TaskRegistry = typeof taskTabView.registry;
type TaskProviders = TaskRegistry['_providers'];

export type TaskTabKind = KindOf<TaskRegistry>;
export type TaskOpenArgsOf<K extends TaskTabKind> = OpenArgsOf<TaskRegistry, K>;

type ProviderFor<K extends TaskTabKind> = Extract<TaskProviders[number], { kind: K }>;
type ProviderEntry<P> = P extends AnyTabProvider & { serialize(entry: infer E): unknown }
  ? E
  : never;
type ProviderResolved<P> = P extends AnyTabProvider & {
  resolve(entry: unknown, ctx: unknown): (infer RD) | null;
}
  ? RD
  : never;
type ProviderData<P> = P extends AnyTabProvider & {
  deserialize(data: infer D, ctx: unknown): unknown;
}
  ? D
  : never;

export type TaskEntryOf<K extends TaskTabKind> = ProviderEntry<ProviderFor<K>>;
export type TaskResolvedDataOf<K extends TaskTabKind> = ProviderResolved<ProviderFor<K>>;
export type TaskDataOf<K extends TaskTabKind> = ProviderData<ProviderFor<K>>;

// Keep the registry export for consumers that still import it directly.
export const taskTabRegistry = taskTabView.registry;
