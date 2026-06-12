import { Send, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { useConversations } from '@renderer/features/tasks/task-view-context';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { pastePromptInjection } from '@renderer/lib/pty/prompt-injection';
import { Button } from '@renderer/lib/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { buildAnnotationPrompt } from './browser-annotation-prompt';
import type { BrowserAnnotationState } from './browser-annotation-store';

export const BrowserAnnotationBar = observer(function BrowserAnnotationBar({
  state,
  onSent,
  onClearAll,
}: {
  state: BrowserAnnotationState;
  onSent: () => void;
  onClearAll: () => void;
}) {
  const conversations = useConversations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const options = useMemo(
    () =>
      Array.from(conversations.conversations.values())
        .map((store) => ({
          id: store.data.id,
          title: store.data.title,
          lastInteractedAt: store.data.lastInteractedAt ?? '',
        }))
        .sort((a, b) => b.lastInteractedAt.localeCompare(a.lastInteractedAt)),
    [conversations.conversations]
  );

  const targetId =
    selectedId && options.some((o) => o.id === selectedId) ? selectedId : (options[0]?.id ?? null);
  const count = state.annotations.length;
  const canSend = count > 0 && targetId !== null && !isSending;

  const send = async () => {
    if (!targetId || count === 0) return;
    const session = conversations.sessions.get(targetId);
    const providerId = conversations.conversations.get(targetId)?.data.providerId;
    if (!session) return;
    setIsSending(true);
    try {
      const text = buildAnnotationPrompt(state.annotations.slice());
      await pastePromptInjection({
        providerId,
        text,
        forceBracketedPaste: true,
        sendInput: (data) => rpc.pty.sendInput(session.sessionId, data),
      });
      await rpc.pty.sendInput(session.sessionId, '\r');
      conversations.conversations.get(targetId)?.setWorking();
      onSent();
    } catch (error) {
      toast({
        title: 'Failed to send annotations to agent',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  if (count === 0) return null;

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-t border-border bg-background-secondary-1 px-2">
      <span className="text-sm text-foreground-muted">
        {count} {count === 1 ? 'annotation' : 'annotations'}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-foreground-muted"
        onClick={onClearAll}
      >
        <X className="size-3.5" />
        Clear
      </Button>
      <div className="flex-1" />
      <Select value={targetId ?? undefined} onValueChange={(next) => setSelectedId(next)}>
        <SelectTrigger size="sm" className="max-w-56" aria-label="Agent conversation">
          <SelectValue placeholder="Select conversation" />
        </SelectTrigger>
        <SelectContent className="min-w-max">
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" size="sm" className="gap-1.5" disabled={!canSend} onClick={send}>
        <Send className="size-3.5" />
        Send to agent
      </Button>
    </div>
  );
});
