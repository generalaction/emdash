import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { getDraggedFilePaths } from '@renderer/lib/drag-files';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';
import { pastePromptInjection } from './prompt-injection';
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
  contentFilter?: string;
  mapShiftEnterToCtrlJ?: boolean;
  /**
   * Provider running inside the PTY (e.g. 'claude'). When set, clipboard
   * pastes are formatted for that provider — Claude receives raw text rather
   * than bracketed-paste sequences, which it does not handle reliably.
   */
  providerId?: string;
  /** SSH connection ID — used for remote file drag-and-drop only. */
  remoteConnectionId?: string;
  themeOverride?: SessionTheme['override'];
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
      contentFilter,
      mapShiftEnterToCtrlJ,
      providerId,
      remoteConnectionId,
      themeOverride,
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
        providerId,
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
      try {
        event.preventDefault();
        const paths = getDraggedFilePaths(event.dataTransfer);
        if (paths.length === 0) return;

        void (async () => {
          try {
            if (remoteConnectionId) {
              try {
                const result = await rpc.pty.uploadFiles({ sessionId, localPaths: paths });
                if (result.success && result.data?.remotePaths) {
                  await pastePromptInjection({
                    providerId: undefined,
                    text: formatDroppedPaths(result.data.remotePaths),
                    forceBracketedPaste: true,
                    sendInput: async (data) => sendInput(`${data} `),
                  });
                }
              } catch (error) {
                log.warn('SSH file transfer failed', { error });
              }
            } else {
              await pastePromptInjection({
                providerId: undefined,
                text: formatDroppedPaths(paths),
                forceBracketedPaste: true,
                sendInput: async (data) => sendInput(`${data} `),
              });
            }
            focus();
          } catch (error) {
            log.warn('Terminal drop failed', { error });
          }
        })();
      } catch (error) {
        log.warn('Terminal drop failed', { error });
      }
    };

    return (
      <div
        className={cn('terminal-pane flex h-full w-full min-w-0 bg', className)}
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          boxSizing: 'border-box',
          backgroundColor: themeOverride?.background ?? 'var(--background-secondary)',
        }}
      >
        <div
          ref={containerRef}
          data-terminal-container
          className={cn('p-2 ', themeOverride?.background ? '' : 'bg-background-secondary-1')}
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

function formatDroppedPaths(paths: string[]): string {
  return paths.map((path) => `'${path.replace(/'/g, "'\\''")}'`).join(' ');
}

PtyPaneComponent.displayName = 'TerminalPane';

export const PtyPane = React.memo(PtyPaneComponent);
