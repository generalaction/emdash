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
  const retiredRunIds = useRef(new Set<string>());

  useEffect(() => {
    const offRequest = events.on(loopBrowserRequestChannel, (message) => {
      const parsed = loopBrowserRequestMessageSchema.safeParse(message);
      if (!parsed.success) return;
      setEntries((current) => {
        if (retiredRunIds.current.has(parsed.data.verificationRunId)) return current;
        const existing = current.get(parsed.data.verificationRunId);
        if (existing) return current;
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
        pendingClose.current.set(parsed.data.verificationRunId, parsed.data);
        retiredRunIds.current.add(parsed.data.verificationRunId);
        while (retiredRunIds.current.size > 100) {
          retiredRunIds.current.delete(retiredRunIds.current.values().next().value!);
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
          onBound={({ adapter }) => {
            const ready = loopBrowserReadyMessageSchema.safeParse({
              type: 'ready',
              verificationRunId: request.verificationRunId,
              browserId: request.browserId,
              projectId: request.projectId,
              taskId: request.taskId,
              workspaceId: request.workspaceId,
              partition: request.partition,
              allowedPreviewOrigin: request.allowedPreviewOrigin,
              currentUrl: adapter.currentUrl(),
              readyAt: new Date().toISOString(),
            });
            if (ready.success) events.emit(loopBrowserReadyChannel, ready.data);
          }}
          onDisposed={() => acknowledgeClose(request, pendingClose.current)}
        />
      ))}
    </>
  );
}

function acknowledgeClose(
  request: LoopBrowserRequestMessage,
  pending: Map<string, LoopBrowserCloseMessage>
): void {
  const close = pending.get(request.verificationRunId);
  if (!close || !sameLease(request, close)) return;
  pending.delete(request.verificationRunId);
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
