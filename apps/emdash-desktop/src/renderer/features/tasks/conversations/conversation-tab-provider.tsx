import { Pencil } from 'lucide-react';
import { action, autorun, reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useRef } from 'react';
import type {
  TabProvider,
  TabItemProps,
  TabKindContext,
  TabRendererProps,
  ResolvedTab,
  ResolveContext,
} from '@renderer/features/tabs/core/tab-provider';
import { registerTabProvider } from '@renderer/features/tabs/core/tab-provider-registry';
import { TabContextMenu } from '@renderer/features/tabs/tab-bar/tab-context-menu';
import { ShowHide } from '@renderer/lib/ui/show-hide';
import { setTelemetryConversationScope } from '@renderer/utils/telemetry-scope';
import type { TabDescriptor } from '@shared/view-state';
import { conversationRegistry } from '../stores/conversation-registry';
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

// ---------------------------------------------------------------------------
// UI adapters — bridge new TabItemProps to existing component APIs
// ---------------------------------------------------------------------------

function ConversationTabItemAdapter({ tab, host, ctx }: TabItemProps<ConversationResolvedData>) {
  const renameRef = useRef<(() => void) | null>(null);
  return (
    <TabContextMenu
      tab={tab}
      host={host}
      ctx={ctx}
      kindCommands={[
        {
          id: 'conversation:rename',
          label: 'Rename',
          icon: Pencil,
          group: 'edit',
          run: () => renameRef.current?.(),
        },
      ]}
    >
      <ConversationTabItem
        tab={tab}
        onSelect={() => host.setActiveTab(tab.tabId)}
        onPin={() => host.pin(tab.tabId)}
        onClose={() => host.requestCloseTab(tab.tabId)}
        onRenameSubmit={(name) =>
          void conversationRegistry.get(ctx.taskId)?.renameConversation(tab.conversationId, name)
        }
        renameRef={renameRef}
      />
    </TabContextMenu>
  );
}

/**
 * Mounts ConversationsPanel unconditionally; shows/hides it based on whether a
 * conversation tab is the active tab in this pane. ConversationsPanel is kept
 * alive (ShowHide) so PTY sessions survive tab switches.
 */
const ConversationTabRenderer = observer(function ConversationTabRenderer({
  host,
}: TabRendererProps) {
  const activeTab = host.resolvedTabs.find((t) => t.isActive);
  const visible = activeTab?.kind === 'conversation';
  return (
    <ShowHide visible={visible}>
      <ConversationsPanel />
    </ShowHide>
  );
});

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const conversationTabProvider: TabProvider<
  ConversationTabEntry,
  ConversationResolvedData,
  ConversationDescriptor,
  ConversationOpenArgs
> = {
  kind: 'conversation',

  resolve(entry: ConversationTabEntry, ctx: ResolveContext): ConversationResolvedData | null {
    const store = conversationRegistry.get(ctx.taskId)?.conversations.get(entry.conversationId);
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

  deserialize(data: ConversationDescriptor, _ctx: TabKindContext): ConversationTabEntry {
    return new ConversationTabEntry(data.conversationId, data.isPreview, data.tabId);
  },

  TabItem: ConversationTabItemAdapter,
  DragPreview: ConversationTabDragPreview,
  Renderer: ConversationTabRenderer,

  title(tab: ResolvedTab<ConversationResolvedData>): string {
    return formatConversationTitleForDisplay(tab.store.data.providerId, tab.store.data.title);
  },

  open(args: ConversationOpenArgs, host, _ctx: TabKindContext): void {
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
    const conversations = () => conversationRegistry.get(ctx.taskId);

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

  onActivate(entry: ConversationTabEntry, _ctx: TabKindContext): void {
    setTelemetryConversationScope(entry.conversationId);
  },

  onClose(entry: ConversationTabEntry, ctx: TabKindContext): void {
    conversationRegistry.get(ctx.taskId)?.conversations.get(entry.conversationId)?.markSeen();
  },
};

registerTabProvider(conversationTabProvider);
