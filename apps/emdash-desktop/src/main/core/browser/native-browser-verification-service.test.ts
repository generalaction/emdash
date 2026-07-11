import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LoopBrowserActionMessage,
  LoopBrowserActionResult,
  LoopBrowserClosedMessage,
  LoopBrowserCloseMessage,
  LoopBrowserLease,
  LoopBrowserReadyMessage,
  LoopBrowserRequestMessage,
  LoopBrowserResultMessage,
} from '@shared/core/loops/loop-browser-contracts';
import type { PreviewServer } from '@shared/core/preview-servers/types';
import {
  NativeBrowserVerificationService,
  type NativeBrowserRegistryPort,
  type NativeBrowserTransport,
} from './native-browser-verification-service';

const directPreview: PreviewServer = {
  id: 'preview-direct',
  kind: 'direct',
  projectId: 'project-1',
  workspaceId: 'workspace-1',
  source: { kind: 'manual' },
  protocol: 'http:',
  host: '127.0.0.1',
  port: 4173,
  urlPath: '/settings',
  status: { kind: 'ready' },
};

const sshPreview: PreviewServer = {
  id: 'preview-ssh',
  kind: 'forwarded',
  projectId: 'project-1',
  workspaceId: 'workspace-1',
  source: { kind: 'terminal-output', terminalId: 'terminal-1' },
  protocol: 'http:',
  connectionId: 'ssh-1',
  remotePort: 4173,
  localPort: 54321,
  urlPath: '/app',
  status: { kind: 'ready' },
};

class FakeTransport implements NativeBrowserTransport {
  readonly requests: LoopBrowserRequestMessage[] = [];
  readonly actions: LoopBrowserActionMessage[] = [];
  readonly results: LoopBrowserResultMessage[] = [];
  readonly closes: LoopBrowserCloseMessage[] = [];
  readonly order: string[] = [];
  private readonly readyListeners = new Set<(message: unknown) => void>();
  private readonly closedListeners = new Set<(message: unknown) => void>();

  emitRequest(message: LoopBrowserRequestMessage): void {
    this.requests.push(message);
    this.order.push('request');
  }

  emitAction(message: LoopBrowserActionMessage): void {
    this.actions.push(message);
    this.order.push('action');
  }

  emitResult(message: LoopBrowserResultMessage): void {
    this.results.push(message);
    this.order.push('result');
  }

  emitClose(message: LoopBrowserCloseMessage): void {
    this.closes.push(message);
    this.order.push('close');
  }

  onReady(listener: (message: unknown) => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  onClosed(listener: (message: unknown) => void): () => void {
    this.closedListeners.add(listener);
    return () => this.closedListeners.delete(listener);
  }

  ready(message: unknown): void {
    for (const listener of this.readyListeners) listener(message);
  }

  closed(message: unknown): void {
    for (const listener of this.closedListeners) listener(message);
  }
}

function readyFor(request: LoopBrowserRequestMessage): LoopBrowserReadyMessage {
  return {
    type: 'ready',
    verificationRunId: request.verificationRunId,
    browserId: request.browserId,
    projectId: request.projectId,
    taskId: request.taskId,
    workspaceId: request.workspaceId,
    partition: request.partition,
    allowedPreviewOrigin: request.allowedPreviewOrigin,
    currentUrl: request.previewUrl,
    readyAt: '2026-07-11T12:00:01.000Z',
  };
}

function closedFor(
  lease: LoopBrowserLease,
  reason: LoopBrowserClosedMessage['reason'] = 'completed'
): LoopBrowserClosedMessage {
  return {
    type: 'closed',
    ...lease,
    reason,
    partitionDataCleared: true,
    closedAt: '2026-07-11T12:00:02.000Z',
  };
}

describe('NativeBrowserVerificationService', () => {
  let previews: PreviewServer[];
  let transport: FakeTransport;
  let registry: NativeBrowserRegistryPort;
  let service: NativeBrowserVerificationService;
  let ids: string[];

  beforeEach(() => {
    vi.useRealTimers();
    previews = [directPreview];
    transport = new FakeTransport();
    ids = ['browser-1', 'partition-1', 'rotated-run', 'browser-2', 'partition-2'];
    registry = {
      registerVerificationSession: vi.fn(() => true),
      isVerificationSessionReady: vi.fn(() => true),
      revokeVerificationSession: vi.fn(() => true),
      performVerificationAction: vi.fn(async () => ({
        result: {
          ok: true,
          observation: {
            kind: 'interaction',
            currentUrl: 'http://127.0.0.1:4173/settings',
          },
        } satisfies LoopBrowserActionResult,
      })),
      forceCleanupVerificationSession: vi.fn(async () => ({ partitionDataCleared: true })),
    };
    service = new NativeBrowserVerificationService({
      previewServers: {
        listForWorkspace: () => previews,
      },
      registry,
      transport,
      configurePartition: vi.fn(),
      idFactory: () => ids.shift() ?? 'fallback-id',
      now: () => '2026-07-11T12:00:00.000Z',
      previewPollIntervalMs: 5,
      previewTimeoutMs: 25,
      readyTimeoutMs: 500,
      closeTimeoutMs: 500,
    });
  });

  it('selects one preview and preserves an SSH forwarded local URL as-is', async () => {
    previews = [sshPreview];
    const pending = service.start({
      verificationRunId: 'run-1',
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
    });
    await vi.waitFor(() => expect(transport.requests).toHaveLength(1));
    expect(transport.requests[0]?.previewUrl).toBe('http://127.0.0.1:54321/app');
    transport.ready(readyFor(transport.requests[0]!));

    await expect(pending).resolves.toMatchObject({
      success: true,
      data: {
        previewServerId: 'preview-ssh',
        previewUrl: 'http://127.0.0.1:54321/app',
      },
    });
  });

  it('waits for zero previews and returns a typed timeout', async () => {
    vi.useFakeTimers();
    previews = [];
    const pending = service.start({
      verificationRunId: 'run-1',
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
    });
    await vi.advanceTimersByTimeAsync(30);
    await expect(pending).resolves.toMatchObject({
      success: false,
      error: { kind: 'preview-timeout' },
    });
  });

  it('requires an exact preview id when multiple ready previews exist', async () => {
    previews = [directPreview, { ...directPreview, id: 'preview-2', port: 5173 }];
    await expect(
      service.start({
        verificationRunId: 'run-1',
        projectId: 'project-1',
        taskId: 'task-1',
        workspaceId: 'workspace-1',
      })
    ).resolves.toMatchObject({
      success: false,
      error: { kind: 'preview-ambiguous', previewServerIds: ['preview-direct', 'preview-2'] },
    });
  });

  it('ignores forged ready messages and serializes replay-safe actions', async () => {
    const pending = service.start({
      verificationRunId: 'run-1',
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
    });
    await vi.waitFor(() => expect(transport.requests).toHaveLength(1));
    vi.mocked(registry.isVerificationSessionReady).mockReturnValueOnce(false);
    transport.ready({ ...readyFor(transport.requests[0]!), workspaceId: 'forged-workspace' });
    transport.ready(readyFor(transport.requests[0]!));
    await Promise.resolve();
    expect(vi.mocked(registry.isVerificationSessionReady)).toHaveBeenCalledOnce();
    transport.ready(readyFor(transport.requests[0]!));
    const started = await pending;
    expect(started.success).toBe(true);
    if (!started.success) return;

    const message: LoopBrowserActionMessage = {
      type: 'action',
      ...started.data.lease,
      actionId: 'action-1',
      action: { kind: 'click', target: { role: 'button', name: 'Save' } },
    };
    const [first, replay] = await Promise.all([
      service.performAction(message),
      service.performAction(message),
    ]);

    expect(registry.performVerificationAction).toHaveBeenCalledTimes(1);
    expect(replay).toEqual(first);
    expect(transport.actions).toEqual([message]);
    expect(transport.results).toHaveLength(1);
    await expect(
      service.performAction({ ...message, workspaceId: 'stale-workspace', actionId: 'action-2' })
    ).resolves.toMatchObject({ result: { ok: false, error: { kind: 'identity-mismatch' } } });
  });

  it('closes and clears a mounted lease when startup is cancelled after request', async () => {
    const controller = new AbortController();
    const pending = service.start({
      verificationRunId: 'run-1',
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(transport.requests).toHaveLength(1));

    controller.abort();
    await vi.waitFor(() => expect(transport.closes).toHaveLength(1));
    const lease = transport.requests[0]!;
    expect(transport.closes[0]).toMatchObject({ reason: 'cancelled', browserId: lease.browserId });
    transport.closed({
      ...transport.closes[0]!,
      type: 'closed',
      partitionDataCleared: false,
      closedAt: '2026-07-11T12:00:02.000Z',
    });

    await expect(pending).resolves.toMatchObject({
      success: false,
      error: { kind: 'cancelled' },
    });
    expect(registry.revokeVerificationSession).toHaveBeenCalledWith(
      expect.objectContaining({ browserId: lease.browserId })
    );
    expect(registry.forceCleanupVerificationSession).toHaveBeenCalledWith(
      expect.objectContaining({ browserId: lease.browserId })
    );
  });

  it('bounds completed action replay entries', async () => {
    const pending = service.start({
      verificationRunId: 'run-1',
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
    });
    await vi.waitFor(() => expect(transport.requests).toHaveLength(1));
    transport.ready(readyFor(transport.requests[0]!));
    const started = await pending;
    expect(started.success).toBe(true);
    if (!started.success) return;

    for (let index = 0; index <= 256; index += 1) {
      await service.performAction({
        type: 'action',
        ...started.data.lease,
        actionId: `action-${index}`,
        action: { kind: 'accessibility-snapshot' },
      });
    }
    await service.performAction({
      type: 'action',
      ...started.data.lease,
      actionId: 'action-0',
      action: { kind: 'accessibility-snapshot' },
    });

    expect(registry.performVerificationAction).toHaveBeenCalledTimes(258);
  });

  it('revokes before close acknowledgement and forces idempotent cleanup', async () => {
    const pending = service.start({
      verificationRunId: 'run-1',
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
    });
    await vi.waitFor(() => expect(transport.requests).toHaveLength(1));
    transport.ready(readyFor(transport.requests[0]!));
    const started = await pending;
    expect(started.success).toBe(true);
    if (!started.success) return;

    vi.mocked(registry.revokeVerificationSession).mockImplementation(() => {
      transport.order.push('revoke');
      return true;
    });
    vi.mocked(registry.forceCleanupVerificationSession).mockImplementation(async () => {
      transport.order.push('cleanup');
      return { partitionDataCleared: true };
    });

    const closing = service.close(started.data.lease, 'completed');
    await vi.waitFor(() => expect(transport.closes).toHaveLength(1));
    transport.closed(closedFor(started.data.lease));
    const first = await closing;
    const replay = await service.close(started.data.lease, 'completed');

    expect(transport.order.slice(-3)).toEqual(['revoke', 'close', 'cleanup']);
    expect(first).toMatchObject({ partitionDataCleared: true });
    expect(replay).toEqual(first);
    expect(registry.forceCleanupVerificationSession).toHaveBeenCalledTimes(1);
  });

  it('pauses on reconnect, resumes an identical URL, and rotates an origin change', async () => {
    const pending = service.start({
      verificationRunId: 'run-1',
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
    });
    await vi.waitFor(() => expect(transport.requests).toHaveLength(1));
    transport.ready(readyFor(transport.requests[0]!));
    const started = await pending;
    expect(started.success).toBe(true);
    if (!started.success) return;

    expect(service.pauseForReconnect(started.data.lease)).toBe(true);
    const pausedAction: LoopBrowserActionMessage = {
      type: 'action',
      ...started.data.lease,
      actionId: 'paused-action',
      action: { kind: 'accessibility-snapshot' },
    };
    await expect(service.performAction(pausedAction)).resolves.toMatchObject({
      result: { ok: false, error: { kind: 'not-ready' } },
    });
    await expect(service.reconcilePreview(started.data.lease)).resolves.toMatchObject({
      success: true,
      data: { kind: 'resumed' },
    });

    expect(service.pauseForReconnect(started.data.lease)).toBe(true);
    previews = [{ ...directPreview, port: 5173 }];
    const rotating = service.reconcilePreview(started.data.lease);
    await vi.waitFor(() => expect(transport.closes.at(-1)?.reason).toBe('origin-changed'));
    transport.closed(closedFor(started.data.lease, 'origin-changed'));
    await vi.waitFor(() => expect(transport.requests).toHaveLength(2));
    expect(transport.requests[1]).toMatchObject({
      verificationRunId: 'rotated-run',
      browserId: 'browser-2',
      allowedPreviewOrigin: 'http://127.0.0.1:5173',
    });
    transport.ready(readyFor(transport.requests[1]!));

    await expect(rotating).resolves.toMatchObject({
      success: true,
      data: { kind: 'rotated', session: { lease: { verificationRunId: 'rotated-run' } } },
    });
  });
});
