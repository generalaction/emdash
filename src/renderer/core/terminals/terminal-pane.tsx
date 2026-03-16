import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { log } from '../../lib/logger';
import { rpc } from '../ipc';
import { useTerminal, type SessionTheme } from './use-terminals';

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
  mapShiftEnterToCtrlJ?: boolean;
  /** SSH connection ID — used for remote file drag-and-drop only. */
  remoteConnectionId?: string;
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
      variant: _variant = 'dark',
      themeOverride,
      contentFilter,
      mapShiftEnterToCtrlJ,
      remoteConnectionId,
      onActivity,
      onExit,
      onFirstMessage,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Resolve sessionId: prefer explicit sessionId, fall back to id for backward compat.
    const sessionId = sessionIdProp ?? id ?? '';
    // Resolve remoteConnectionId from either the new prop or the deprecated `remote` prop.
    const resolvedRemoteConnectionId = remoteConnectionId ?? undefined;

    const theme: SessionTheme = { override: themeOverride };

    const { focus } = useTerminal(
      {
        sessionId,
        theme,
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
        const { captureTelemetry } = await import('../../lib/telemetryClient');
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
          backgroundColor: themeOverride?.background ?? 'var(--xterm-bg)',
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
