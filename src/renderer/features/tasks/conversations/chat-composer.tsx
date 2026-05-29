import { LoaderCircle, Paperclip, Send, Square } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { Textarea } from '@renderer/lib/ui/textarea';

interface ChatComposerProps {
  disabled: boolean;
  working: boolean;
  onSend: (text: string) => Promise<void>;
  onCancel: () => Promise<void>;
}

export function ChatComposer({ disabled, working, onSend, onCancel }: ChatComposerProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const sendInFlightRef = useRef(false);
  const cancelInFlightRef = useRef(false);
  const cancelledSendRunIdsRef = useRef(new Set<number>());
  const sendRunIdRef = useRef(0);
  const trimmedDraft = draft.trim();
  const canSend =
    !disabled &&
    !working &&
    !isSending &&
    !isCancelling &&
    !sendInFlightRef.current &&
    trimmedDraft.length > 0;
  const canCancel = !disabled && working && !isCancelling;

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
