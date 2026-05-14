import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { RENDERER_FILE_MAX_BYTES } from '@shared/conversations';
import { quoteShellArg } from '@shared/shell';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';
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

      const saveDroppedFile = async (file: File) => {
        if (file.size > RENDERER_FILE_MAX_BYTES) {
          throw new Error(`File "${file.name}" is too large to drop into the terminal.`);
        }
        const buffer = await file.arrayBuffer();
        return rpc.app.saveRendererFile({
          name: file.name,
          data: new Uint8Array(buffer),
        });
      };

      void (async () => {
        try {
          const localPaths = await Promise.all(files.map(saveDroppedFile));
          if (localPaths.length === 0) return;

          const paths = remoteConnectionId
            ? await (async () => {
                const result = await rpc.pty.uploadFiles({ sessionId, localPaths });
                if (!result.success || !result.data?.remotePaths) return [];
                return result.data.remotePaths;
              })()
            : localPaths;

          if (paths.length === 0) return;
          const escaped = paths.map((p: string) => quoteShellArg(p)).join(' ');
          sendInput(`${escaped} `);
          focus();
        } catch (error) {
          log.warn('Terminal drop failed', { error });
        }
      })();
    };

    return (
      <div
        className={cn('terminal-pane flex h-full w-full min-w-0 bg', className)}
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          boxSizing: 'border-box',
          backgroundColor: themeOverride?.background ?? 'var(--background-1)',
        }}
      >
        <div
          ref={containerRef}
          data-terminal-container
          className="p-2"
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
