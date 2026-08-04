import { useEffect, useRef, useState } from 'react';
import { BrowserWebviewHost } from '@renderer/features/browser/browser-webview-host';
import { events } from '@renderer/lib/ipc';
import {
  loopBrowserCloseMessageSchema,
  loopBrowserReadyMessageSchema,
  loopBrowserRequestMessageSchema,
  type LoopBrowserCloseMessage,
  type LoopBrowserRequestMessage,
} from '@shared/core/loops/loop-browser-contracts';
import {
  loopBrowserClosedChannel,
  loopBrowserCloseChannel,
  loopBrowserReadyChannel,
  loopBrowserRequestChannel,
} from '@shared/events/loopBrowserEvents';

type HostEntry = { request: LoopBrowserRequestMessage };

export function LoopBrowserHost() {
  const [entries, setEntries] = useState<Map<string, HostEntry>>(() => new Map());
  const pendingClose = useRef(new Map<string, LoopBrowserCloseMessage>());
  const retiredLeases = useRef(new Set<string>());

  useEffect(() => {
    const offRequest = events.on(loopBrowserRequestChannel, (message) => {
      const parsed = loopBrowserRequestMessageSchema.safeParse(message);
      if (!parsed.success) return;
      setEntries((current) => {
        if (retiredLeases.current.has(lifecycleKey(parsed.data))) return current;
        const existing = current.get(parsed.data.verificationRunId);
        if (existing) {
          if (
            sameLease(existing.request, parsed.data) ||
            !sameVerificationOwner(existing.request, parsed.data) ||
            existing.request.browserId === parsed.data.browserId ||
            existing.request.partition === parsed.data.partition
          ) {
            return current;
          }
          const next = new Map(current);
          next.set(parsed.data.verificationRunId, { request: parsed.data });
          return next;
        }
        for (const entry of current.values()) {
          if (
            entry.request.browserId === parsed.data.browserId ||
            entry.request.partition === parsed.data.partition
          ) {
            return current;
          }
        }
        const next = new Map(current);
        next.set(parsed.data.verificationRunId, { request: parsed.data });
        return next;
      });
    });

    const offClose = events.on(loopBrowserCloseChannel, (message) => {
      const parsed = loopBrowserCloseMessageSchema.safeParse(message);
      if (!parsed.success) return;
      setEntries((current) => {
        const existing = current.get(parsed.data.verificationRunId);
        if (!existing || !sameLease(existing.request, parsed.data)) return current;
        const key = lifecycleKey(existing.request);
        pendingClose.current.set(key, parsed.data);
        retiredLeases.current.add(key);
        while (retiredLeases.current.size > 100) {
          retiredLeases.current.delete(retiredLeases.current.values().next().value!);
        }
        const next = new Map(current);
        next.delete(parsed.data.verificationRunId);
        return next;
      });
    });

    return () => {
      offRequest();
      offClose();
    };
  }, []);

  return (
    <>
      {Array.from(entries.values()).map(({ request }) => (
        <BrowserWebviewHost
          key={lifecycleKey(request)}
          lifecycleKey={lifecycleKey(request)}
          browserId={request.browserId}
          partition={request.partition}
          src={request.previewUrl}
          registration="main"
          hidden
          allowPopups={false}
          onBound={({ adapter }) => emitReady(request, adapter.currentUrl())}
          onLocationChange={({ adapter }) => emitReady(request, adapter.currentUrl())}
          onDisposed={() => acknowledgeClose(request, pendingClose.current)}
        />
      ))}
    </>
  );
}

function emitReady(request: LoopBrowserRequestMessage, currentUrl: string): void {
  const ready = loopBrowserReadyMessageSchema.safeParse({
    type: 'ready',
    verificationRunId: request.verificationRunId,
    browserId: request.browserId,
    projectId: request.projectId,
    taskId: request.taskId,
    workspaceId: request.workspaceId,
    partition: request.partition,
    allowedPreviewOrigin: request.allowedPreviewOrigin,
    currentUrl,
    readyAt: new Date().toISOString(),
  });
  if (ready.success) events.emit(loopBrowserReadyChannel, ready.data);
}

function acknowledgeClose(
  request: LoopBrowserRequestMessage,
  pending: Map<string, LoopBrowserCloseMessage>
): void {
  const key = lifecycleKey(request);
  const close = pending.get(key);
  if (!close || !sameLease(request, close)) return;
  pending.delete(key);
  events.emit(loopBrowserClosedChannel, {
    type: 'closed',
    verificationRunId: close.verificationRunId,
    browserId: close.browserId,
    projectId: close.projectId,
    taskId: close.taskId,
    workspaceId: close.workspaceId,
    partition: close.partition,
    allowedPreviewOrigin: close.allowedPreviewOrigin,
    reason: close.reason,
    partitionDataCleared: false,
    closedAt: new Date().toISOString(),
  });
}

function lifecycleKey(request: LoopBrowserRequestMessage): string {
  return [
    request.verificationRunId,
    request.browserId,
    request.projectId,
    request.taskId,
    request.workspaceId,
    request.partition,
    request.allowedPreviewOrigin,
  ].join(':');
}

function sameLease(
  left: Pick<
    LoopBrowserRequestMessage,
    | 'verificationRunId'
    | 'browserId'
    | 'projectId'
    | 'taskId'
    | 'workspaceId'
    | 'partition'
    | 'allowedPreviewOrigin'
  >,
  right: Pick<
    LoopBrowserRequestMessage,
    | 'verificationRunId'
    | 'browserId'
    | 'projectId'
    | 'taskId'
    | 'workspaceId'
    | 'partition'
    | 'allowedPreviewOrigin'
  >
): boolean {
  return (
    left.verificationRunId === right.verificationRunId &&
    left.browserId === right.browserId &&
    left.projectId === right.projectId &&
    left.taskId === right.taskId &&
    left.workspaceId === right.workspaceId &&
    left.partition === right.partition &&
    left.allowedPreviewOrigin === right.allowedPreviewOrigin
  );
}

function sameVerificationOwner(
  left: Pick<
    LoopBrowserRequestMessage,
    'verificationRunId' | 'projectId' | 'taskId' | 'workspaceId' | 'allowedPreviewOrigin'
  >,
  right: Pick<
    LoopBrowserRequestMessage,
    'verificationRunId' | 'projectId' | 'taskId' | 'workspaceId' | 'allowedPreviewOrigin'
  >
): boolean {
  return (
    left.verificationRunId === right.verificationRunId &&
    left.projectId === right.projectId &&
    left.taskId === right.taskId &&
    left.workspaceId === right.workspaceId &&
    left.allowedPreviewOrigin === right.allowedPreviewOrigin
  );
}
