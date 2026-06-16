import type { ChatHandle } from '@emdash/chat-ui';
import { ChatTranscript } from '@emdash/chat-ui/react';
import { observer } from 'mobx-react-lite';
import { useCallback } from 'react';
import { useAgents } from '@renderer/lib/stores/use-agents';
import type { ModelOption } from '@shared/core/agents/agent-payload';
import { useConversations } from '../../task-view-context';
import { ChatComposer } from './chat-composer';

export const ChatPanel = observer(function ChatPanel({
  conversationId,
}: {
  conversationId: string;
}) {
  const conversations = useConversations();
  const store = conversations.getOrCreateChatStore(conversationId);
  const convStore = conversations.conversations.get(conversationId);
  const providerId = convStore?.data.providerId;

  const { data: agents } = useAgents();
  const agentPayload = agents?.find((a) => a.id === providerId);
  const modelOptions =
    agentPayload?.capabilities?.models?.kind === 'selectable'
      ? (
          agentPayload.capabilities.models as {
            kind: 'selectable';
            modelOptions: Record<string, ModelOption>;
          }
        ).modelOptions
      : null;

  const handleReady = useCallback(
    ({ transcript }: ChatHandle) => {
      store.bindTranscript(transcript);
    },
    [store]
  );

  const handleSubmit = (text: string) => {
    store.setInput(text);
    store.sendPrompt();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Transcript — chat-ui handles virtualization and stick-to-bottom */}
      <div className="relative flex-1 min-h-0">
        <ChatTranscript className="h-full" stickToBottom={true} onReady={handleReady} />

        {/* Empty state — shown when there are no messages yet */}
        {!store.hasItems && !store.isWorking && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-foreground-secondary">
            Start a conversation
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 bg-background max-w-2xl mx-auto w-full px-4 pb-3">
        <ChatComposer
          disabled={store.isClosed}
          isWorking={store.isWorking}
          modelOptions={modelOptions}
          selectedModel={store.selectedModel}
          onModelChange={(id) => store.setModel(id)}
          onSubmit={handleSubmit}
          onStop={() => store.cancel()}
        />
      </div>
    </div>
  );
});
