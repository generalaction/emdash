import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import type { FrontendPty, SessionTheme } from './pty';
import { usePty } from './use-pty';

type Props = {
  /**
   * Deterministic PTY session ID: `makePtySessionId(projectId, scopeId, leafId)`.
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
  onEnterPress?: (message: string) => void;
  onInterruptPress?: () => void;
};

const PtyPaneComponent = forwardRef<{ focus: () => void }, Props>(
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
      onInterruptPress,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);

    const theme: SessionTheme = { override: themeOverride };

    const { focus, sendInput } = usePty(
      {
        sessionId,
        pty,
        theme,
        mapShiftEnterToCtrlJ,
        onActivity,
        onExit,
        onFirstMessage,
        onEnterPress,
        onInterruptPress,
      },
      containerRef
    );

    useImperativeHandle(ref, () => ({ focus }), [focus]);

    const handleFocus = () => {
      focus();
    };

    const handleDrop: React.DragEventHandler<HTMLDivElement> = (event) => {
      event.preventDefault();
      const dt = event.dataTransfer;
      if (!dt?.files?.length) return;
      const files = Array.from(dt.files);

      const quoteShellArg = (arg: string) => `'${arg.replace(/'/g, "'\\''")}'`;

      void (async () => {
        try {
          if (remoteConnectionId) {
            const paths = (
              await Promise.all(
                files.map(async (file) => {
                  const buffer = await file.arrayBuffer();
                  return rpc.app.saveRendererFile({
                    name: file.name,
                    data: new Uint8Array(buffer),
                  });
                })
              )
            ).filter(Boolean);
            if (paths.length === 0) return;

            try {
              const result = await rpc.pty.uploadFiles({ sessionId, localPaths: paths });
              if (result.success && result.data?.remotePaths) {
                const escaped = result.data.remotePaths
                  .map((p: string) => quoteShellArg(p))
                  .join(' ');
                sendInput(`${escaped} `);
              }
            } catch (error) {
              log.warn('SSH file transfer failed', { error });
            }
          } else {
            const paths = files
              .map((file) => window.electronAPI.getPathForFile(file).trim())
              .filter(Boolean);
            if (paths.length === 0) return;

            const escaped = paths.map((p) => quoteShellArg(p)).join(' ');
            sendInput(`${escaped} `);
          }
          focus();
        } catch (error) {
          log.warn('Terminal drop failed', { error });
        }
      })();
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
          className="p-2 bg-background-secondary-1"
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

PtyPaneComponent.displayName = 'TerminalPane';

export const PtyPane = React.memo(PtyPaneComponent);
