import { Brain, Loader2, Square, Wrench } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { useAgents } from '@renderer/lib/stores/use-agents';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { cn } from '@renderer/utils/utils';
import type { ModelOption } from '@shared/core/agents/agent-payload';
import { useConversations } from '../../task-view-context';
import type { ChatMessageItem, ChatToolItem } from './chat-store';

function MessageBubble({ message }: { message: ChatMessageItem }) {
  const isUser = message.role === 'user';
  const isThought = message.role === 'thought';

  if (isThought) {
    return (
      <div className="flex items-start gap-2 px-4 py-1 opacity-60">
        <Brain className="mt-0.5 size-3.5 shrink-0 text-foreground-secondary" />
        <span className="text-xs text-foreground-secondary italic">{message.text}</span>
      </div>
    );
  }

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
          isUser
            ? 'bg-primary-button-background text-primary-button-foreground'
            : 'bg-background-secondary text-foreground'
        )}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{message.text}</span>
        ) : (
          <MarkdownRenderer content={message.text} variant="compact" />
        )}
        {message.streaming && (
          <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-current opacity-75" />
        )}
      </div>
    </div>
  );
}

function ToolStatusLine({ tool }: { tool: ChatToolItem }) {
  return (
    <div className="flex items-center gap-2 px-4 py-0.5 text-xs text-foreground-secondary">
      <Wrench className="size-3 shrink-0" />
      <span className="truncate font-mono">{tool.toolName}</span>
      {tool.inputSummary && <span className="truncate opacity-60">({tool.inputSummary})</span>}
      {tool.status === 'running' && <Loader2 className="ml-auto size-3 shrink-0 animate-spin" />}
      {tool.status === 'error' && <span className="ml-auto text-red-400">failed</span>}
    </div>
  );
}

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
  const modelOptions: Record<string, ModelOption> | null =
    agentPayload?.capabilities?.models?.kind === 'selectable'
      ? (
          agentPayload.capabilities.models as {
            kind: 'selectable';
            modelOptions: Record<string, ModelOption>;
          }
        ).modelOptions
      : null;

  const scrollRef = useRef<HTMLDivElement>(null);

  const lastItem = store.items.at(-1);
  const lastItemText = lastItem?.kind === 'message' ? lastItem.text : lastItem?.status;

  // Scroll to bottom when the transcript changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [store.items.length, lastItemText]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      store.sendPrompt();
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Message transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {store.items.length === 0 && !store.isWorking ? (
          <div className="flex h-full items-center justify-center text-sm text-foreground-secondary">
            Start a conversation
          </div>
        ) : (
          <div className="space-y-3 px-4 py-4">
            {store.items.map((item) =>
              item.kind === 'message' ? (
                <MessageBubble key={item.id} message={item} />
              ) : (
                <ToolStatusLine key={item.id} tool={item} />
              )
            )}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-border bg-background p-3">
        {/* Model selector row */}
        {modelOptions && (
          <div className="mb-2 flex items-center gap-1">
            <span className="text-xs text-foreground-secondary">Model:</span>
            <select
              className="rounded border border-border bg-background-secondary px-2 py-0.5 text-xs text-foreground focus:outline-none"
              value={store.selectedModel}
              onChange={(e) => store.setModel(e.target.value)}
              disabled={store.isClosed}
            >
              {Object.entries(modelOptions).map(([id, opt]) => (
                <option key={id} value={id} title={opt.description}>
                  {opt.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-end gap-2 rounded-xl border border-border bg-background-secondary p-2">
          <textarea
            className="min-h-[36px] flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-passive"
            placeholder={store.isClosed ? 'Session closed' : 'Message...'}
            disabled={store.isClosed}
            rows={1}
            value={store.input}
            onChange={(e) => store.setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ maxHeight: '120px', overflowY: 'auto' }}
          />
          {store.isWorking ? (
            <button
              type="button"
              onClick={() => store.cancel()}
              className="flex h-8 shrink-0 items-center justify-center rounded-lg bg-red-500 px-3 text-sm font-medium text-white hover:bg-red-600"
              aria-label="Stop"
            >
              <Square className="mr-1 size-3 fill-current" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => store.sendPrompt()}
              disabled={!store.input.trim() || store.isClosed}
              className="flex h-8 shrink-0 items-center justify-center rounded-lg bg-primary-button-background px-3 text-sm font-medium text-primary-button-foreground hover:bg-primary-button-background-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
