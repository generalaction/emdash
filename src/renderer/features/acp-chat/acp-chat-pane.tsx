import { Check, Send, Square, Wrench, X } from 'lucide-react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { events, rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import type { AcpPermissionRequest } from '@shared/acp';
import { acpSessionEventChannel } from '@shared/events/acpEvents';
import {
  acpChatReducer,
  createInitialAcpChatState,
  type AcpChatTimelineItem,
} from './acp-chat-reducer';

export function AcpChatPane({ conversationId }: { conversationId: string }) {
  const [state, dispatch] = useReducer(acpChatReducer, undefined, createInitialAcpChatState);
  const [draft, setDraft] = useState('');
  const scrollerRef = useRef<HTMLDivElement>(null);
  const running = state.status === 'running' || state.status === 'starting';

  useEffect(() => {
    return events.on(acpSessionEventChannel, (event) => {
      if (event.conversationId !== conversationId) return;
      dispatch({ type: 'event', event });
    });
  }, [conversationId]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [state.items.length, state.status]);

  async function submit(): Promise<void> {
    const text = draft.trim();
    if (!text || running) return;
    setDraft('');
    dispatch({ type: 'user_submitted', text });
    try {
      await rpc.acp.sendPrompt(conversationId, text);
    } catch (error) {
      dispatch({
        type: 'local_error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function cancel(): Promise<void> {
    try {
      await rpc.acp.cancel(conversationId);
    } catch (error) {
      dispatch({
        type: 'local_error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {state.items.length === 0 ? (
            <div className="py-10 text-center text-sm text-foreground-passive">
              {state.status === 'starting' ? 'Starting ACP session...' : 'No messages yet'}
            </div>
          ) : (
            state.items.map((item) => (
              <TimelineItem
                key={item.id}
                item={item}
                conversationId={conversationId}
                dispatch={dispatch}
              />
            ))
          )}
        </div>
      </div>
      <div className="border-t border-border/60 bg-background px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            disabled={running}
            placeholder={running ? 'ACP turn is running...' : 'Message agent'}
            className="max-h-40 min-h-10 resize-none"
          />
          {running ? (
            <Button
              type="button"
              variant="outline"
              size="icon-md"
              onClick={() => void cancel()}
              aria-label="Cancel ACP turn"
            >
              <Square className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon-md"
              onClick={() => void submit()}
              disabled={!draft.trim()}
              aria-label="Send ACP prompt"
            >
              <Send className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineItem({
  item,
  conversationId,
  dispatch,
}: {
  item: AcpChatTimelineItem;
  conversationId: string;
  dispatch: React.Dispatch<Parameters<typeof acpChatReducer>[1]>;
}) {
  if (item.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-md bg-background-2 px-3 py-2 text-sm whitespace-pre-wrap text-foreground">
          {item.text}
        </div>
      </div>
    );
  }
  if (item.kind === 'assistant') {
    return (
      <div className="max-w-none text-sm text-foreground">
        <MarkdownRenderer content={item.text} variant="compact" className="space-y-2" />
      </div>
    );
  }
  if (item.kind === 'plan') {
    return (
      <div className="rounded-md border border-border/60 px-3 py-2 text-sm">
        <div className="mb-1 text-xs font-medium text-foreground-muted">Plan</div>
        <ul className="space-y-1">
          {item.entries.map((entry, index) => (
            <li key={`${entry}-${index}`} className="flex gap-2">
              <span className="text-foreground-passive">{index + 1}.</span>
              <span>{entry}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (item.kind === 'tool') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm">
        <Wrench className="size-3.5 text-foreground-muted" />
        <span className="min-w-0 flex-1 truncate">{item.title}</span>
        <span className="rounded-sm bg-background-2 px-1.5 py-0.5 text-xs text-foreground-muted">
          {item.status}
        </span>
      </div>
    );
  }
  if (item.kind === 'permission') {
    return (
      <PermissionRow
        request={item.request}
        conversationId={conversationId}
        onError={(message) => dispatch({ type: 'local_error', message })}
      />
    );
  }
  return (
    <div className="rounded-md border border-border-destructive bg-background-destructive px-3 py-2 text-sm text-foreground-destructive">
      {item.message}
    </div>
  );
}

function PermissionRow({
  request,
  conversationId,
  onError,
}: {
  request: AcpPermissionRequest;
  conversationId: string;
  onError: (message: string) => void;
}) {
  const [busyOption, setBusyOption] = useState<string | null>(null);

  async function choose(optionId: string): Promise<void> {
    setBusyOption(optionId);
    try {
      await rpc.acp.respondPermission(conversationId, request.requestId, optionId);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
      setBusyOption(null);
    }
  }

  return (
    <div className="rounded-md border border-border-warning bg-background-warning px-3 py-2 text-sm">
      <div className="flex items-start gap-2">
        <Wrench className="mt-0.5 size-3.5 shrink-0 text-foreground-warning" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground-warning">
            {request.title ?? 'Permission requested'}
          </div>
          <div className="mt-1 max-h-20 overflow-hidden font-mono text-xs break-words whitespace-pre-wrap text-foreground-muted">
            {request.details}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {request.options.map((option) => {
          const allow = option.kind.startsWith('allow');
          return (
            <Button
              key={option.optionId}
              type="button"
              variant={allow ? 'default' : 'outline'}
              size="xs"
              disabled={busyOption !== null}
              onClick={() => void choose(option.optionId)}
              className={cn(!allow && 'text-foreground-muted')}
            >
              {allow ? <Check className="size-3" /> : <X className="size-3" />}
              {busyOption === option.optionId ? 'Sending...' : option.name}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
