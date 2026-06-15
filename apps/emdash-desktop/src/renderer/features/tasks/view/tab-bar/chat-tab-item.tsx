import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { formatConversationTitleForDisplay } from '../../conversations/conversation-title-utils';
import type { ResolvedChatTab } from '../../tabs/tab-manager-store';
import { TabCloseButton } from './tab-close-button';
import { TabItemShell } from './tab-item-shell';
import { TabTitle } from './tab-title';

export const ChatTabItem = observer(function ChatTabItem({
  tab,
  onSelect,
  onPin,
  onClose,
}: {
  tab: ResolvedChatTab;
  onSelect: () => void;
  onPin: () => void;
  onClose: () => void;
}) {
  const title = formatConversationTitleForDisplay(tab.store.data.providerId, tab.store.data.title);

  return (
    <TabItemShell
      tabId={tab.tabId}
      isActive={tab.isActive}
      title={tab.isPreview ? `${title} (preview — click to keep)` : title}
      onSelect={onSelect}
      onPin={onPin}
      onDoubleClick={onPin}
      onClose={onClose}
    >
      <MessageSquare className="size-4 shrink-0" />
      <TabTitle isActive={tab.isActive} isPreview={tab.isPreview} maxWidth="max-w-24">
        {title}
      </TabTitle>
      <TabCloseButton onClose={onClose} ariaLabel={`Close ${title}`} />
    </TabItemShell>
  );
});
