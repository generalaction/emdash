import { observer } from 'mobx-react-lite';
import type { TabBarItemProps, ResolvedTab } from '@renderer/features/tabs/core/tab-provider';
import {
  GenericTabDragPreview,
  GenericTabItem,
} from '@renderer/features/tabs/tab-bar/generic-tab-item';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { AgentStatusIndicator } from '@renderer/lib/components/agent-status-indicator';
import { MAX_CONVERSATION_TITLE_LENGTH } from '@shared/core/conversations/conversations';
import type { ConversationTabResource } from './conversation-tab-resource';
import { formatConversationTitleForDisplay } from './conversation-title-utils';

export const ConversationTabBarItem = observer(function ConversationTabBarItem({
  tab,
  host,
  ctx,
}: TabBarItemProps<ConversationTabResource>) {
  const store = tab.resource.store;
  const title = formatConversationTitleForDisplay(store.data.providerId, store.data.title);
  const rawTitle = store.data.title ?? '';

  return (
    <GenericTabItem
      tab={tab}
      host={host}
      ctx={ctx}
      label={title}
      preSlot={<AgentIcon id={store.data.providerId} size={16} />}
      statusSlot={
        <span className="transition-opacity group-hover:opacity-0">
          <AgentStatusIndicator status={store.indicatorStatus} disableTooltip />
        </span>
      }
      kindCommands={[
        {
          id: 'conversation:rename',
          label: 'Rename',
          group: 'edit',
          shortcut: 'tabRename',
          run: () => host.requestRename(tab.tabId),
        },
      ]}
      renameValue={rawTitle}
      renameMaxLength={MAX_CONVERSATION_TITLE_LENGTH}
    />
  );
});

export const ConversationTabBarItemDragPreview = observer(
  function ConversationTabBarItemDragPreview({
    tab,
  }: {
    tab: ResolvedTab<ConversationTabResource>;
  }) {
    const store = tab.resource.store;
    const label = formatConversationTitleForDisplay(store.data.providerId, store.data.title);
    return (
      <GenericTabDragPreview
        preSlot={
          store.data.providerId ? (
            <AgentIcon id={store.data.providerId} size={16} className="shrink-0" />
          ) : undefined
        }
        label={label}
      />
    );
  }
);
