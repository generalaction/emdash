import { Send } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import type { ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { useConversations } from '@renderer/features/tasks/task-view-context';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Textarea } from '@renderer/lib/ui/textarea';

interface ChatConversationPanelProps {
  conversation: ConversationStore;
}

export const ChatConversationPanel = observer(function ChatConversationPanel({
  conversation,
}: ChatConversationPanelProps) {
  const conversations = useConversations();
  const timeline = conversations.timelines.get(conversation.data.id);
  const items = timeline?.items.data ?? [];
  const [draft, setDraft] = useState('');
  const trimmedDraft = draft.trim();

  useEffect(() => {
    timeline?.start();
  }, [timeline]);

  const sendMessage = async () => {
    if (!trimmedDraft || !timeline) return;
    setDraft('');
    try {
      await conversations.sendMessage(conversation.data.id, trimmedDraft);
    } catch {
      setDraft(trimmedDraft);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {items.length === 0 ? (
          <EmptyState
            label={conversation.data.title || 'Chat conversation'}
            description="No messages yet."
          />
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-md border border-border bg-background-secondary-1 p-3"
              >
                {item.kind === 'user_message' || item.kind === 'assistant_message' ? (
                  <p className="text-sm whitespace-pre-wrap text-foreground">{item.text}</p>
                ) : item.kind === 'reasoning' ? (
                  <p className="text-sm whitespace-pre-wrap text-foreground-secondary">
                    {item.text}
                  </p>
                ) : item.kind === 'error' ? (
                  <p className="text-destructive text-sm whitespace-pre-wrap">{item.message}</p>
                ) : (
                  <p className="text-sm text-foreground-secondary">{item.kind}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-border bg-background-secondary-1 px-4 py-3">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <Textarea
            className="max-h-32 min-h-10 resize-none bg-background"
            placeholder="Message"
            rows={1}
            value={draft}
            disabled={!timeline}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return;
              event.preventDefault();
              void sendMessage();
            }}
          />
          <Button
            size="icon"
            disabled={!trimmedDraft || !timeline}
            aria-label="Send message"
            onClick={sendMessage}
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
});
