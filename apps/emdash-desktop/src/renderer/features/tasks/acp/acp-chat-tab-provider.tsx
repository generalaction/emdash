import { MessageSquareCode } from 'lucide-react';
import { action, reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import type {
  TabProvider,
  TabViewContext,
  ResolvedTab,
  ResolveContext,
} from '@renderer/features/tabs/core/tab-provider';
import type { TabItemProps } from '@renderer/features/tabs/core/tab-provider';
import {
  GenericTabDragPreview,
  GenericTabItem,
} from '@renderer/features/tabs/tab-bar/generic-tab-item';
import type { TabDescriptor } from '@shared/view-state';
import type { TaskTabContext } from '../stores/task-tab-context';
import { AcpChatPanel } from './acp-chat-panel';
import { acpChatRegistry } from './acp-chat-registry';
import type { AcpChatStore } from './acp-chat-store';
import { AcpChatTabEntry } from './acp-chat-tab-entry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AcpChatOpenArgs {
  conversationId: string;
  preview?: boolean;
}

export interface AcpChatResolvedData {
  conversationId: string;
  store: AcpChatStore;
}

type AcpChatDescriptor = Extract<TabDescriptor, { kind: 'acp-chat' }>;

// ---------------------------------------------------------------------------
// Tab item component
// ---------------------------------------------------------------------------

export const AcpChatTabItem = observer(function AcpChatTabItem({
  tab,
  host,
  ctx,
}: TabItemProps<AcpChatResolvedData>) {
  return (
    <GenericTabItem
      tab={tab}
      host={host}
      ctx={ctx}
      label="ACP Chat"
      preSlot={<MessageSquareCode size={16} />}
    />
  );
});

export const AcpChatTabDragPreview = observer(function AcpChatTabDragPreview({
  tab,
}: {
  tab: ResolvedTab<AcpChatResolvedData>;
}) {
  void tab;
  return <GenericTabDragPreview preSlot={<MessageSquareCode size={16} />} label="ACP Chat" />;
});

// ---------------------------------------------------------------------------
// Content component (forwarded to panel)
// ---------------------------------------------------------------------------

const AcpChatTabContent = observer(function AcpChatTabContent() {
  return <AcpChatPanel />;
});

// ---------------------------------------------------------------------------
// Provider definition
// ---------------------------------------------------------------------------

export const acpChatTabProvider: TabProvider<
  'acp-chat',
  AcpChatTabEntry,
  AcpChatResolvedData,
  AcpChatDescriptor,
  AcpChatOpenArgs
> = {
  kind: 'acp-chat',

  resolve(entry: AcpChatTabEntry, ctx: ResolveContext): AcpChatResolvedData | null {
    const taskCtx = ctx as unknown as TaskTabContext;
    const store = acpChatRegistry.get(taskCtx.taskId, entry.conversationId);
    if (!store) return null;
    return { conversationId: entry.conversationId, store };
  },

  serialize(entry: AcpChatTabEntry): AcpChatDescriptor {
    return {
      kind: 'acp-chat',
      tabId: entry.tabId,
      conversationId: entry.conversationId,
      isPreview: entry.isPreview,
    };
  },

  deserialize(data: AcpChatDescriptor, _ctx: TabViewContext): AcpChatTabEntry {
    return new AcpChatTabEntry(data.conversationId, data.isPreview, data.tabId);
  },

  TabItem: AcpChatTabItem,
  DragPreview: AcpChatTabDragPreview,
  Content: AcpChatTabContent,

  title(_tab: ResolvedTab<AcpChatResolvedData>): string {
    return 'ACP Chat';
  },

  open(args: AcpChatOpenArgs, host, ctx: TabViewContext): void {
    const taskCtx = ctx as unknown as TaskTabContext;

    // Ensure the store exists before opening the tab so resolve() won't return null.
    acpChatRegistry.acquire(args.conversationId, taskCtx.projectId, taskCtx.taskId);

    const existing = host.findEntry(
      (e): e is AcpChatTabEntry =>
        (e as AcpChatTabEntry).kind === 'acp-chat' &&
        (e as AcpChatTabEntry).conversationId === args.conversationId
    );

    if (args.preview) {
      if (existing) {
        host.setActiveTab(existing.tabId);
        return;
      }
      const previewEntry = host.findEntry(
        (e): e is AcpChatTabEntry =>
          (e as AcpChatTabEntry).kind === 'acp-chat' && (e as AcpChatTabEntry).isPreview
      );
      if (previewEntry) {
        previewEntry.conversationId = args.conversationId;
        host.setActiveTab(previewEntry.tabId);
        return;
      }
      const entry = new AcpChatTabEntry(args.conversationId, true);
      host.attachEntry(entry, { activate: true });
    } else {
      if (existing) {
        existing.isPreview = false;
        host.setActiveTab(existing.tabId);
        return;
      }
      const entry = new AcpChatTabEntry(args.conversationId, false);
      host.attachEntry(entry, { activate: true });
    }
  },

  mount(host, ctx): () => void {
    const taskCtx = ctx as unknown as TaskTabContext;

    const disposers = [
      // Auto-close acp-chat tabs when the registry no longer has a store for
      // that conversationId (e.g. after the conversation is deleted).
      reaction(
        () => Array.from(acpChatRegistry.getAll(taskCtx.taskId)?.keys() ?? []),
        action((ids: string[]) => {
          const idSet = new Set(ids);
          const toRemove: string[] = [];
          for (const tab of host.resolvedTabs) {
            if (tab.kind === 'acp-chat') {
              const entry = host.findEntry(
                (e): e is AcpChatTabEntry =>
                  (e as AcpChatTabEntry).kind === 'acp-chat' &&
                  (e as AcpChatTabEntry).tabId === tab.tabId
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
    ];

    return () => {
      for (const d of disposers) d();
    };
  },
};
