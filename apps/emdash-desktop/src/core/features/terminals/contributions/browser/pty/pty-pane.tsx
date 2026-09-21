import { toast } from '@emdash/ui/react/primitives';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { FrontendPty, type SessionTheme } from '@core/features/terminals/api/browser/pty/pty';
import type {
  PreparedTerminalAttachments,
  TerminalAttachmentTarget,
} from '@core/features/terminals/api/browser/pty/terminal-attachment-target';
import {
  buildTerminalImageInjection,
  clipboardDataMayContainImage,
  extractClipboardImageFiles,
  formatTerminalImagePaths,
  isNearDuplicatePaste,
} from '@core/features/terminals/api/browser/pty/terminal-image-paths';
import {
  type PasteFromClipboardHandler,
  type UsePtyOptions,
  usePty,
} from '@core/features/terminals/browser/pty/use-pty';
import {
  PaneSizingContextProvider,
  usePaneSizingContext,
} from '@core/features/terminals/contributions/browser/pty/pane-sizing-context';
import { terminalInputScope } from '@core/features/workbench/contributions/scopes';
import { getHostClient } from '@core/primitives/desktop-host/browser/host-client';
import { getDraggedWorkspaceFile } from '@core/primitives/drag-files/browser/drag-files';
import { log } from '@core/primitives/logging/browser/logger';
import { cn } from '@core/primitives/styling/browser/cn';
import { enabled, hidden, type ViewScopeImpl } from '@core/primitives/view-scopes/api';
import { useViewScope } from '@core/primitives/view-scopes/react';
import {
  createPaneDimensionSink,
  PaneDimensionProvider,
} from '@core/primitives/workbench-shell/browser/tabs/pane-dimension-provider';

type Props = {
  /**
   * Deterministic PTY session ID: `makePtySessionId(projectId, scopeId, leafId)`.
   */
  sessionId: string;
  /** Pre-connected FrontendPty owned by the entity's PtySession store. */
  pty: FrontendPty;
  className?: string;
  contentFilter?: string;
  inputContext?: UsePtyOptions['inputContext'];
  mapShiftEnterToCtrlJ?: boolean;
  readOnly?: boolean;
  attachments: TerminalAttachmentTarget;
  workspaceId: string;
  themeOverride?: SessionTheme['override'];
  /** Overrides only the bottom of xterm's otherwise uniform internal padding. */
  paddingBottom?: number;
  onActivity?: () => void;
  onExit?: (info: { exitCode: number | undefined; signal?: number }) => void;
  onFirstMessage?: (message: string) => void;
  onEnterPress?: (message: string) => void;
  onInterruptPress?: () => void;
  onFind?: () => void;
};

type TerminalInputHelpers = Parameters<PasteFromClipboardHandler>[0];

type AttachmentTarget = TerminalInputHelpers & {
  workspaceId: string;
  attachments: TerminalAttachmentTarget;
  signal: AbortSignal;
  isCurrent: () => boolean;
};

async function prepareAndInject(
  target: AttachmentTarget,
  prepare: () => Promise<PreparedTerminalAttachments>
): Promise<boolean> {
  if (!target.isCurrent()) return false;
  const notice = toast('Uploading attachments…', { duration: Infinity });
  const dismiss = () => toast.dismiss(notice);
  target.signal.addEventListener('abort', dismiss, { once: true });
  try {
    const prepared = await prepare();
    if (!target.isCurrent()) {
      await prepared.discard();
      return false;
    }
    const payload = buildTerminalImageInjection(prepared.paths, prepared.platform);
    target.sendInput(payload, { track: false });
    target.focus();
    return true;
  } finally {
    target.signal.removeEventListener('abort', dismiss);
    dismiss();
  }
}

function injectTerminalFilePaths(target: AttachmentTarget, paths: string[]): Promise<boolean> {
  return prepareAndInject(target, () =>
    target.attachments.prepareLocalSnapshots(paths, target.signal)
  );
}
function injectFiles(target: AttachmentTarget, files: File[], snapshot = false): Promise<boolean> {
  return prepareAndInject(target, () =>
    target.attachments.prepareFiles(files, target.signal, snapshot)
  );
}

function reportAttachmentError(target: AttachmentTarget, error: unknown): void {
  if (!target.isCurrent()) return;
  log.warn('Terminal attachment failed', { error });
  toast.error('Failed to attach files', {
    description: error instanceof Error ? error.message : String(error),
  });
}

// Only image pastes participate in duplicate suppression.
async function pasteClipboardImageOrText(args: {
  target: AttachmentTarget;
  injectImagePaths?: (paths: string[]) => Promise<boolean>;
  fallbackText?: string;
  preferText?: boolean;
}): Promise<boolean> {
  const { target } = args;
  if (!target.isCurrent()) return false;
  if (args.preferText) {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        if (target.isCurrent()) target.sendInput(text);
        return false;
      }
    } catch {
      // Clipboard text read denied or unavailable; try the image path below.
    }
  }

  if (!target.isCurrent()) return false;
  const result = await (await getHostClient()).persistClipboardImage();
  if (!target.isCurrent()) return false;
  if (!result.success) throw new Error(result.error ?? 'Could not read the clipboard image');
  if (result.path) {
    if (args.injectImagePaths) return args.injectImagePaths([result.path]);
    return injectTerminalFilePaths(target, [result.path]);
  }

  if (args.fallbackText !== undefined) {
    if (args.fallbackText) target.sendInput(args.fallbackText);
    return false;
  }

  try {
    const text = await navigator.clipboard.readText();
    if (text && target.isCurrent()) target.sendInput(text);
  } catch {
    // Clipboard read denied or unavailable.
  }
  return false;
}

const PtyPaneInner = forwardRef<{ focus: () => void }, Props>(
  (
    {
      sessionId,
      pty,
      className,
      contentFilter,
      inputContext,
      mapShiftEnterToCtrlJ,
      readOnly = false,
      attachments,
      workspaceId,
      themeOverride,
      paddingBottom,
      onActivity,
      onFirstMessage,
      onEnterPress,
      onInterruptPress,
      onFind,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const { attachRef: attachTerminalScope, instance: terminalScopeInstance } = useViewScope(
      terminalInputScope({ sessionId }),
      {
        'terminal.find': () => ({
          availability: () => (onFind ? enabled : hidden),
          execute: () => onFind?.(),
        }),
      } satisfies ViewScopeImpl<typeof terminalInputScope>
    );
    const setContainerRef = useCallback(
      (element: HTMLDivElement | null) => {
        containerRef.current = element;
        attachTerminalScope(element);
      },
      [attachTerminalScope]
    );
    const imagePasteStateRef = useRef({
      domRevision: 0,
      lastDomAt: 0,
      lastSystemAt: 0,
      pendingDom: 0,
      pendingSystem: 0,
    });
    const attachmentLifetimeRef = useRef<AbortController | null>(null);

    useLayoutEffect(() => {
      const lifetime = new AbortController();
      attachmentLifetimeRef.current = lifetime;
      imagePasteStateRef.current = {
        domRevision: 0,
        lastDomAt: 0,
        lastSystemAt: 0,
        pendingDom: 0,
        pendingSystem: 0,
      };
      return () => lifetime.abort();
    }, [pty, sessionId, workspaceId, attachments, readOnly]);

    const captureAttachmentTarget = useCallback(
      (helpers: TerminalInputHelpers): AttachmentTarget | null => {
        const signal = attachmentLifetimeRef.current?.signal;
        if (readOnly || !signal || signal.aborted) return null;
        return {
          ...helpers,
          workspaceId,
          attachments,
          signal,
          isCurrent: () => !signal.aborted && FrontendPty.all.has(pty),
        };
      },
      [pty, readOnly, attachments, workspaceId]
    );

    const theme: SessionTheme = { override: themeOverride, paddingBottom };

    const handleSystemPaste = useCallback<PasteFromClipboardHandler>(
      ({ focus, sendInput }) => {
        const imagePasteState = imagePasteStateRef.current;
        if (isNearDuplicatePaste(imagePasteState.lastDomAt)) return;
        const target = captureAttachmentTarget({ focus, sendInput });
        if (!target) return;
        const domRevision = imagePasteState.domRevision;
        void (async () => {
          try {
            await pasteClipboardImageOrText({
              target,
              preferText: true,
              injectImagePaths: async (paths) => {
                if (
                  imagePasteState.domRevision !== domRevision ||
                  imagePasteState.pendingDom > 0 ||
                  isNearDuplicatePaste(imagePasteState.lastDomAt)
                ) {
                  return false;
                }
                imagePasteState.pendingSystem += 1;
                try {
                  const injected = await injectTerminalFilePaths(target, paths);
                  if (injected) imagePasteState.lastSystemAt = Date.now();
                  return injected;
                } finally {
                  imagePasteState.pendingSystem -= 1;
                }
              },
            });
          } catch (error) {
            reportAttachmentError(target, error);
          }
        })();
      },
      [captureAttachmentTarget]
    );

    const { focus, sendInput } = usePty(
      {
        sessionId,
        pty,
        theme,
        inputContext,
        mapShiftEnterToCtrlJ,
        readOnly,
        onActivity,
        onFirstMessage,
        onEnterPress,
        onInterruptPress,
        onPasteFromClipboard: readOnly ? undefined : handleSystemPaste,
      },
      containerRef
    );

    useEffect(() => {
      if (!terminalScopeInstance) return;
      terminalScopeInstance.setFocusDelegate(focus);
      return () => terminalScopeInstance.setFocusDelegate(undefined);
    }, [focus, terminalScopeInstance]);

    useImperativeHandle(ref, () => ({ focus }), [focus]);

    const handleFocus = () => {
      focus();
    };

    const handlePaste = useCallback(
      (event: React.ClipboardEvent<HTMLDivElement>) => {
        if (readOnly) return;
        const imagePasteState = imagePasteStateRef.current;
        const clipboardData = event.clipboardData;
        const fallbackText = clipboardData?.getData('text/plain') ?? '';
        const imageFiles = extractClipboardImageFiles(clipboardData);
        if (imageFiles.length === 0 && !clipboardDataMayContainImage(clipboardData)) return;

        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        if (imagePasteState.pendingSystem > 0 || isNearDuplicatePaste(imagePasteState.lastSystemAt))
          return;
        const target = captureAttachmentTarget({ focus, sendInput });
        if (!target) return;
        imagePasteState.domRevision += 1;
        imagePasteState.lastDomAt = Date.now();
        imagePasteState.pendingDom += 1;
        void (async () => {
          try {
            if (imageFiles.length > 0 && (await injectFiles(target, imageFiles, true))) {
              imagePasteState.lastDomAt = Date.now();
              return;
            }
            if (await pasteClipboardImageOrText({ target, fallbackText })) {
              imagePasteState.lastDomAt = Date.now();
            }
          } catch (error) {
            reportAttachmentError(target, error);
          } finally {
            imagePasteState.pendingDom -= 1;
          }
        })();
      },
      [captureAttachmentTarget, focus, readOnly, sendInput]
    );

    const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
      const target = captureAttachmentTarget({ focus, sendInput });
      if (!target) return;
      try {
        event.preventDefault();
        const transfer = event.dataTransfer;

        // Workspace-tree drops already carry paths on the target host.
        const draggedWorkspaceFile = getDraggedWorkspaceFile(transfer);
        if (draggedWorkspaceFile) {
          if (draggedWorkspaceFile.workspaceId !== workspaceId) return;

          const platform =
            draggedWorkspaceFile.targetPlatform ?? (await (await getHostClient()).getPlatform());
          if (!target.isCurrent()) return;
          const paths = formatTerminalImagePaths(draggedWorkspaceFile.targetPaths, platform);
          target.sendInput(`${paths} `, { track: false });
          target.focus();
          return;
        }

        if (transfer.files.length === 0) return;
        const files = Array.from(transfer.files);
        const injected = await injectFiles(target, files);
        if (!injected && target.isCurrent()) throw new Error('Could not read the dropped files');
      } catch (error) {
        reportAttachmentError(target, error);
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
          backgroundColor: themeOverride?.background ?? 'var(--em-surface)',
        }}
      >
        <div
          ref={setContainerRef}
          data-terminal-container
          className={cn(themeOverride?.background ? '' : 'bg-(--em-surface)')}
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

PtyPaneInner.displayName = 'TerminalPane';

/**
 * Outer wrapper: guarantees a PaneSizingContext (and therefore the per-pane
 * resize controller) is always present. When a PaneSizingContextProvider
 * ancestor already exists (e.g. conversations-panel, terminal drawer) the
 * children use that context unchanged. When none exists, PtyPane self-provisions
 * a provider scoped to its own single session ID so there is always exactly one
 * measurement path through the controller.
 */
const PtyPaneComponent = forwardRef<{ focus: () => void }, Props>((props, ref) => {
  const existing = usePaneSizingContext();
  const sink = useMemo(() => createPaneDimensionSink(), []);
  const sessionIds = useMemo(() => [props.sessionId], [props.sessionId]);

  if (existing) return <PtyPaneInner {...props} ref={ref} />;
  return (
    <PaneDimensionProvider sink={sink}>
      <PaneSizingContextProvider sessionIds={sessionIds}>
        <PtyPaneInner {...props} ref={ref} />
      </PaneSizingContextProvider>
    </PaneDimensionProvider>
  );
});
PtyPaneComponent.displayName = 'PtyPane';

export const PtyPane = React.memo(PtyPaneComponent);
