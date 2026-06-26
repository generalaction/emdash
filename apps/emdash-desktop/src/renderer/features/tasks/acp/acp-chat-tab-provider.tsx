import { MessageSquareCode } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type {
  TabEntry,
  TabHandle,
  TabProvider,
  TabViewContext,
} from '@renderer/features/tabs/core/tab-provider';
import type { TabItemProps, ResolvedTab } from '@renderer/features/tabs/core/tab-provider';
import { createTabProvider } from '@renderer/features/tabs/core/tab-provider-registry';
import {
  GenericTabDragPreview,
  GenericTabItem,
} from '@renderer/features/tabs/tab-bar/generic-tab-item';
import type { TaskTabContext } from '../stores/task-tab-context';
import { AcpChatPanel } from './acp-chat-panel';
import { getAcpChatResourceManager } from './acp-chat-resource-manager';
import { AcpChatTabResource } from './acp-chat-tab-resource';

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface AcpChatPayload {
  conversationId: string;
}

export interface AcpChatOpenArgs {
  conversationId: string;
  preview?: boolean;
}

// ---------------------------------------------------------------------------
// Tab item component
// ---------------------------------------------------------------------------

export const AcpChatTabItem = observer(function AcpChatTabItem({
  tab,
  host,
  ctx,
}: TabItemProps<AcpChatTabResource>) {
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
  tab: ResolvedTab<AcpChatTabResource>;
}) {
  void tab;
  return <GenericTabDragPreview preSlot={<MessageSquareCode size={16} />} label="ACP Chat" />;
});

// ---------------------------------------------------------------------------
// Content component
// ---------------------------------------------------------------------------

const AcpChatTabContent = observer(function AcpChatTabContent() {
  return <AcpChatPanel />;
});

// ---------------------------------------------------------------------------
// Provider definition
// ---------------------------------------------------------------------------

export const acpChatTabProvider: TabProvider<
  'acp-chat',
  AcpChatPayload,
  AcpChatTabResource,
  AcpChatOpenArgs
> = createTabProvider({
  kind: 'acp-chat',

  resourceKey: (payload) => payload.conversationId,

  onBeforeOpen: (args: AcpChatOpenArgs): AcpChatPayload | null => {
    return { conversationId: args.conversationId };
  },

  initialize(
    entry: TabEntry<AcpChatPayload>,
    _handle: TabHandle,
    ctx: TabViewContext
  ): AcpChatTabResource {
    const taskCtx = ctx as TaskTabContext;
    const manager = getAcpChatResourceManager(taskCtx.taskId, taskCtx.projectId);
    const store = manager.retain(entry.payload.conversationId);
    return new AcpChatTabResource(store);
  },

  dispose(
    entry: TabEntry<AcpChatPayload>,
    _resource: AcpChatTabResource,
    ctx: TabViewContext
  ): void {
    const taskCtx = ctx as TaskTabContext;
    getAcpChatResourceManager(taskCtx.taskId, taskCtx.projectId).release(
      entry.payload.conversationId
    );
  },

  TabItem: AcpChatTabItem,
  DragPreview: AcpChatTabDragPreview,
  Content: AcpChatTabContent,

  title(): string {
    return 'ACP Chat';
  },
});
