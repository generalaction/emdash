import { Bot, Command, LoaderCircle, Paperclip, Send, Square, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@renderer/lib/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Textarea } from '@renderer/lib/ui/textarea';
import { Toggle } from '@renderer/lib/ui/toggle';
import { cn } from '@renderer/utils/utils';
import type { ConversationControls } from '@shared/conversation-controls';

export interface ChatCommandSuggestion {
  name: string;
  aliases?: string[];
  description?: string;
  argumentHint?: string;
  execution?: 'client' | 'out-of-band' | 'prompt';
}

interface ChatComposerProps {
  disabled: boolean;
  working: boolean;
  clientCommands?: ChatCommandSuggestion[];
  loadControls?: () => Promise<ConversationControls>;
  loadCommands?: () => Promise<ChatCommandSuggestion[]>;
  commandScopeKey?: string;
  onClientCommand?: (command: ChatCommandSuggestion) => Promise<void>;
  onFeatureChange?: (featureId: string, value: unknown) => Promise<ConversationControls>;
  onModelChange?: (modelId: string) => Promise<ConversationControls>;
  onSend: (text: string) => Promise<void>;
  onCancel: () => Promise<void>;
}

export function ChatComposer({
  disabled,
  working,
  clientCommands = [],
  loadControls,
  loadCommands,
  commandScopeKey,
  onClientCommand,
  onFeatureChange,
  onModelChange,
  onSend,
  onCancel,
}: ChatComposerProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [commands, setCommands] = useState<ChatCommandSuggestion[]>([]);
  const [commandsLoaded, setCommandsLoaded] = useState(false);
  const [controls, setControls] = useState<ConversationControls>({ models: [], features: [] });
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const commandsLoadingRef = useRef(false);
  const controlsLoadingRef = useRef(false);
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
  const selectedModelId =
    controls.selectedModelId ?? controls.models.find((model) => model.isDefault)?.id;
  const fastFeature = controls.features.find((feature) => feature.id === 'fast_mode');
  const filteredCommands = useMemo(() => {
    if (commandQueryText === undefined) return [];
    const query = commandQueryText.toLowerCase();
    return mergeCommands(clientCommands, commands).filter((command) =>
      commandMatches(command, query)
    );
  }, [clientCommands, commandQueryText, commands]);
  const showCommandMenu =
    !disabled && !working && commandQuery !== undefined && filteredCommands.length > 0;

  useEffect(() => {
    setCommands([]);
    setCommandsLoaded(false);
    setControls({ models: [], features: [] });
    commandsLoadingRef.current = false;
    controlsLoadingRef.current = false;
    setActiveCommandIndex(0);
  }, [commandScopeKey]);

  useEffect(() => {
    if (!loadControls || disabled || controlsLoadingRef.current) return;
    let cancelled = false;
    controlsLoadingRef.current = true;
    void loadControls()
      .then((loadedControls) => {
        if (cancelled) return;
        setControls(loadedControls);
      })
      .catch(() => {
        if (cancelled) return;
        setControls({ models: [], features: [] });
      })
      .finally(() => {
        if (!cancelled) controlsLoadingRef.current = false;
      });
    return () => {
      cancelled = true;
      controlsLoadingRef.current = false;
    };
  }, [commandScopeKey, disabled, loadControls]);

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
    const clientCommand = resolveClientCommand(trimmedDraft, clientCommands);
    const sendRunId = sendRunIdRef.current + 1;
    sendRunIdRef.current = sendRunId;
    sendInFlightRef.current = true;
    setDraft('');
    setError(null);
    setIsSending(true);
    try {
      if (clientCommand && onClientCommand) {
        await onClientCommand(clientCommand);
      } else {
        await onSend(trimmedDraft);
      }
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

  const selectCommand = async (command: ChatCommandSuggestion) => {
    if (command.execution === 'client' && onClientCommand) {
      setDraft('');
      setError(null);
      try {
        await onClientCommand(command);
      } catch (commandError) {
        setError(commandError instanceof Error ? commandError.message : 'Command could not run');
      }
      return;
    }
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

  const selectModel = async (modelId: string | null) => {
    if (!modelId || !onModelChange) return;
    setError(null);
    try {
      setControls(await onModelChange(modelId));
    } catch (modelError) {
      setError(modelError instanceof Error ? modelError.message : 'Model could not be changed');
    } finally {
      textareaRef.current?.focus();
    }
  };

  const toggleFastMode = async (pressed: boolean) => {
    if (!fastFeature || !onFeatureChange) return;
    setError(null);
    try {
      setControls(await onFeatureChange(fastFeature.id, pressed));
    } catch (featureError) {
      setError(
        featureError instanceof Error ? featureError.message : 'Feature could not be changed'
      );
    } finally {
      textareaRef.current?.focus();
    }
  };

  return (
    <div className="bg-background px-4 pt-2 pb-4">
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
            className="mb-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-background p-1 shadow-lg"
          >
            {filteredCommands.map((command, index) => (
              <button
                key={command.name}
                type="button"
                role="option"
                aria-selected={index === activeCommandIndex}
                className="flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-foreground outline-none hover:bg-background-1 focus-visible:bg-background-1 aria-selected:bg-background-1"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void selectCommand(command)}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background-2 text-foreground-muted">
                  <Command className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 font-mono text-xs text-foreground">{`/${command.name}`}</span>
                    {command.argumentHint ? (
                      <span className="truncate font-mono text-[11px] text-foreground-passive">
                        {command.argumentHint}
                      </span>
                    ) : null}
                  </span>
                  {command.description ? (
                    <span className="block truncate text-xs text-foreground-muted">
                      {command.description}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div
          className={cn(
            'flex flex-col gap-3 rounded-2xl border border-border bg-background-secondary-1 px-3 py-3 shadow-sm transition-colors focus-within:border-border-primary focus-within:ring-2 focus-within:ring-primary/20',
            disabled && 'opacity-70'
          )}
        >
          <Textarea
            ref={textareaRef}
            className="max-h-40 min-h-14 resize-none border-0 bg-transparent px-1 py-0 shadow-none hover:border-0 focus-visible:border-0 focus-visible:ring-0"
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
                if (command) void selectCommand(command);
                return;
              }
              if (event.key !== 'Enter' || event.shiftKey) return;
              event.preventDefault();
              void sendMessage();
            }}
          />
          <div className="flex items-end justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                disabled
                aria-label="Attach context"
                title="Attach context"
              >
                <Paperclip className="size-4" />
              </Button>
              {controls.models.length > 0 && selectedModelId ? (
                <Select value={selectedModelId} onValueChange={selectModel}>
                  <SelectTrigger
                    size="sm"
                    aria-label="Select model"
                    className="max-w-48 border-transparent bg-transparent px-2 text-xs hover:bg-background-1"
                  >
                    <Bot className="size-3.5 text-foreground-muted" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent side="top" align="start" alignItemWithTrigger={false}>
                    {controls.models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        <span className="truncate">{model.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {fastFeature ? (
                <Toggle
                  size="sm"
                  variant="default"
                  pressed={fastFeature.value}
                  disabled={disabled || working}
                  aria-label="Toggle fast mode"
                  title={fastFeature.description ?? fastFeature.label}
                  onPressedChange={toggleFastMode}
                  className="border-transparent px-2"
                >
                  <Zap className="size-3.5" />
                  {fastFeature.label}
                </Toggle>
              ) : null}
            </div>
            {working ? (
              <Button
                size="icon-sm"
                variant="destructive"
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
              <Button
                size="icon-sm"
                disabled={!canSend}
                aria-label="Send message"
                onClick={sendMessage}
                className="rounded-full"
              >
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

function mergeCommands(
  clientCommands: ChatCommandSuggestion[],
  providerCommands: ChatCommandSuggestion[]
): ChatCommandSuggestion[] {
  const byName = new Map<string, ChatCommandSuggestion>();
  for (const command of [...clientCommands, ...providerCommands]) {
    if (!byName.has(command.name)) {
      byName.set(command.name, command);
    }
  }
  return Array.from(byName.values());
}

function commandMatches(command: ChatCommandSuggestion, query: string): boolean {
  if (!query) return true;
  if (command.name.toLowerCase().startsWith(query)) return true;
  return command.aliases?.some((alias) => alias.toLowerCase().startsWith(query)) ?? false;
}

function resolveClientCommand(
  draft: string,
  clientCommands: ChatCommandSuggestion[]
): ChatCommandSuggestion | undefined {
  const trimmed = draft.trim();
  if (!trimmed.startsWith('/') || /\s/.test(trimmed.slice(1))) return undefined;
  const name = trimmed.slice(1).toLowerCase();
  return clientCommands.find(
    (command) =>
      command.name.toLowerCase() === name ||
      command.aliases?.some((alias) => alias.toLowerCase() === name)
  );
}
