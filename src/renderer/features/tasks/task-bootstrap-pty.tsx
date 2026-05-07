import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { PtyPane } from '@renderer/lib/pty/pty-pane';
import { PtySession } from '@renderer/lib/pty/pty-session';
import { Button } from '@renderer/lib/ui/button';
import { cssVar } from '@renderer/utils/cssVars';

/**
 * Connected PTY view for use in the production bootstrap panel.
 * Owns the PtySession lifecycle and renders only the terminal pane.
 * Kept separate from task-bootstrap-view.tsx so it can be imported
 * without pulling in Electron IPC in Storybook.
 */
export const BootstrapPtyView = observer(function BootstrapPtyView({
  sessionId,
}: {
  sessionId: string;
}) {
  const session = useMemo(() => new PtySession(sessionId), [sessionId]);

  useEffect(() => {
    void session.connect();
    return () => session.dispose();
  }, [session]);

  if (session.status !== 'ready' || !session.pty) return null;

  return (
    <PtyPane
      sessionId={sessionId}
      pty={session.pty}
      themeOverride={{ background: cssVar('--background') }}
      className="h-full w-full max-h-[300px] bg-background"
    />
  );
});

/**
 * Skip button that kills the PTY session when clicked.
 * Pass as `actions` prop to TaskBootstrapView during the setup-script step.
 */
export function PtySkipButton({ sessionId }: { sessionId: string }) {
  const [isSkipping, setIsSkipping] = useState(false);

  const handleSkip = useCallback(() => {
    setIsSkipping(true);
    void rpc.pty.kill(sessionId).catch(() => {
      setIsSkipping(false);
    });
  }, [sessionId]);

  return (
    <Button variant="ghost" size="xs" onClick={handleSkip} disabled={isSkipping}>
      Skip
    </Button>
  );
}
