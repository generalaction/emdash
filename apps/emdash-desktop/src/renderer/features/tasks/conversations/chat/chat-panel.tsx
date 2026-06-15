import { Brain, Loader2, Square, Wrench } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef } from 'react';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { cn } from '@renderer/utils/utils';
import { useTaskViewContext } from '../../task-view-context';
import { ChatStore } from './chat-store';
import type { ChatMessage, ToolStatus } from './chat-store';

function MessageBubble({ message }: { message: ChatMessage }) {
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
          isUser ? 'bg-accent-primary text-white' : 'bg-background-secondary text-foreground'
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

function ToolStatusLine({ tool }: { tool: ToolStatus }) {
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
  const { projectId, taskId } = useTaskViewContext();
  const store = useMemo(
    () => new ChatStore(conversationId, projectId, taskId),
    [conversationId, projectId, taskId]
  );

  useEffect(() => {
    return () => store.dispose();
  }, [store]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const lastMessageText = store.messages.at(-1)?.text;

  // Scroll to bottom when messages change
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [store.messages.length, lastMessageText]);

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
        {store.messages.length === 0 && !store.isWorking ? (
          <div className="flex h-full items-center justify-center text-sm text-foreground-secondary">
            Start a conversation
          </div>
        ) : (
          <div className="space-y-3 px-4 py-4">
            {store.messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {store.toolStatuses.map((tool) => (
              <ToolStatusLine key={tool.toolCallId} tool={tool} />
            ))}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-border bg-background p-3">
        <div className="flex items-end gap-2 rounded-xl border border-border bg-background-secondary p-2">
          <textarea
            className="min-h-[36px] flex-1 resize-none bg-transparent text-sm text-foreground placeholder-foreground-secondary outline-none"
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
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500 text-white hover:bg-red-600"
              aria-label="Stop"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => store.sendPrompt()}
              disabled={!store.input.trim() || store.isClosed}
              className="bg-accent-primary hover:bg-accent-primary/90 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Send"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="size-4"
              >
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
