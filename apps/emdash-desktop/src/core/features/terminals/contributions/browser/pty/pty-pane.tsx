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
import type { FrontendPty, SessionTheme } from '@core/features/terminals/api/browser/pty/pty';
import type {
  PreparedTerminalAttachments,
  TerminalAttachmentTarget,
} from '@core/features/terminals/api/browser/pty/terminal-attachment-target';
import {
  buildTerminalImageInjection,
  formatTerminalImagePaths,
} from '@core/features/terminals/api/browser/pty/terminal-image-paths';
import {
  effectiveBracketedPaste,
  MAX_TERMINAL_PASTE_BYTES,
  pasteActsAsKeystrokes,
  prepareTerminalPasteText,
  readPasteEventContent,
  unlessAborted,
  type PasteCommitResult,
  utf8ByteLength,
  whenOutputParsed,
  type TerminalPasteContent,
} from '@core/features/terminals/browser/pty/terminal-paste';
import {
  type PasteFromClipboardHandler,
  type TerminalPasteHelpers,
  type UsePtyOptions,
  usePty,
} from '@core/features/terminals/browser/pty/use-pty';
import {
  PaneSizingContextProvider,
  usePaneSizingContext,
} from '@core/features/terminals/contributions/browser/pty/pane-sizing-context';
import { terminalInputScope } from '@core/features/workbench/contributions/scopes';
import { openModal } from '@core/manifests/browser/modal-api';
import type { ClipboardSource } from '@core/primitives/desktop-host/api/host-contract';
import {
  getHostClient,
  hasPendingClipboardWrite,
  readClipboardForPaste,
  snapshotClipboardImage,
} from '@core/primitives/desktop-host/browser/host-client';
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

type AttachmentTarget = TerminalPasteHelpers & {
  pty: FrontendPty;
  workspaceId: string;
  attachments: TerminalAttachmentTarget;
  /** Aborts when the pane state that received the gesture changes or the terminal is disposed. */
  signal: AbortSignal;
  isCurrent: () => boolean;
};

type DroppedFiles = {
  workspaceFile: ReturnType<typeof getDraggedWorkspaceFile>;
  files: File[];
};

function reportUnconfirmed(what: 'pasted text' | 'attachment path'): void {
  toast.error(what === 'pasted text' ? 'Paste not confirmed' : 'Attachment not confirmed', {
    description: `The terminal did not confirm the ${what}. Check it before trying again.`,
  });
}

// Waits once per paste for the runtime's answer, so input held behind the paste follows only a
// paste that arrived. An unconfirmed write may have partly arrived, so it is never resent.
async function confirmDelivery(
  target: AttachmentTarget,
  delivery: Promise<boolean>,
  what: 'pasted text' | 'attachment path'
): Promise<boolean> {
  if (!(await delivery)) {
    reportUnconfirmed(what);
    return false;
  }
  // The user may have moved to another task while the write was in flight.
  if (target.isCurrent()) target.focus();
  return true;
}

type InjectResult = 'sent' | 'cancelled' | 'unconfirmed';

async function prepareAndInject(
  target: AttachmentTarget,
  prepare: () => Promise<PreparedTerminalAttachments>
): Promise<InjectResult> {
  if (!target.isCurrent()) return 'cancelled';
  const notice = toast('Uploading attachments…', { duration: Infinity });
  const dismiss = () => toast.dismiss(notice);
  target.signal.addEventListener('abort', dismiss, { once: true });
  try {
    const prepared = await prepare();
    if (!target.isCurrent()) {
      await prepared.discard();
      return 'cancelled';
    }
    const payload = buildTerminalImageInjection(prepared.paths, prepared.platform);
    dismiss();
    // Prepared files stay managed even if unconfirmed: the agent may have the path already.
    const delivered = await confirmDelivery(
      target,
      target.deliverInput(payload, { track: false }),
      'attachment path'
    );
    return delivered ? 'sent' : 'unconfirmed';
  } finally {
    target.signal.removeEventListener('abort', dismiss);
    dismiss();
  }
}

function injectTerminalFilePaths(target: AttachmentTarget, paths: string[]): Promise<InjectResult> {
  return prepareAndInject(target, () =>
    target.attachments.prepareLocalSnapshots(paths, target.signal)
  );
}
function injectFiles(
  target: AttachmentTarget,
  files: File[],
  snapshot = false
): Promise<InjectResult> {
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

function reportPasteError(target: AttachmentTarget, error: unknown): void {
  // A paste that fails after its pane changed (e.g. an aborted upload) was cancelled.
  if (!target.isCurrent()) {
    reportPasteCancelled();
    return;
  }
  log.warn('Terminal paste failed', { error });
  toast.error('Paste failed', {
    description: error instanceof Error ? error.message : String(error),
  });
}

function reportPasteCancelled(): false {
  toast('Paste cancelled', {
    description: 'The terminal changed before the paste was sent.',
  });
  return false;
}

function pathForFile(file: File): string {
  return window.electronAPI?.getPathForFile(file)?.trim() ?? '';
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function confirmKeystrokePaste(text: string): Promise<boolean> {
  const lineBreaks = text.match(/\r\n|\r|\n/g)?.length ?? 0;
  const description =
    lineBreaks > 0
      ? `This terminal has not enabled bracketed paste, so ${
          lineBreaks === 1 ? 'the line break' : `all ${lineBreaks} line breaks`
        } will be sent as Enter and can run commands before you review them.`
      : 'This terminal has not enabled bracketed paste, so tabs will be sent as Tab and can trigger completion.';
  const outcome = await openModal('confirmActionModal', {
    title: 'Paste as keystrokes?',
    description,
    confirmLabel: 'Paste',
    variant: 'default',
  });
  return outcome.success;
}

/** Acquires a native clipboard snapshot now, in clipboard order; the paste commits it later. */
function readNativePasteContent(
  source: ClipboardSource,
  signal: AbortSignal
): Promise<TerminalPasteContent> {
  const snapshot = readClipboardForPaste(source).then((result): TerminalPasteContent => {
    if (!result.success) throw new Error(`Could not read the clipboard: ${result.error}`);
    const { content } = result;
    if (content.kind === 'text') return content;
    return content.kind === 'image' ? { kind: 'image-path', path: content.path } : content;
  });
  return unlessAborted(snapshot, signal, { kind: 'cancelled' as const });
}

// The event carries the system clipboard as it was at the gesture. That is current unless an
// app copy has not reached the system clipboard yet; then the paste snapshots the clipboard
// again behind that copy, as the shortcut route does.
function readEventPasteContent(
  data: DataTransfer | null,
  signal: AbortSignal
): TerminalPasteContent | Promise<TerminalPasteContent> {
  if (hasPendingClipboardWrite()) return readNativePasteContent('clipboard', signal);
  const content = readPasteEventContent(data, pathForFile);
  if (content.kind !== 'native-image') return content;
  // The payload advertised an image it does not expose; snapshot the system clipboard now.
  const snapshot = snapshotClipboardImage().then((result): TerminalPasteContent => {
    if (!result.success) throw new Error(result.error ?? 'Could not read the clipboard image');
    return result.path ? { kind: 'image-path', path: result.path } : { kind: 'empty' };
  });
  return unlessAborted(snapshot, signal, { kind: 'cancelled' as const });
}

// Resolves false when nothing was sent, so input typed after the paste is discarded too.
async function commitTextPaste(target: AttachmentTarget, text: string): Promise<boolean> {
  const prepared = prepareTerminalPasteText(text);
  const bytes = utf8ByteLength(prepared);
  if (bytes > MAX_TERMINAL_PASTE_BYTES) {
    toast.error('Paste too large', {
      description: `The clipboard text is ${formatMegabytes(bytes)}. Terminals accept pastes up to ${formatMegabytes(MAX_TERMINAL_PASTE_BYTES)}, so nothing was sent.`,
    });
    return false;
  }
  const { terminal } = target.pty;
  let confirmed = false;
  // Output received before the paste can change the destination's mode, so read the mode
  // only once xterm has parsed it, and again after a confirmation.
  for (;;) {
    if (!(await whenOutputParsed(terminal, target.signal))) return reportPasteCancelled();
    if (confirmed || !pasteActsAsKeystrokes(prepared, effectiveBracketedPaste(terminal))) break;
    if (!(await confirmKeystrokePaste(prepared))) return false;
    confirmed = true;
  }
  return confirmDelivery(target, target.pasteText(prepared), 'pasted text');
}

async function commitAttachment(inject: () => Promise<InjectResult>): Promise<boolean> {
  const result = await inject();
  if (result === 'cancelled') return reportPasteCancelled();
  return result === 'sent';
}

function commitPaste(
  target: AttachmentTarget,
  content: TerminalPasteContent
): Promise<boolean> | boolean {
  switch (content.kind) {
    case 'text':
      return commitTextPaste(target, content.text);
    case 'image-files':
      return commitAttachment(() => injectFiles(target, content.files, true));
    case 'image-path':
      return commitAttachment(() => injectTerminalFilePaths(target, [content.path]));
    case 'cancelled':
      return reportPasteCancelled();
    case 'empty':
      return true;
  }
}

async function commitDrop(
  target: AttachmentTarget,
  { workspaceFile, files }: DroppedFiles
): Promise<boolean> {
  // Workspace-tree drops already carry paths on the target host.
  if (workspaceFile) {
    if (workspaceFile.workspaceId !== target.workspaceId) return true;
    const platform = workspaceFile.targetPlatform ?? (await (await getHostClient()).getPlatform());
    if (!target.isCurrent()) return false;
    const paths = formatTerminalImagePaths(workspaceFile.targetPaths, platform);
    return confirmDelivery(
      target,
      target.deliverInput(`${paths} `, { track: false }),
      'attachment path'
    );
  }
  if (files.length === 0) return true;
  const injected = await injectFiles(target, files);
  if (injected === 'cancelled' && target.isCurrent()) {
    throw new Error('Could not read the dropped files');
  }
  return injected === 'sent';
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
    const attachmentLifetimeRef = useRef<AbortController | null>(null);

    // A paste belongs to the pane state that received the gesture. Replacing the terminal,
    // session, workspace or read-only state aborts the lifetime, so a pending paste can
    // never be sent into a newly focused task.
    useLayoutEffect(() => {
      const lifetime = new AbortController();
      attachmentLifetimeRef.current = lifetime;
      return () => lifetime.abort();
    }, [pty, sessionId, workspaceId, attachments, readOnly]);

    const captureAttachmentTarget = useCallback(
      (helpers: TerminalPasteHelpers): AttachmentTarget | null => {
        const lifetime = attachmentLifetimeRef.current?.signal;
        if (readOnly || !lifetime || lifetime.aborted || pty.disposed.aborted) return null;
        const signal = AbortSignal.any([lifetime, pty.disposed]);
        return {
          ...helpers,
          pty,
          workspaceId,
          attachments,
          signal,
          isCurrent: () => !signal.aborted,
        };
      },
      [pty, readOnly, attachments, workspaceId]
    );

    // Content is acquired now, during the gesture; the commit runs in input order.
    const enqueue = useCallback(
      <T,>(
        helpers: TerminalPasteHelpers,
        acquire: (signal: AbortSignal) => T | Promise<T>,
        commit: (
          target: AttachmentTarget,
          content: T
        ) => PasteCommitResult | Promise<PasteCommitResult>,
        onError: (target: AttachmentTarget, error: unknown) => void
      ): boolean => {
        const target = captureAttachmentTarget(helpers);
        if (!target) return false;
        helpers.queuePaste(
          acquire(target.signal),
          (content) => commit(target, content),
          (error) => onError(target, error),
          reportPasteCancelled
        );
        return true;
      },
      [captureAttachmentTarget]
    );

    const theme: SessionTheme = { override: themeOverride, paddingBottom };

    // Application-owned gestures (Windows/Linux shortcuts, context menu, Linux middle click)
    // snapshot the clipboard or primary selection through the desktop host; their browser
    // default is already prevented.
    const handleSystemPaste = useCallback<PasteFromClipboardHandler>(
      (helpers, source) => {
        enqueue(
          helpers,
          (signal) => readNativePasteContent(source, signal),
          commitPaste,
          reportPasteError
        );
      },
      [enqueue]
    );

    const { focus, queuePaste, pasteText, deliverInput } = usePty(
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

    const helpers = useMemo(
      () => ({ focus, queuePaste, pasteText, deliverInput }),
      [focus, queuePaste, pasteText, deliverInput]
    );

    // Browser-owned gestures (macOS Cmd+V, Edit > Paste, Shift+Insert) deliver the system
    // clipboard in the event. Consume it here, before xterm's own handler; it is read again
    // only if an app copy is still on its way to the clipboard.
    const handlePaste = useCallback(
      (event: React.ClipboardEvent<HTMLDivElement>) => {
        if (readOnly) return;
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        const data = event.clipboardData;
        enqueue(
          helpers,
          (signal) => readEventPasteContent(data, signal),
          commitPaste,
          reportPasteError
        );
      },
      [enqueue, helpers, readOnly]
    );

    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
      const transfer = event.dataTransfer;
      const queued = enqueue(
        helpers,
        (): DroppedFiles => ({
          workspaceFile: getDraggedWorkspaceFile(transfer),
          files: Array.from(transfer.files),
        }),
        commitDrop,
        reportAttachmentError
      );
      if (queued) event.preventDefault();
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
