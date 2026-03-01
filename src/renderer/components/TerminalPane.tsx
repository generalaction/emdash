import React, { useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import { terminalSessionRegistry } from '../terminal/SessionRegistry';
import type { SessionTheme } from '../terminal/TerminalSessionManager';
import { log } from '../lib/logger';

type Props = {
  id: string;
  cwd?: string;
  remote?: {
    connectionId: string;
  };
  providerId?: string; // If set, uses direct CLI spawn (no shell)
  shell?: string; // Used for shell-based spawn when providerId not set
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  className?: string;
  variant?: 'dark' | 'light';
  themeOverride?: any;
  contentFilter?: string;
  keepAlive?: boolean;
  autoApprove?: boolean;
  initialPrompt?: string;
  mapShiftEnterToCtrlJ?: boolean;
  disableSnapshots?: boolean; // If true, don't save/restore terminal snapshots (for non-main chats)
  onActivity?: () => void;
  onStartError?: (message: string) => void;
  onStartSuccess?: () => void;
  onExit?: (info: { exitCode: number | undefined; signal?: number }) => void;
  onFirstMessage?: (message: string) => void;
};

const TerminalPaneComponent = forwardRef<{ focus: () => void }, Props>(
  (
    {
      id,
      cwd,
      remote,
      providerId,
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
      mapShiftEnterToCtrlJ,
      disableSnapshots = false,
      onActivity,
      onStartError,
      onStartSuccess,
      onExit,
      onFirstMessage,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const sessionRef = useRef<ReturnType<(typeof terminalSessionRegistry)['attach']> | null>(null);
    const activityCleanupRef = useRef<(() => void) | null>(null);
    const readyCleanupRef = useRef<(() => void) | null>(null);
    const errorCleanupRef = useRef<(() => void) | null>(null);
    const exitCleanupRef = useRef<(() => void) | null>(null);

    const cwdRef = useRef(cwd);
    cwdRef.current = cwd;
    const remoteRef = useRef(remote);
    remoteRef.current = remote;
    const providerIdRef = useRef(providerId);
    providerIdRef.current = providerId;
    const shellRef = useRef(shell);
    shellRef.current = shell;
    const colsRef = useRef(cols);
    colsRef.current = cols;
    const rowsRef = useRef(rows);
    rowsRef.current = rows;
    const envRef = useRef(env);
    envRef.current = env;
    const autoApproveRef = useRef(autoApprove);
    autoApproveRef.current = autoApprove;
    const initialPromptRef = useRef(initialPrompt);
    initialPromptRef.current = initialPrompt;
    const mapShiftEnterToCtrlJRef = useRef(mapShiftEnterToCtrlJ);
    mapShiftEnterToCtrlJRef.current = mapShiftEnterToCtrlJ;
    const disableSnapshotsRef = useRef(disableSnapshots);
    disableSnapshotsRef.current = disableSnapshots;
    const onActivityRef = useRef(onActivity);
    onActivityRef.current = onActivity;
    const onStartErrorRef = useRef(onStartError);
    onStartErrorRef.current = onStartError;
    const onStartSuccessRef = useRef(onStartSuccess);
    onStartSuccessRef.current = onStartSuccess;
    const onExitRef = useRef(onExit);
    onExitRef.current = onExit;
    const onFirstMessageRef = useRef(onFirstMessage);
    onFirstMessageRef.current = onFirstMessage;

    const theme = useMemo<SessionTheme>(
      () => ({ base: variant, override: themeOverride }),
      [variant, themeOverride]
    );
    const themeRef = useRef(theme);
    themeRef.current = theme;

    // Expose focus method via ref
    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          sessionRef.current?.focus();
        },
      }),
      []
    );

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const handleLinkClick = (url: string) => {
        if (!url || !window.electronAPI?.openExternal) return;
        window.electronAPI.openExternal(url).catch((error) => {
          log.warn('failed to open external link', { url, error });
        });
      };

      const session = terminalSessionRegistry.attach({
        taskId: id,
        container,
        cwd: cwdRef.current,
        remote: remoteRef.current,
        providerId: providerIdRef.current,
        shell: shellRef.current,
        env: envRef.current,
        initialSize: { cols: colsRef.current, rows: rowsRef.current },
        theme: themeRef.current,
        autoApprove: autoApproveRef.current,
        initialPrompt: initialPromptRef.current,
        mapShiftEnterToCtrlJ: mapShiftEnterToCtrlJRef.current,
        disableSnapshots: disableSnapshotsRef.current,
        onLinkClick: handleLinkClick,
        onFirstMessage: onFirstMessageRef.current,
      });
      sessionRef.current = session;

      if (onActivityRef.current) {
        activityCleanupRef.current = session.registerActivityListener((...args: []) =>
          onActivityRef.current?.(...args)
        );
      }

      if (onStartSuccessRef.current) {
        readyCleanupRef.current = session.registerReadyListener((...args: []) =>
          onStartSuccessRef.current?.(...args)
        );
      }
      if (onStartErrorRef.current) {
        errorCleanupRef.current = session.registerErrorListener((msg: string) =>
          onStartErrorRef.current?.(msg)
        );
      }
      if (onExitRef.current) {
        exitCleanupRef.current = session.registerExitListener(
          (info: { exitCode: number | undefined; signal?: number }) => onExitRef.current?.(info)
        );
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
    }, [id]);

    useEffect(() => {
      if (sessionRef.current) {
        sessionRef.current.setTheme(theme);
      }
    }, [theme]);

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
      // Focus the terminal session
      sessionRef.current?.focus();
    };

    const handleDrop: React.DragEventHandler<HTMLDivElement> = async (event) => {
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

        if (remoteRef.current?.connectionId) {
          // SSH terminal: transfer files to remote first via scp
          try {
            const result = await window.electronAPI.ptyScpToRemote({
              connectionId: remoteRef.current.connectionId,
              localPaths: paths,
            });
            if (result.success && result.remotePaths) {
              const escaped = result.remotePaths
                .map((p) => `'${p.replace(/'/g, "'\\''")}'`)
                .join(' ');
              window.electronAPI.ptyInput({ id, data: `${escaped} ` });
            }
          } catch (error) {
            log.warn('SSH file transfer failed', { error });
          }
        } else {
          // Local terminal: send local path directly
          const escaped = paths.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(' ');
          window.electronAPI.ptyInput({ id, data: `${escaped} ` });
        }
        sessionRef.current?.focus();
      } catch (error) {
        log.warn('Terminal drop failed', { error });
      }
    };

    return (
      <div
        className={['terminal-pane flex h-full w-full min-w-0', className]
          .filter(Boolean)
          .join(' ')}
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
  }
);

TerminalPaneComponent.displayName = 'TerminalPane';

export const TerminalPane = React.memo(TerminalPaneComponent);

export default TerminalPane;
