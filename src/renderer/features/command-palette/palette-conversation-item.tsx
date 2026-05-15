import { Command } from 'cmdk';
import { observer } from 'mobx-react-lite';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import type { ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { agentConfig } from '@renderer/utils/agentConfig';
import { PALETTE_ITEM_CLASS } from './palette-item-styles';

export const PaletteConversationItem = observer(function PaletteConversationItem({
  conv,
  value,
  onSelect,
}: {
  conv: ConversationStore;
  value: string;
  onSelect: () => void;
}) {
  const config = agentConfig[conv.data.providerId];
  const title = formatConversationTitleForDisplay(conv.data.providerId, conv.data.title ?? '');

  return (
    <Command.Item value={value} onSelect={onSelect} className={PALETTE_ITEM_CLASS}>
      {config ? (
        <AgentLogo
          logo={config.logo}
          alt={config.alt}
          isSvg={config.isSvg}
          invertInDark={config.invertInDark}
          className="size-4 shrink-0"
        />
      ) : null}
      <span className="flex-1 truncate">{title}</span>
      <AgentStatusIndicator status={conv.indicatorStatus} disableTooltip />
    </Command.Item>
  );
});
