/**
 * Task-view tab registry.
 *
 * Instantiates the generic `createTabView` factory with the five task-specific
 * providers and wires in the task persistence adapter.
 *
 * `taskTabView` is the singleton for task views; import from it to get typed
 * store-creator, hook, and derived types:
 *
 *   const paneLayout = taskTabView.createPaneLayoutStore(ctx);
 *   paneLayout.open('file', { path: '/foo.ts' });   // typed ✓
 *
 * `TaskTabKind`, `TaskOpenArgsOf`, etc. are derived from the provider set,
 * so they stay in sync automatically.
 */

import { browserTabProvider } from '@renderer/features/browser/browser-tab-provider';
import { type KindOf, type OpenArgsOf } from '@renderer/features/tabs/core/tab-provider-registry';
import { createTabView } from '@renderer/features/tabs/tab-view-factory';
import type { ConversationType } from '@shared/core/conversations/conversations';
import { acpChatTabProvider } from './acp/acp-chat-tab-provider';
import { conversationTabProvider } from './conversations/conversation-tab-provider';
import { diffTabProvider } from './diff-view/diff-tab-provider';
import { fileTabProvider } from './editor/file-tab-provider';
import type { TaskTabContext } from './stores/task-tab-context';
import { TaskTabViewPersistor } from './stores/task-tab-view-persistor';

export const taskTabView = createTabView(
  [
    conversationTabProvider,
    acpChatTabProvider,
    fileTabProvider,
    diffTabProvider,
    browserTabProvider,
  ] as const,
  { makePersistor: (ctx) => new TaskTabViewPersistor(ctx as TaskTabContext) }
);

type TaskRegistry = typeof taskTabView.registry;

export type TaskTabKind = KindOf<TaskRegistry>;
export type TaskOpenArgsOf<K extends TaskTabKind> = OpenArgsOf<TaskRegistry, K>;

export const { useTabLayout, useTabSelection, TabLayoutProvider } = taskTabView;

// Keep the registry export for consumers that still import it directly.
export const taskTabRegistry = taskTabView.registry;

/**
 * Maps a conversation type to the corresponding tab kind so callers
 * don't have to branch on 'acp' vs 'pty' inline.
 */
export function conversationTabKind(
  type: ConversationType | undefined
): 'conversation' | 'acp-chat' {
  return type === 'acp' ? 'acp-chat' : 'conversation';
}
