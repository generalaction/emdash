import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { PtyPane } from '@renderer/lib/pty/pty-pane';
import { PtySession } from '@renderer/lib/pty/pty-session';
import { BootstrapPtyLayout } from './task-bootstrap';

/**
 * Connected PTY view for use in the production bootstrap panel.
 * Owns the PtySession lifecycle and wires rpc.pty.kill into BootstrapPtyLayout.
 * Kept separate from task-bootstrap.tsx so the pure display components
 * remain importable in Storybook without pulling in Electron IPC.
 */
export const BootstrapPtyView = observer(function BootstrapPtyView({
  sessionId,
  message,
}: {
  sessionId: string;
  message: string;
}) {
  const session = useMemo(() => new PtySession(sessionId), [sessionId]);
  const [isSkipping, setIsSkipping] = useState(false);

  useEffect(() => {
    void session.connect();
    return () => session.dispose();
  }, [session]);

  const handleSkip = useCallback(() => {
    setIsSkipping(true);
    void rpc.pty.kill(sessionId).catch(() => {
      setIsSkipping(false);
    });
  }, [sessionId]);

  return (
    <BootstrapPtyLayout message={message} isSkipping={isSkipping} onSkip={handleSkip}>
      {session.status === 'ready' && session.pty ? (
        <PtyPane sessionId={sessionId} pty={session.pty} className="h-full w-full" />
      ) : undefined}
    </BootstrapPtyLayout>
  );
});
