import type { ChatHandle } from '@emdash/chat-ui';
import { ChatTranscript } from '@emdash/chat-ui/react';
import { ChatComposer } from '@emdash/ui/components';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAgents } from '@renderer/lib/stores/use-agents';
import type { ModelOption } from '@shared/core/agents/agent-payload';
import { useConversations } from '../../task-view-context';
import { ChatEmptyState } from './chat-empty-state';

const PAD_TOP = 16;
const PAD_BOTTOM_MARGIN = 12;

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

  // Measure the floating composer height so we can reserve matching canvas space.
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerH, setComposerH] = useState(0);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.borderBoxSize[0]?.blockSize ?? entries[0]?.contentRect.height ?? 0;
      setComposerH(Math.round(h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="relative h-full overflow-hidden bg-background">
      {/* Full-bleed transcript — reserves canvas space for the floating composer */}
      <ChatTranscript
        className="absolute inset-0"
        stickToBottom={true}
        padTop={PAD_TOP}
        padBottom={composerH + PAD_BOTTOM_MARGIN}
        onReady={handleReady}
      />

      {/* Empty / loading states overlay the transcript */}
      {!store.isReady && !store.isClosed ? (
        <ChatEmptyState variant="loading" />
      ) : !store.hasItems && !store.isWorking ? (
        <ChatEmptyState variant="empty" />
      ) : null}

      {/* Floating composer — measured via ResizeObserver above */}
      <div
        ref={composerRef}
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-2xl bg-background/80 px-4 pb-3 backdrop-blur-sm"
      >
        <ChatComposer
          disabled={store.isClosed}
          isWorking={store.isWorking}
          canSubmit={store.isReady}
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
