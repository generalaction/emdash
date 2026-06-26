import { observer } from 'mobx-react-lite';
import type {
  TabEntry,
  TabHandle,
  TabProvider,
  TabViewContext,
} from '@renderer/features/tabs/core/tab-provider';
import { createTabProvider } from '@renderer/features/tabs/core/tab-provider-registry';
import { getConversationSessionManager } from '../stores/conversation-session-manager';
import type { TaskTabContext } from '../stores/task-tab-context';
import { ConversationTabBarItem, ConversationTabBarItemDragPreview } from './conversation-tab-item';
import { ConversationTabResource } from './conversation-tab-resource';
import { formatConversationTitleForDisplay } from './conversation-title-utils';
import { ConversationsPanel } from './conversations-panel';

export interface ConversationState {
  conversationId: string;
}

export interface ConversationOpenArgs {
  conversationId: string;
  /** When true, opens as a preview tab (replaced on next preview open). */
  preview?: boolean;
}

/**
 * Mounts ConversationsPanel unconditionally. Visibility is managed by PaneContent
 * via visibility:hidden + inert so PTY sessions survive tab switches.
 */
const ConversationTabContent = observer(function ConversationTabContent() {
  return <ConversationsPanel />;
});

export const conversationTabProvider: TabProvider<
  'conversation',
  ConversationState,
  ConversationTabResource,
  ConversationOpenArgs
> = createTabProvider({
  kind: 'conversation',

  mount: {
    type: 'single',
    dedupKey: (s) => s.conversationId,
  },

  onBeforeOpen: (args: ConversationOpenArgs): ConversationState | null => {
    return { conversationId: args.conversationId };
  },

  initialize(
    entry: TabEntry<ConversationState>,
    handle: TabHandle,
    ctx: TabViewContext
  ): ConversationTabResource {
    const taskCtx = ctx as TaskTabContext;
    const sessionManager = getConversationSessionManager(taskCtx.taskId);
    const store = sessionManager.acquire(entry.state.conversationId);
    if (!store) {
      // Conversation not found; return a dummy resource that will auto-close.
      const dummy: ConversationTabResource = {
        store: undefined as never,
        dispose: () => {
          sessionManager.release(entry.state.conversationId);
        },
        onActivate: undefined,
      } as unknown as ConversationTabResource;
      // Auto-close on next tick.
      setTimeout(() => void handle.close(), 0);
      return dummy;
    }
    return new ConversationTabResource(store, taskCtx.taskId, handle);
  },

  dispose(
    entry: TabEntry<ConversationState>,
    _resource: ConversationTabResource,
    ctx: TabViewContext
  ): void {
    const taskCtx = ctx as TaskTabContext;
    getConversationSessionManager(taskCtx.taskId).release(entry.state.conversationId);
  },

  commands: {
    rename: {
      label: 'Rename',
      exec: (resource: ConversationTabResource, name?: string) => {
        if (name) resource.rename(name);
      },
    },
  },

  TabBarItem: ConversationTabBarItem,
  TabBarItemDragPreview: ConversationTabBarItemDragPreview,
  TabContent: ConversationTabContent,

  title(_entry: TabEntry<ConversationState>, resource: ConversationTabResource): string {
    return formatConversationTitleForDisplay(
      resource.store.data.providerId,
      resource.store.data.title
    );
  },
});
