import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';
import type { FrontendPty, SessionTheme } from './pty';
import { resolveDroppedFile } from './terminal-image-injection';
import {
  buildTerminalImageInjection,
  clipboardDataMayContainImage,
  extractClipboardImageFiles,
  isNearDuplicatePaste,
} from './terminal-image-paths';
import { type PasteFromClipboardHandler, usePty } from './use-pty';

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
  /** SSH connection ID — used for remote file drag-and-drop and image paste. */
  remoteConnectionId?: string;
  themeOverride?: SessionTheme['override'];
  onActivity?: () => void;
  onExit?: (info: { exitCode: number | undefined; signal?: number }) => void;
  onFirstMessage?: (message: string) => void;
  onEnterPress?: (message: string) => void;
  onInterruptPress?: () => void;
};

type TerminalInputHelpers = Parameters<PasteFromClipboardHandler>[0];

async function injectTerminalImagePaths(args: {
  paths: string[];
  sessionId: string;
  remoteConnectionId: string | undefined;
  sendInput: TerminalInputHelpers['sendInput'];
  focus: TerminalInputHelpers['focus'];
}): Promise<void> {
  if (args.paths.length === 0) return;

  let paths = args.paths;
  if (args.remoteConnectionId) {
    const result = await rpc.pty.uploadFiles({ sessionId: args.sessionId, localPaths: paths });
    if (!result.success) {
      log.warn('SSH file transfer failed', { error: result.error });
      return;
    }
    paths = result.data.remotePaths;
    if (paths.length === 0) return;
  }

  const platform = args.remoteConnectionId
    ? 'linux'
    : ((await rpc.app.getPlatform()) as NodeJS.Platform);
  const payload = buildTerminalImageInjection(paths, platform);
  args.sendInput(`${payload} `, { track: false });
  args.focus();
}

async function pasteClipboardImageOrText(args: {
  sessionId: string;
  remoteConnectionId: string | undefined;
  sendInput: TerminalInputHelpers['sendInput'];
  focus: TerminalInputHelpers['focus'];
  fallbackText?: string;
  preferText?: boolean;
}): Promise<void> {
  if (args.preferText) {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        args.sendInput(text);
        return;
      }
    } catch {
      // Clipboard text read denied or unavailable; try the image path below.
    }
  }

  try {
    const result = await rpc.pty.persistClipboardImage();
    if (result.success && result.data.path) {
      await injectTerminalImagePaths({ ...args, paths: [result.data.path] });
      return;
    }
  } catch (error) {
    log.warn('Terminal clipboard image paste failed', { error });
  }

  if (args.fallbackText !== undefined) {
    if (args.fallbackText) args.sendInput(args.fallbackText);
    return;
  }

  try {
    const text = await navigator.clipboard.readText();
    if (text) args.sendInput(text);
  } catch {
    // Clipboard read denied or unavailable.
  }
}

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
    const lastDomImagePasteAtRef = useRef(0);
    const lastSystemPasteAtRef = useRef(0);

    const theme: SessionTheme = { override: themeOverride };

    const handleSystemPaste = useCallback<PasteFromClipboardHandler>(
      ({ focus, sendInput }) => {
        if (isNearDuplicatePaste(lastDomImagePasteAtRef.current)) return;
        lastSystemPasteAtRef.current = Date.now();
        void pasteClipboardImageOrText({
          sessionId,
          remoteConnectionId,
          focus,
          sendInput,
          preferText: true,
        });
      },
      [remoteConnectionId, sessionId]
    );

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
        onPasteFromClipboard: handleSystemPaste,
      },
      containerRef
    );

    useImperativeHandle(ref, () => ({ focus }), [focus]);

    const injectImagePaths = useCallback(
      async (paths: string[]) => {
        await injectTerminalImagePaths({
          paths,
          sessionId,
          remoteConnectionId,
          focus,
          sendInput,
        });
      },
      [focus, remoteConnectionId, sendInput, sessionId]
    );

    const injectImageFiles = useCallback(
      async (files: File[]): Promise<boolean> => {
        const resolved = await Promise.all(files.map((file) => resolveDroppedFile(file)));
        const paths = resolved.filter((path): path is string => Boolean(path));
        if (paths.length === 0) return false;
        await injectImagePaths(paths);
        return true;
      },
      [injectImagePaths]
    );

    const handleFocus = () => {
      focus();
    };

    const handlePaste = useCallback(
      (event: React.ClipboardEvent<HTMLDivElement>) => {
        const clipboardData = event.clipboardData;
        const fallbackText = clipboardData?.getData('text/plain') ?? '';
        const imageFiles = extractClipboardImageFiles(clipboardData);
        if (imageFiles.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          if (isNearDuplicatePaste(lastSystemPasteAtRef.current)) return;
          lastDomImagePasteAtRef.current = Date.now();
          void (async () => {
            try {
              const injected = await injectImageFiles(imageFiles);
              if (injected) return;
              await pasteClipboardImageOrText({
                sessionId,
                remoteConnectionId,
                focus,
                sendInput,
                fallbackText,
              });
            } catch (error) {
              log.warn('Terminal image paste failed', { error });
            }
          })();
          return;
        }

        if (!clipboardDataMayContainImage(clipboardData)) return;

        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        if (isNearDuplicatePaste(lastSystemPasteAtRef.current)) return;
        lastDomImagePasteAtRef.current = Date.now();
        void pasteClipboardImageOrText({
          sessionId,
          remoteConnectionId,
          focus,
          sendInput,
          fallbackText,
        });
      },
      [focus, injectImageFiles, remoteConnectionId, sendInput, sessionId]
    );

    const handleDrop: React.DragEventHandler<HTMLDivElement> = (event) => {
      try {
        event.preventDefault();
        const dt = event.dataTransfer;
        if (!dt?.files?.length) return;

        const files = Array.from(dt.files);

        void (async () => {
          try {
            const resolved = await Promise.all(files.map((file) => resolveDroppedFile(file)));
            const paths = resolved.filter((path): path is string => Boolean(path));
            if (paths.length === 0) return;
            await injectImagePaths(paths);
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
          onPasteCapture={handlePaste}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        />
      </div>
    );
  }
);

PtyPaneComponent.displayName = 'TerminalPane';

export const PtyPane = React.memo(PtyPaneComponent);
