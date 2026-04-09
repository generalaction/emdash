import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { log } from '../../lib/logger';
import { rpc } from '../ipc';
import type { FrontendPty, SessionTheme } from './pty';
import { usePty } from './use-pty';

type Props = {
  /**
   * Deterministic PTY session ID: `makePtySessionId(projectId, taskId, conversationId|terminalId)`.
   */
  sessionId: string;
  /** Pre-connected FrontendPty owned by the entity's PtySession store. */
  pty: FrontendPty;
  className?: string;
  themeOverride?: SessionTheme['override'];
  contentFilter?: string;
  mapShiftEnterToCtrlJ?: boolean;
  /** SSH connection ID — used for remote file drag-and-drop only. */
  remoteConnectionId?: string;
  onActivity?: () => void;
  onExit?: (info: { exitCode: number | undefined; signal?: number }) => void;
  onFirstMessage?: (message: string) => void;
  onEnterPress?: () => void;
};

const TerminalPaneComponent = forwardRef<{ focus: () => void }, Props>(
  (
    {
      sessionId,
      pty,
      className,
      themeOverride,
      contentFilter,
      mapShiftEnterToCtrlJ,
      remoteConnectionId,
      onActivity,
      onExit,
      onFirstMessage,
      onEnterPress,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);

    const theme: SessionTheme = { override: themeOverride };

    const { focus } = usePty(
      {
        sessionId,
        pty,
        theme,
        mapShiftEnterToCtrlJ,
        onActivity,
        onExit,
        onFirstMessage,
        onEnterPress,
      },
      containerRef
    );

    useImperativeHandle(ref, () => ({ focus }), [focus]);

    const handleFocus = () => {
      focus();
    };

    const handleDrop: React.DragEventHandler<HTMLDivElement> = async (event) => {
      try {
        event.preventDefault();
        const dt = event.dataTransfer;
        if (!dt?.files?.length) return;

        const paths: string[] = [];
        for (const file of Array.from(dt.files)) {
          const p = (file as unknown as { path?: string }).path;
          if (p) paths.push(p);
        }
        if (paths.length === 0) return;

        if (remoteConnectionId) {
          try {
            const result = await rpc.pty.uploadFiles({ sessionId, localPaths: paths });
            if (result.success && result.data?.remotePaths) {
              const escaped = result.data.remotePaths
                .map((p: string) => `'${p.replace(/'/g, "'\\''")}'`)
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
          backgroundColor: themeOverride?.background ?? 'var(--background)',
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
