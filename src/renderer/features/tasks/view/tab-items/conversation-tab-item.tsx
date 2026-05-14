import { observer } from 'mobx-react-lite';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { AgentStatusIndicator } from '../../components/agent-status-indicator';
import { formatConversationTitleForDisplay } from '../../conversations/conversation-title-utils';
import type { ResolvedConversationTab } from '../../tabs/tab-manager-store';
import { TabCloseButton } from './tab-close-button';
import { TabDragPreviewShell, TabItemShell } from './tab-item-shell';

export const ConversationTabItem = observer(function ConversationTabItem({
  tab,
  onSelect,
  onPin,
  onClose,
}: {
  tab: ResolvedConversationTab;
  onSelect: () => void;
  onPin: () => void;
  onClose: () => void;
}) {
  const config = agentConfig[tab.store.data.providerId];
  const title = formatConversationTitleForDisplay(tab.store.data.providerId, tab.store.data.title);

  return (
    <TabItemShell
      tabId={tab.tabId}
      isActive={tab.isActive}
      title={tab.isPreview ? `${title} (preview — double-click to keep)` : title}
      onSelect={onSelect}
      onPin={onPin}
      className="text-foreground-muted hover:bg-background-secondary-1/40"
      activeClassName="bg-background-secondary-1 text-foreground hover:bg-background-secondary-1"
      innerPaddingRight="pr-1"
    >
      {config ? (
        <AgentLogo
          logo={config.logo}
          alt={config.alt}
          isSvg={config.isSvg}
          invertInDark={config.invertInDark}
          className="size-4 shrink-0"
        />
      ) : null}
      <span className={cn('max-w-24 truncate p-1', tab.isPreview && 'italic')}>{title}</span>
      <TabCloseButton
        onClose={onClose}
        ariaLabel={`Close ${title}`}
        statusIndicator={
          <span className="transition-opacity group-hover:opacity-0">
            <AgentStatusIndicator status={tab.store.indicatorStatus} disableTooltip />
          </span>
        }
      />
    </TabItemShell>
  );
});

export const ConversationTabDragPreview = observer(function ConversationTabDragPreview({
  tab,
}: {
  tab: ResolvedConversationTab;
}) {
  const config = agentConfig[tab.store.data.providerId];
  const label = formatConversationTitleForDisplay(tab.store.data.providerId, tab.store.data.title);
  return (
    <TabDragPreviewShell>
      {config ? (
        <AgentLogo
          logo={config.logo}
          alt={config.alt}
          isSvg={config.isSvg}
          invertInDark={config.invertInDark}
          className="size-4 shrink-0"
        />
      ) : null}
      <span className="max-w-[200px] truncate">{label}</span>
    </TabDragPreviewShell>
  );
});
