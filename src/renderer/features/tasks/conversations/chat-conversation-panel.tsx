import { Send } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Textarea } from '@renderer/lib/ui/textarea';

interface ChatConversationPanelProps {
  conversation: ConversationStore;
}

export const ChatConversationPanel = observer(function ChatConversationPanel({
  conversation,
}: ChatConversationPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1">
        <EmptyState
          label={conversation.data.title || 'Chat conversation'}
          description="No messages yet."
        />
      </div>
      <div className="border-t border-border bg-background-secondary-1 px-4 py-3">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <Textarea
            className="max-h-32 min-h-10 resize-none bg-background"
            placeholder="Message"
            rows={1}
            disabled
          />
          <Button size="icon" disabled aria-label="Send message">
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
});
