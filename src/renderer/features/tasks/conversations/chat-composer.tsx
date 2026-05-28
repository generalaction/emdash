import { Paperclip, Send, Square } from 'lucide-react';
import { useState } from 'react';
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
  const trimmedDraft = draft.trim();
  const canSend = !disabled && !working && trimmedDraft.length > 0;

  const sendMessage = async () => {
    if (!canSend) return;
    setDraft('');
    try {
      await onSend(trimmedDraft);
    } catch {
      setDraft(trimmedDraft);
    }
  };

  return (
    <div className="border-t border-border bg-background-secondary-1 px-4 py-3">
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
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
          placeholder="Message"
          rows={1}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            void sendMessage();
          }}
        />
        {working ? (
          <Button
            size="icon"
            variant="outline"
            disabled={disabled}
            aria-label="Cancel turn"
            onClick={onCancel}
          >
            <Square className="size-3.5" />
          </Button>
        ) : (
          <Button size="icon" disabled={!canSend} aria-label="Send message" onClick={sendMessage}>
            <Send className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
