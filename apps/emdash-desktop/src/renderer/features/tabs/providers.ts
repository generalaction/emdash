/**
 * Central tab-provider map.
 *
 * This module is the single place that knows about all built-in tab kinds.
 * Importing it triggers the side-effect registration of every provider into
 * tabProviderRegistry. The map is also the source of truth for all tab-kind
 * types: TabKind, OpenArgsOf, EntryOf, ResolvedDataOf, DataOf are all
 * inferred from it.
 *
 * Import this module once at application startup (e.g. from
 * workspace-view-model.tsx or test setup).
 */

import { browserTabProvider } from '@renderer/features/browser/browser-tab-provider';
import { conversationTabProvider } from '@renderer/features/tasks/conversations/conversation-tab-provider';
import { diffTabProvider } from '@renderer/features/tasks/diff-view/diff-tab-provider';
import { fileTabProvider } from '@renderer/features/tasks/editor/file-tab-provider';
import { type TabProvider } from './core/tab-provider';

export const tabProviders = {
  conversation: conversationTabProvider,
  file: fileTabProvider,
  diff: diffTabProvider,
  browser: browserTabProvider,
} as const;

export type TabProviders = typeof tabProviders;
export type TabKind = keyof TabProviders;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args<P> =
  P extends TabProvider<infer E extends object, infer RD extends object, infer Data, infer A>
    ? { entry: E; resolvedData: RD; data: Data; openArgs: A }
    : never;

export type OpenArgsOf<K extends TabKind> = Args<TabProviders[K]>['openArgs'];
export type EntryOf<K extends TabKind> = Args<TabProviders[K]>['entry'];
export type ResolvedDataOf<K extends TabKind> = Args<TabProviders[K]>['resolvedData'];
export type DataOf<K extends TabKind> = Args<TabProviders[K]>['data'];
