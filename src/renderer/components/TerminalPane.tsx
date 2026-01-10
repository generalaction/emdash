import React, { useEffect, useRef, useMemo } from 'react';
import { terminalSessionRegistry } from '../terminal/SessionRegistry';
import type { SessionTheme } from '../terminal/TerminalSessionManager';
import { log } from '../lib/logger';

type Props = {
  id: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  shell?: string;
  env?: Record<string, string>;
  className?: string;
  variant?: 'dark' | 'light';
  themeOverride?: any;
  contentFilter?: string;
  keepAlive?: boolean;
  autoApprove?: boolean;
  initialPrompt?: string;
  onActivity?: () => void;
  onStartError?: (message: string) => void;
  onStartSuccess?: () => void;
  onExit?: (info: { exitCode: number | undefined; signal?: number }) => void;
};

const TerminalPaneComponent: React.FC<Props> = ({
  id,
  cwd,
  cols = 120,
  rows = 32,
  shell,
  env,
  className,
  variant = 'dark',
  themeOverride,
  contentFilter,
  keepAlive = true,
  autoApprove,
  initialPrompt,
  onActivity,
  onStartError,
  onStartSuccess,
  onExit,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<ReturnType<(typeof terminalSessionRegistry)['attach']> | null>(null);
  const activityCleanupRef = useRef<(() => void) | null>(null);
  const readyCleanupRef = useRef<(() => void) | null>(null);
  const errorCleanupRef = useRef<(() => void) | null>(null);
  const exitCleanupRef = useRef<(() => void) | null>(null);

  const theme = useMemo<SessionTheme>(
    () => ({ base: variant, override: themeOverride }),
    [variant, themeOverride]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const session = terminalSessionRegistry.attach({
      taskId: id,
      container,
      cwd,
      shell,
      env,
      initialSize: { cols, rows },
      theme,
      autoApprove,
      initialPrompt,
    });
    sessionRef.current = session;

    if (onActivity) {
      activityCleanupRef.current = session.registerActivityListener(onActivity);
    }
    if (onStartSuccess) {
      readyCleanupRef.current = session.registerReadyListener(onStartSuccess);
    }
    if (onStartError) {
      errorCleanupRef.current = session.registerErrorListener(onStartError);
    }
    if (onExit) {
      exitCleanupRef.current = session.registerExitListener(onExit);
    }

    return () => {
      activityCleanupRef.current?.();
      activityCleanupRef.current = null;
      readyCleanupRef.current?.();
      readyCleanupRef.current = null;
      errorCleanupRef.current?.();
      errorCleanupRef.current = null;
      exitCleanupRef.current?.();
      exitCleanupRef.current = null;
      terminalSessionRegistry.detach(id);
    };
  }, [
    id,
    cwd,
    shell,
    env,
    cols,
    rows,
    theme,
    autoApprove,
    onActivity,
    onStartError,
    onStartSuccess,
    onExit,
  ]);

  useEffect(() => {
    return () => {
      activityCleanupRef.current?.();
      activityCleanupRef.current = null;
      readyCleanupRef.current?.();
      readyCleanupRef.current = null;
      errorCleanupRef.current?.();
      errorCleanupRef.current = null;
      exitCleanupRef.current?.();
      exitCleanupRef.current = null;
      if (!keepAlive) {
        terminalSessionRegistry.dispose(id);
      }
    };
  }, [id, keepAlive]);

  const handleFocus = () => {
    void (async () => {
      const { captureTelemetry } = await import('../lib/telemetryClient');
      captureTelemetry('terminal_entered');
    })();
    sessionRef.current?.focus();
  };

  const handleDrop: React.DragEventHandler<HTMLDivElement> = (event) => {
    try {
      event.preventDefault();
      const dt = event.dataTransfer;
      if (!dt || !dt.files || dt.files.length === 0) return;
      const paths: string[] = [];
      for (let i = 0; i < dt.files.length; i++) {
        const file = dt.files[i] as any;
        const p: string | undefined = file?.path;
        if (p) paths.push(p);
      }
      if (paths.length === 0) return;
      const escaped = paths.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(' ');
      window.electronAPI.ptyInput({ id, data: `${escaped} ` });
      sessionRef.current?.focus();
    } catch (error) {
      log.warn('Terminal drop failed', { error });
    }
  };

  return (
    <div
      className={['terminal-pane flex h-full w-full', className].filter(Boolean).join(' ')}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        backgroundColor: variant === 'light' ? '#ffffff' : themeOverride?.background || '#1f2937',
        boxSizing: 'border-box',
      }}
    >
      <div
        ref={containerRef}
        data-terminal-container
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
          filter: contentFilter || undefined,
        }}
        onClick={handleFocus}
        onMouseDown={handleFocus}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      />
    </div>
  );
};

export const TerminalPane = React.memo(TerminalPaneComponent);

export default TerminalPane;
