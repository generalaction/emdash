import { Loader2, MessageSquare } from 'lucide-react';

export type ChatEmptyStateVariant = 'loading' | 'empty';

/**
 * Overlay shown inside the transcript area when there is nothing to render.
 * `loading` — the ACP session is cold-starting or replaying history.
 * `empty`   — the session is ready but no messages have been sent yet.
 */
export function ChatEmptyState({ variant }: { variant: ChatEmptyStateVariant }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
      {variant === 'loading' ? (
        <>
          <Loader2 className="size-5 animate-spin text-foreground-muted" />
          <p className="font-mono text-xs text-foreground-muted">Connecting to agent…</p>
        </>
      ) : (
        <>
          <MessageSquare className="size-7 text-foreground-muted opacity-40" />
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-sm font-medium text-foreground-secondary">Start a conversation</p>
            <p className="text-xs text-foreground-muted">
              Type a message below and press Enter or Send.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
