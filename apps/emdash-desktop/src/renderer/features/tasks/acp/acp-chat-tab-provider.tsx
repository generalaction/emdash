import { MessageSquareCode } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type {
  TabEntry,
  TabHandle,
  TabProvider,
  TabViewContext,
  TabBarItemProps,
  ResolvedTab,
} from '@renderer/features/tabs/core/tab-provider';
import { createTabProvider } from '@renderer/features/tabs/core/tab-provider-registry';
import {
  GenericTabDragPreview,
  GenericTabItem,
} from '@renderer/features/tabs/tab-bar/generic-tab-item';
import type { TaskTabContext } from '../stores/task-tab-context';
import { AcpChatPanel } from './acp-chat-panel';
import { getAcpChatResourceManager } from './acp-chat-resource-manager';
import { AcpChatTabResource } from './acp-chat-tab-resource';

export interface AcpChatState {
  conversationId: string;
}

export interface AcpChatOpenArgs {
  conversationId: string;
}

export const AcpChatTabBarItem = observer(function AcpChatTabBarItem({
  tab,
  host,
  ctx,
}: TabBarItemProps<AcpChatTabResource>) {
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

export const AcpChatTabBarItemDragPreview = observer(function AcpChatTabBarItemDragPreview({
  tab,
}: {
  tab: ResolvedTab<AcpChatTabResource>;
}) {
  void tab;
  return <GenericTabDragPreview preSlot={<MessageSquareCode size={16} />} label="ACP Chat" />;
});

const AcpChatTabContent = observer(function AcpChatTabContent() {
  return <AcpChatPanel />;
});

export const acpChatTabProvider: TabProvider<
  'acp-chat',
  AcpChatState,
  AcpChatTabResource,
  AcpChatOpenArgs
> = createTabProvider({
  kind: 'acp-chat',
  resourceKey: (s: AcpChatState) => s.conversationId,

  // No mount: multi, no cross-pane dedup. Could be made 'single' later.

  onBeforeOpen: (args: AcpChatOpenArgs): AcpChatState | null => {
    return { conversationId: args.conversationId };
  },

  initialize(
    entry: TabEntry<AcpChatState>,
    _handle: TabHandle,
    ctx: TabViewContext
  ): AcpChatTabResource {
    const taskCtx = ctx as TaskTabContext;
    const manager = getAcpChatResourceManager(taskCtx.taskId, taskCtx.projectId);
    const store = manager.acquire(entry.state.conversationId);
    return new AcpChatTabResource(store);
  },

  dispose(entry: TabEntry<AcpChatState>, _resource: AcpChatTabResource, ctx: TabViewContext): void {
    const taskCtx = ctx as TaskTabContext;
    getAcpChatResourceManager(taskCtx.taskId, taskCtx.projectId).release(
      entry.state.conversationId
    );
  },

  TabBarItem: AcpChatTabBarItem,
  TabBarItemDragPreview: AcpChatTabBarItemDragPreview,
  TabContent: AcpChatTabContent,
});
