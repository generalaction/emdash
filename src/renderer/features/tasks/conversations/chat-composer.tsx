import { LoaderCircle, Paperclip, Send, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { Textarea } from '@renderer/lib/ui/textarea';

export interface ChatCommandSuggestion {
  name: string;
  description?: string;
  argumentHint?: string;
  execution?: 'out-of-band' | 'prompt';
}

interface ChatComposerProps {
  disabled: boolean;
  working: boolean;
  loadCommands?: () => Promise<ChatCommandSuggestion[]>;
  commandScopeKey?: string;
  onSend: (text: string) => Promise<void>;
  onCancel: () => Promise<void>;
}

export function ChatComposer({
  disabled,
  working,
  loadCommands,
  commandScopeKey,
  onSend,
  onCancel,
}: ChatComposerProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [commands, setCommands] = useState<ChatCommandSuggestion[]>([]);
  const [commandsLoaded, setCommandsLoaded] = useState(false);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const commandsLoadingRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const cancelInFlightRef = useRef(false);
  const cancelledSendRunIdsRef = useRef(new Set<number>());
  const sendRunIdRef = useRef(0);
  const trimmedDraft = draft.trim();
  const commandQuery = parseCommandQuery(draft);
  const commandQueryText = commandQuery?.query;
  const commandQueryActive = commandQueryText !== undefined;
  const canSend =
    !disabled &&
    !working &&
    !isSending &&
    !isCancelling &&
    !sendInFlightRef.current &&
    trimmedDraft.length > 0;
  const canCancel = !disabled && working && !isCancelling;
  const filteredCommands = useMemo(() => {
    if (commandQueryText === undefined) return [];
    const query = commandQueryText.toLowerCase();
    return commands.filter((command) => command.name.toLowerCase().startsWith(query));
  }, [commandQueryText, commands]);
  const showCommandMenu =
    !disabled && !working && commandQuery !== undefined && filteredCommands.length > 0;

  useEffect(() => {
    setCommands([]);
    setCommandsLoaded(false);
    commandsLoadingRef.current = false;
    setActiveCommandIndex(0);
  }, [commandScopeKey]);

  useEffect(() => {
    if (!commandQueryActive || commandsLoaded || commandsLoadingRef.current || !loadCommands) {
      return;
    }
    let cancelled = false;
    commandsLoadingRef.current = true;
    void loadCommands()
      .then((loadedCommands) => {
        if (cancelled) return;
        setCommands(loadedCommands);
        commandsLoadingRef.current = false;
        setCommandsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setCommands([]);
        commandsLoadingRef.current = false;
      });
    return () => {
      cancelled = true;
      commandsLoadingRef.current = false;
    };
  }, [commandQueryActive, commandsLoaded, loadCommands]);

  useEffect(() => {
    setActiveCommandIndex(0);
  }, [commandQueryText, filteredCommands.length]);

  const sendMessage = async () => {
    if (!canSend || sendInFlightRef.current) return;
    const sendRunId = sendRunIdRef.current + 1;
    sendRunIdRef.current = sendRunId;
    sendInFlightRef.current = true;
    setDraft('');
    setError(null);
    setIsSending(true);
    try {
      await onSend(trimmedDraft);
    } catch (sendError) {
      if (cancelledSendRunIdsRef.current.has(sendRunId) || isCancellationError(sendError)) return;
      setDraft(trimmedDraft);
      setError(sendError instanceof Error ? sendError.message : 'Message could not be sent');
    } finally {
      cancelledSendRunIdsRef.current.delete(sendRunId);
      if (sendRunIdRef.current === sendRunId) {
        sendInFlightRef.current = false;
        setIsSending(false);
      }
    }
  };

  const selectCommand = (command: ChatCommandSuggestion) => {
    setDraft(`/${command.name} `);
    setError(null);
    textareaRef.current?.focus();
  };

  const cancelTurn = async () => {
    if (!canCancel || cancelInFlightRef.current) return;
    cancelInFlightRef.current = true;
    setError(null);
    setIsCancelling(true);
    try {
      await onCancel();
      cancelledSendRunIdsRef.current.add(sendRunIdRef.current);
      sendRunIdRef.current += 1;
      sendInFlightRef.current = false;
      setIsSending(false);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Turn could not be cancelled');
    } finally {
      cancelInFlightRef.current = false;
      setIsCancelling(false);
    }
  };

  return (
    <div className="border-t border-border bg-background-secondary-1 px-4 py-3">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-border-destructive bg-background-destructive px-3 py-2 text-xs text-foreground-destructive"
          >
            {error}
          </div>
        ) : null}
        {showCommandMenu ? (
          <div
            role="listbox"
            aria-label="Slash commands"
            className="max-h-56 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-sm"
          >
            {filteredCommands.map((command, index) => (
              <button
                key={command.name}
                type="button"
                role="option"
                aria-selected={index === activeCommandIndex}
                className="flex w-full min-w-0 items-start gap-3 rounded-md px-3 py-2 text-left text-sm text-foreground outline-none hover:bg-background-1 focus-visible:bg-background-1 aria-selected:bg-background-1"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectCommand(command)}
              >
                <span className="shrink-0 font-mono text-xs text-foreground">{`/${command.name}`}</span>
                {command.description ? (
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground-muted">
                    {command.description}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <Button
            size="icon"
            variant="ghost"
            disabled
            aria-label="Attach context"
            title="Attach context"
          >
            <Paperclip className="size-4" />
          </Button>
          <Textarea
            ref={textareaRef}
            className="max-h-32 min-h-10 resize-none bg-background"
            placeholder="Message agent"
            aria-label="Message agent"
            rows={1}
            value={draft}
            disabled={disabled || isSending}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (showCommandMenu && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault();
                setActiveCommandIndex((current) => {
                  const direction = event.key === 'ArrowDown' ? 1 : -1;
                  return (current + direction + filteredCommands.length) % filteredCommands.length;
                });
                return;
              }
              if (showCommandMenu && (event.key === 'Tab' || event.key === 'Enter')) {
                event.preventDefault();
                const command = filteredCommands[activeCommandIndex];
                if (command) selectCommand(command);
                return;
              }
              if (event.key !== 'Enter' || event.shiftKey) return;
              event.preventDefault();
              void sendMessage();
            }}
          />
          {working ? (
            <Button
              size="icon"
              variant="outline"
              disabled={!canCancel}
              aria-label="Cancel turn"
              onClick={cancelTurn}
            >
              {isCancelling ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Square className="size-3.5" />
              )}
            </Button>
          ) : (
            <Button size="icon" disabled={!canSend} aria-label="Send message" onClick={sendMessage}>
              {isSending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function isCancellationError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Message send was cancelled');
}

function parseCommandQuery(draft: string): { query: string } | undefined {
  if (!draft.startsWith('/') || draft.includes('\n')) return undefined;
  const body = draft.slice(1);
  if (body.includes('/')) return undefined;
  const separator = body.search(/\s/);
  if (separator !== -1) return undefined;
  return { query: body };
}
