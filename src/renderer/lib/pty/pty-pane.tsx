import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';
import type { FrontendPty, SessionTheme } from './pty';
import { usePty } from './use-pty';

// Chromium hands out drag-temp paths under the OS temp tree (e.g.
// /var/folders/.../T/Drops/... on macOS, %LOCALAPPDATA%\Temp\... on Windows,
// /tmp/.org.chromium.* on Linux).  Those files are deleted by Chromium right
// after the drop completes, before the CLI in the PTY has a chance to read
// them — so the path arrives as plain text and the user sees a dangling temp
// URL instead of an inlined image.  Finder/Explorer drops give real on-disk
// paths and are passed through untouched.
function isUnstableDropPath(path: string): boolean {
  if (!path) return true;
  if (/^\/(?:private\/)?var\/folders\//.test(path)) return true;
  if (/[\\/](?:tmp|temp)[\\/]/i.test(path) && /(?:drop|chromium|electron)/i.test(path)) return true;
  if (/[\\/]AppData[\\/]Local[\\/]Temp[\\/]/i.test(path)) return true;
  return false;
}

async function resolveDroppedFile(file: File): Promise<string | null> {
  const originalPath = window.electronAPI.getPathForFile(file).trim();
  if (originalPath && !isUnstableDropPath(originalPath)) return originalPath;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await rpc.pty.persistDroppedBlob({
      bytes,
      name: file.name,
      mimeType: file.type,
    });
    if (result.success) return result.data.path;
    log.warn('Drop persist failed', { error: result.error });
  } catch (error) {
    log.warn('Drop arrayBuffer failed', { error });
  }
  return null;
}

// Escape shell-special chars with backslashes so the path stays a single token
// without wrapping it in single quotes.  Wrapping in `'…'` makes Claude's TUI
// treat the literal quotes as part of the filename and skip its image-detection
// path; iTerm2's "drag with escaping" uses backslash escapes for the same reason.
function escapePathForTerminal(p: string): string {
  return p.replace(/([\s'"\\$`!*?()[\]{}|;<>&#~])/g, '\\$1');
}

function escapeWindowsPathForTerminal(p: string): string {
  return p.replace(/([\s'"$`!*?()[\]{}|;<>&#~])/g, '\\$1');
}

function formatLocalDroppedPaths(paths: string[], platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return paths.map(escapeWindowsPathForTerminal).join(' ');
  }
  return paths.map(escapePathForTerminal).join(' ');
}

// Wrap dropped paths in bracketed-paste markers.  Claude Code (and Codex) only
// run their pasted-file → inline-image conversion when the bytes arrive as a
// paste event.  Without the markers the TUI treats each character as typed
// input and the path stays visible as raw text — exactly the bug the user hit.
// Shells (bash/zsh) with bracketed-paste enabled strip the markers transparently
// and just see the path, so this is safe for non-TUI sessions too.
function wrapAsBracketedPaste(text: string): string {
  return `\x1b[200~${text}\x1b[201~`;
}

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
      try {
        event.preventDefault();
        const dt = event.dataTransfer;
        if (!dt?.files?.length) return;

        const files = Array.from(dt.files);

        void (async () => {
          try {
            const resolved = await Promise.all(files.map((f) => resolveDroppedFile(f)));
            const paths = resolved.filter((p): p is string => Boolean(p));
            if (paths.length === 0) return;

            if (remoteConnectionId) {
              try {
                const result = await rpc.pty.uploadFiles({ sessionId, localPaths: paths });
                if (result.success && result.data?.remotePaths) {
                  const escaped = result.data.remotePaths.map(escapePathForTerminal).join(' ');
                  sendInput(`${wrapAsBracketedPaste(escaped)} `);
                }
              } catch (error) {
                log.warn('SSH file transfer failed', { error });
              }
            } else {
              const platform = (await rpc.app.getPlatform()) as NodeJS.Platform;
              const formatted = formatLocalDroppedPaths(paths, platform);
              sendInput(`${wrapAsBracketedPaste(formatted)} `);
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
