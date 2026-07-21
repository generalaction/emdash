import { Command } from 'cmdk';
import { observer } from 'mobx-react-lite';
import { AgentIcon } from '@core/features/agents/api/browser/components/agent-icon';
import type { ConversationStore } from '@core/features/conversations/api/browser/conversation-manager';
import { formatConversationTitleForDisplay } from '@core/features/conversations/api/browser/conversation-title-utils';
import { AgentStatusIndicator } from '@core/primitives/ui/browser/components/agent-status-indicator';
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
  const title = formatConversationTitleForDisplay(conv.data.providerId, conv.data.title ?? '');

  return (
    <Command.Item value={value} onSelect={onSelect} className={PALETTE_ITEM_CLASS}>
      <AgentIcon id={conv.data.providerId} size={16} />
      <span className="flex-1 truncate">{title}</span>
      <AgentStatusIndicator status={conv.indicatorStatus} disableTooltip />
    </Command.Item>
  );
});
