import { Loader2 } from 'lucide-react';
import { useObserver } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { events, rpc } from '@renderer/lib/ipc';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { PtyPane } from '@renderer/lib/pty/pty-pane';
import { PtySession } from '@renderer/lib/pty/pty-session';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { agentAuthStatusChangedChannel } from '@shared/core/agents/agentEvents';

export type AgentSignInModalArgs = {
  providerId: string;
  methodId: string;
  providerName: string;
};

type AgentSignInModalProps = BaseModalProps<void> & AgentSignInModalArgs;

export function AgentSignInModal({
  providerId,
  methodId,
  providerName,
  onSuccess,
  onClose,
}: AgentSignInModalProps) {
  const [error, setError] = useState<string | null>(null);
  const sessionId = `agent-auth:${providerId}`;
  const paneRef = useRef<{ focus: () => void } | null>(null);

  const prepare = useCallback(async () => {
    try {
      setError(null);
      const result = await rpc.agents.startCliLogin(providerId, methodId);
      if (result.sessionId !== sessionId) {
        throw new Error(`Unexpected sign-in terminal id: ${result.sessionId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [methodId, providerId, sessionId]);

  const session = useMemo(
    () => new PtySession(sessionId, prepare, undefined, undefined, { clearOnBackendStart: true }),
    [prepare, sessionId]
  );

  useEffect(() => () => session.destroy(), [session]);

  useEffect(
    () =>
      events.on(agentAuthStatusChangedChannel, (event) => {
        if (event.providerId !== providerId || event.status.kind !== 'authenticated') return;
        onSuccess();
      }),
    [onSuccess, providerId]
  );

  const content = useObserver(() => {
    const status = session.status;
    if (error) {
      return <div className="text-destructive p-4 text-sm">{error}</div>;
    }
    if (!session.pty) {
      return (
        <div className="flex h-full items-center justify-center gap-2 text-sm text-foreground-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {status === 'connecting'
            ? 'Connecting sign-in terminal...'
            : 'Starting sign-in terminal...'}
        </div>
      );
    }
    return (
      <PtyPane
        // Focus the terminal as soon as it mounts so TUI keyboard navigation
        // (arrows etc.) works without requiring a click first.
        ref={(handle) => {
          if (handle && paneRef.current !== handle) {
            paneRef.current = handle;
            handle.focus();
          }
        }}
        sessionId={sessionId}
        pty={session.pty}
        workspaceId="agent-auth"
        className="h-full rounded-md border border-border"
      />
    );
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Sign in to {providerName}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="h-[520px] p-0">{content}</DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}
