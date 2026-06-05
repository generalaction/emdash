import {
  AlertCircle,
  Bot,
  Check,
  Circle,
  LoaderCircle,
  Send,
  Square,
  User,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { events, rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import type { AcpPermissionRequest, AcpSessionEvent } from '@shared/acp';
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
  const replayReadyRef = useRef(false);
  const bufferedEventsRef = useRef<AcpSessionEvent[]>([]);
  const running = state.status === 'running' || state.status === 'starting';

  useEffect(() => {
    let cancelled = false;
    replayReadyRef.current = false;
    bufferedEventsRef.current = [];

    const unsubscribe = events.on(acpSessionEventChannel, (event) => {
      if (event.conversationId !== conversationId) return;
      if (!replayReadyRef.current) {
        bufferedEventsRef.current.push(event);
        return;
      }
      dispatch({ type: 'event', event });
    });

    void rpc.acp
      .getEvents(conversationId)
      .then((replay) => {
        if (!cancelled) {
          const replaySequences = new Set(
            replay.events.flatMap((event) =>
              typeof event.sequence === 'number' ? [event.sequence] : []
            )
          );
          const bufferedEvents = bufferedEventsRef.current.filter(
            (event) => typeof event.sequence !== 'number' || !replaySequences.has(event.sequence)
          );
          dispatch({
            type: 'replay',
            events: [...replay.events, ...bufferedEvents],
          });
          bufferedEventsRef.current = [];
          replayReadyRef.current = true;
        }
      })
      .catch((error) => {
        if (!cancelled) {
          dispatch({
            type: 'local_error',
            message: error instanceof Error ? error.message : String(error),
          });
          for (const event of bufferedEventsRef.current) {
            dispatch({ type: 'event', event });
          }
          bufferedEventsRef.current = [];
          replayReadyRef.current = true;
        }
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
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
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-background-quaternary px-3">
        <div className="flex min-w-0 items-center gap-2 text-xs text-foreground-muted">
          <StatusIcon status={state.status} />
          <span className="font-mono uppercase">ACP Chat</span>
          <span className="text-foreground-passive">/</span>
          <span className="capitalize">{state.status}</span>
        </div>
        {state.acpSessionId ? (
          <span className="max-w-40 truncate font-mono text-[11px] text-foreground-passive">
            {state.acpSessionId}
          </span>
        ) : null}
      </div>

      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col">
          {state.items.length === 0 ? (
            <div className="flex min-h-40 flex-1 items-center justify-center px-6 text-sm text-foreground-passive">
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
      <div className="shrink-0 border-t border-border bg-background-quaternary p-2">
        <div className="flex items-end gap-2 rounded-md border border-border bg-background px-2 py-2">
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
            className="max-h-36 min-h-9 resize-none rounded-none border-0 bg-transparent px-1 py-1 focus-visible:border-0 focus-visible:ring-0"
          />
          {running ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => void cancel()}
              aria-label="Cancel ACP turn"
            >
              <Square className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon-xs"
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

function StatusIcon({ status }: { status: string }) {
  if (status === 'running' || status === 'starting') {
    return <LoaderCircle className="size-3.5 animate-spin text-foreground-muted" />;
  }
  if (status === 'error' || status === 'exited') {
    return <AlertCircle className="size-3.5 text-foreground-destructive" />;
  }
  return <Circle className="size-3 fill-current text-foreground-muted" />;
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
      <div className="flex gap-3 border-b border-border/60 px-3 py-3">
        <TimelineIcon>
          <User className="size-3.5" />
        </TimelineIcon>
        <div className="min-w-0 flex-1 text-sm whitespace-pre-wrap text-foreground">
          {item.text}
        </div>
      </div>
    );
  }
  if (item.kind === 'assistant') {
    return (
      <div className="flex gap-3 border-b border-border/60 px-3 py-3">
        <TimelineIcon>
          <Bot className="size-3.5" />
        </TimelineIcon>
        <div className="min-w-0 flex-1 text-sm text-foreground">
          <MarkdownRenderer content={item.text} variant="compact" className="space-y-2" />
        </div>
      </div>
    );
  }
  if (item.kind === 'plan') {
    return (
      <div className="flex gap-3 border-b border-border/60 px-3 py-3">
        <TimelineIcon>
          <Check className="size-3.5" />
        </TimelineIcon>
        <div className="min-w-0 flex-1 rounded-md border border-border bg-background-quaternary p-2 text-sm">
          <div className="mb-1 font-mono text-[11px] text-foreground-muted uppercase">Plan</div>
          <ul className="space-y-1">
            {item.entries.map((entry, index) => (
              <li key={`${entry}-${index}`} className="flex gap-2">
                <span className="font-mono text-foreground-passive">{index + 1}.</span>
                <span>{entry}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  if (item.kind === 'tool') {
    return (
      <div className="flex gap-3 border-b border-border/60 px-3 py-2">
        <TimelineIcon>
          <Wrench className="size-3.5" />
        </TimelineIcon>
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-foreground-muted">{item.title}</span>
          <span className="rounded-sm border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground-passive">
            {item.status}
          </span>
        </div>
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
    <div className="flex gap-3 border-b border-border/60 px-3 py-3">
      <TimelineIcon destructive>
        <AlertCircle className="size-3.5" />
      </TimelineIcon>
      <div className="min-w-0 flex-1 rounded-md border border-border-destructive bg-background-destructive px-3 py-2 text-sm text-foreground-destructive">
        {item.message}
      </div>
    </div>
  );
}

function TimelineIcon({
  children,
  destructive = false,
}: {
  children: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <div
      className={cn(
        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border bg-background text-foreground-muted',
        destructive
          ? 'border-border-destructive text-foreground-destructive'
          : 'border-border text-foreground-muted'
      )}
    >
      {children}
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
    <div className="flex gap-3 border-b border-border/60 px-3 py-3">
      <TimelineIcon>
        <Wrench className="size-3.5" />
      </TimelineIcon>
      <div className="min-w-0 flex-1 rounded-md border border-border-warning bg-background-warning px-3 py-2 text-sm">
        <div className="flex items-start gap-2">
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
    </div>
  );
}
