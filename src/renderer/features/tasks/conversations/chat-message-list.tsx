import { LoaderCircle } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef } from 'react';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import type { ConversationStatus } from '@shared/conversation-timeline';
import { ChatMessage } from './chat-message';
import { buildChatRenderItems } from './chat-render-model';
import type { ConversationTimelineStore } from './conversation-timeline-store';

interface ChatMessageListProps {
  title: string;
  timeline: ConversationTimelineStore | undefined;
  status: ConversationStatus;
  permissionResponsesEnabled?: boolean;
  onRespondToPermission?: (requestId: string, optionId: string) => Promise<void>;
}

export const ChatMessageList = observer(function ChatMessageList({
  title,
  timeline,
  status,
  permissionResponsesEnabled = false,
  onRespondToPermission,
}: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const items = timeline?.items.data;
  const renderItems = useMemo(() => buildChatRenderItems(items ?? []), [items]);
  const isWorking = status === 'working';
  const isLoading = timeline?.items.loading === true && renderItems.length === 0;
  const timelineError = timeline?.items.error;
  const scrollKey = renderItems.map(renderItemScrollKey).join('|');

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    scrollElement.scrollTop = scrollElement.scrollHeight;
  }, [scrollKey, isWorking]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {renderItems.length === 0 && !isLoading && !timelineError ? (
        <EmptyState label={title} description="No messages yet." />
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          {timelineError ? (
            <div className="rounded-md border border-border-destructive bg-background-destructive px-3 py-2 text-sm text-foreground-destructive">
              {timelineError}
            </div>
          ) : null}
          {renderItems.map((item) => (
            <ChatMessage
              key={item.id}
              item={item}
              permissionResponsesEnabled={permissionResponsesEnabled}
              onRespondToPermission={onRespondToPermission}
            />
          ))}
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-foreground-muted">
              <LoaderCircle className="size-4 animate-spin" />
              <span>Loading messages</span>
            </div>
          ) : null}
          {isWorking ? (
            <div className="flex items-center gap-2 text-sm text-foreground-muted">
              <LoaderCircle className="size-4 animate-spin" />
              <span>Agent is working</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});

function renderItemScrollKey(item: ReturnType<typeof buildChatRenderItems>[number]): string {
  if (item.kind === 'message' || item.kind === 'reasoning') {
    return `${item.id}:${item.sourceIds.length}:${item.text.length}`;
  }
  if (item.kind === 'tool_call') {
    return `${item.id}:${item.item.status}:${item.item.output?.length ?? 0}:${item.item.error?.length ?? 0}`;
  }
  if (item.kind === 'permission_request') {
    return `${item.id}:${item.item.status}`;
  }
  return item.id;
}
