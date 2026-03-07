import React, { useRef, forwardRef, useImperativeHandle } from 'react';
import { useTerminal, type SessionTheme } from '../hooks/useTerminal';
import { log } from '../lib/logger';
import { rpc } from '../lib/rpc';

type Props = {
  /**
   * Deterministic PTY session ID: `makePtySessionId(projectId, taskId, conversationId|terminalId)`.
   * The renderer subscribes to this ID before calling startSession so no data is missed.
   *
   * Either `sessionId` or `id` must be provided. `id` is kept for backward compatibility
   * with callers that have not yet been migrated to compute deterministic session IDs.
   */
  sessionId?: string;
  /** @deprecated Use `sessionId` instead. Kept for backward compatibility. */
  id?: string;
  className?: string;
  variant?: 'dark' | 'light';
  themeOverride?: any;
  contentFilter?: string;
  cols?: number;
  rows?: number;
  mapShiftEnterToCtrlJ?: boolean;
  /** SSH connection ID — used for remote file drag-and-drop only. */
  remoteConnectionId?: string;
  /** @deprecated PTY session starting is now handled by the main process. */
  cwd?: string;
  /** @deprecated PTY session starting is now handled by the main process. */
  remote?: { connectionId: string };
  /** @deprecated PTY session starting is now handled by the main process. */
  providerId?: string;
  /** @deprecated PTY session starting is now handled by the main process. */
  shell?: string;
  /** @deprecated PTY session starting is now handled by the main process. */
  env?: Record<string, string>;
  /** @deprecated PTY session starting is now handled by the main process. */
  autoApprove?: boolean;
  /** @deprecated PTY session starting is now handled by the main process. */
  initialPrompt?: string;
  /** @deprecated no-op in new architecture. */
  keepAlive?: boolean;
  /** @deprecated no-op in new architecture. */
  disableSnapshots?: boolean;
  /** @deprecated no-op in new architecture. */
  onStartError?: (message: string) => void;
  /** @deprecated no-op in new architecture. */
  onStartSuccess?: () => void;
  onActivity?: () => void;
  onExit?: (info: { exitCode: number | undefined; signal?: number }) => void;
  onFirstMessage?: (message: string) => void;
};

const TerminalPaneComponent = forwardRef<{ focus: () => void }, Props>(
  (
    {
      sessionId: sessionIdProp,
      id,
      className,
      variant = 'dark',
      themeOverride,
      contentFilter,
      cols,
      rows,
      mapShiftEnterToCtrlJ,
      remoteConnectionId,
      remote,
      onActivity,
      onExit,
      onFirstMessage,
      // Deprecated props — accepted but ignored (PTY lifecycle managed by main process)
      cwd: _cwd,
      providerId: _providerId,
      shell: _shell,
      env: _env,
      autoApprove: _autoApprove,
      initialPrompt: _initialPrompt,
      keepAlive: _keepAlive,
      disableSnapshots: _disableSnapshots,
      onStartError: _onStartError,
      onStartSuccess: _onStartSuccess,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Resolve sessionId: prefer explicit sessionId, fall back to id for backward compat.
    const sessionId = sessionIdProp ?? id ?? '';
    // Resolve remoteConnectionId from either the new prop or the deprecated `remote` prop.
    const resolvedRemoteConnectionId = remoteConnectionId ?? remote?.connectionId;

    const theme: SessionTheme = { base: variant, override: themeOverride };

    const { focus } = useTerminal(
      {
        sessionId,
        theme,
        cols,
        rows,
        mapShiftEnterToCtrlJ,
        onActivity,
        onExit,
        onFirstMessage,
      },
      containerRef
    );

    useImperativeHandle(ref, () => ({ focus }), [focus]);

    const handleFocus = () => {
      void (async () => {
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('terminal_entered');
      })();
      focus();
    };

    const handleDrop: React.DragEventHandler<HTMLDivElement> = async (event) => {
      try {
        event.preventDefault();
        const dt = event.dataTransfer;
        if (!dt?.files?.length) return;

        const paths: string[] = [];
        for (let i = 0; i < dt.files.length; i++) {
          const p = (dt.files[i] as any)?.path as string | undefined;
          if (p) paths.push(p);
        }
        if (paths.length === 0) return;

        if (resolvedRemoteConnectionId) {
          try {
            const result = await rpc.pty.uploadFiles({ sessionId, localPaths: paths });
            if (result.success && result.data?.remotePaths) {
              const escaped = result.data.remotePaths
                .map((p) => `'${p.replace(/'/g, "'\\''")}'`)
                .join(' ');
              await rpc.pty.sendInput(sessionId, `${escaped} `);
            }
          } catch (error) {
            log.warn('SSH file transfer failed', { error });
          }
        } else {
          const escaped = paths.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(' ');
          await rpc.pty.sendInput(sessionId, `${escaped} `);
        }
        focus();
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
export type { SessionTheme };
export default TerminalPane;
