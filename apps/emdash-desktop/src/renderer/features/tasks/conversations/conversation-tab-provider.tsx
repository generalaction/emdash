import { action, autorun, reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import type {
  TabProvider,
  TabViewContext,
  ResolvedTab,
  ResolveContext,
} from '@renderer/features/tabs/core/tab-provider';
import { setTelemetryConversationScope } from '@renderer/utils/telemetry-scope';
import type { TabDescriptor } from '@shared/view-state';
import { conversationRegistry } from '../stores/conversation-registry';
import type { TaskTabContext } from '../stores/task-tab-context';
import type { ConversationStore } from './conversation-manager';
import { ConversationTabEntry } from './conversation-tab-entry';
import { ConversationTabItem, ConversationTabDragPreview } from './conversation-tab-item';
import { formatConversationTitleForDisplay } from './conversation-title-utils';
import { ConversationsPanel } from './conversations-panel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationOpenArgs {
  conversationId: string;
  /** When true, opens as a preview tab (replaced on next preview open). */
  preview?: boolean;
}

export interface ConversationResolvedData {
  conversationId: string;
  store: ConversationStore;
}

type ConversationDescriptor = Extract<TabDescriptor, { kind: 'conversation' }>;

/**
 * Mounts ConversationsPanel unconditionally. Visibility is managed by the
 * parent PaneContent via visibility:hidden + inert so PTY sessions survive
 * tab switches without needing an extra ShowHide wrapper here.
 */
const ConversationTabContent = observer(function ConversationTabContent() {
  return <ConversationsPanel />;
});

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const conversationTabProvider: TabProvider<
  'conversation',
  ConversationTabEntry,
  ConversationResolvedData,
  ConversationDescriptor,
  ConversationOpenArgs
> = {
  kind: 'conversation',

  resolve(entry: ConversationTabEntry, ctx: ResolveContext): ConversationResolvedData | null {
    const store = conversationRegistry
      .get((ctx as unknown as TaskTabContext).taskId)
      ?.conversations.get(entry.conversationId);
    if (!store) return null;
    return { conversationId: entry.conversationId, store };
  },

  serialize(entry: ConversationTabEntry): ConversationDescriptor {
    return {
      kind: 'conversation',
      tabId: entry.tabId,
      conversationId: entry.conversationId,
      isPreview: entry.isPreview,
    };
  },

  deserialize(data: ConversationDescriptor, _ctx: TabViewContext): ConversationTabEntry {
    return new ConversationTabEntry(data.conversationId, data.isPreview, data.tabId);
  },

  TabItem: ConversationTabItem,
  DragPreview: ConversationTabDragPreview,
  Content: ConversationTabContent,

  title(tab: ResolvedTab<ConversationResolvedData>): string {
    return formatConversationTitleForDisplay(tab.store.data.providerId, tab.store.data.title);
  },

  open(args: ConversationOpenArgs, host, _ctx: TabViewContext): void {
    const existing = host.findEntry(
      (e): e is ConversationTabEntry =>
        (e as ConversationTabEntry).kind === 'conversation' &&
        (e as ConversationTabEntry).conversationId === args.conversationId
    );

    if (args.preview) {
      // Preview open: activate existing (never demote stable → preview), or replace/create preview.
      if (existing) {
        host.setActiveTab(existing.tabId);
        return;
      }
      const previewEntry = host.findEntry(
        (e): e is ConversationTabEntry =>
          (e as ConversationTabEntry).kind === 'conversation' &&
          (e as ConversationTabEntry).isPreview
      );
      if (previewEntry) {
        // Replace in-place: mutate conversationId so the same tabId and slot are reused.
        previewEntry.conversationId = args.conversationId;
        host.setActiveTab(previewEntry.tabId);
        return;
      }
      const entry = new ConversationTabEntry(args.conversationId, true);
      host.attachEntry(entry, { activate: true });
    } else {
      // Stable open: promote existing preview or open new stable tab.
      if (existing) {
        existing.isPreview = false;
        host.setActiveTab(existing.tabId);
        return;
      }
      const entry = new ConversationTabEntry(args.conversationId, false);
      host.attachEntry(entry, { activate: true });
    }
  },

  mount(host, ctx): () => void {
    const taskCtx = ctx as TaskTabContext;
    const conversations = () => conversationRegistry.get(taskCtx.taskId);

    const getActiveConversation = (): ConversationStore | undefined => {
      const activeId = host.resolvedActiveTabId;
      if (!activeId) return undefined;
      const entry = host.findEntry(
        (e): e is ConversationTabEntry =>
          (e as ConversationTabEntry).kind === 'conversation' &&
          (e as ConversationTabEntry).tabId === activeId
      );
      if (!entry) return undefined;
      return conversations()?.conversations.get(entry.conversationId);
    };

    const disposers = [
      // Auto-close conversation tabs when the conversation is deleted.
      reaction(
        () => Array.from(conversations()?.conversations.keys() ?? []),
        action((ids: string[]) => {
          const idSet = new Set(ids);
          const toRemove: string[] = [];
          for (const tab of host.resolvedTabs) {
            if (tab.kind === 'conversation') {
              const entry = host.findEntry(
                (e): e is ConversationTabEntry =>
                  (e as ConversationTabEntry).kind === 'conversation' &&
                  (e as ConversationTabEntry).tabId === tab.tabId
              );
              if (entry && !idSet.has(entry.conversationId)) {
                toRemove.push(tab.tabId);
              }
            }
          }
          for (const tabId of toRemove) {
            host.closeTab(tabId);
          }
        })
      ),
      // Mark conversation as seen when it becomes the active tab in the focused pane.
      autorun(() => {
        const conv = getActiveConversation();
        if (host.isFocused && conv && !conv.seen) {
          conv.markSeen();
        }
      }),
      // Update telemetry scope when the active conversation changes in the focused pane.
      reaction(
        () => getActiveConversation()?.data.id ?? null,
        (conversationId) => {
          if (host.isFocused) {
            setTelemetryConversationScope(conversationId);
          }
        }
      ),
    ];

    return () => {
      for (const d of disposers) d();
    };
  },

  onActivate(entry: ConversationTabEntry, _ctx: TabViewContext): void {
    setTelemetryConversationScope(entry.conversationId);
  },

  onClose(entry: ConversationTabEntry, ctx: TabViewContext): void {
    conversationRegistry
      .get((ctx as TaskTabContext).taskId)
      ?.conversations.get(entry.conversationId)
      ?.markSeen();
  },

  rename(entry: ConversationTabEntry, name: string, ctx: TabViewContext): void {
    void conversationRegistry
      .get((ctx as TaskTabContext).taskId)
      ?.renameConversation(entry.conversationId, name);
  },
};
