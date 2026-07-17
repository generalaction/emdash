import { Command } from 'cmdk';
import { observer } from 'mobx-react-lite';
import type { ConversationStore } from '@core/features/conversations/browser/conversation-manager';
import { formatConversationTitleForDisplay } from '@core/features/conversations/browser/conversation-title-utils';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { AgentStatusIndicator } from '@renderer/lib/components/agent-status-indicator';
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
