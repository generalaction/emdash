import { randomUUID } from 'node:crypto';
import type {
  LoopBrowserAction,
  LoopBrowserActionMessage,
  LoopBrowserClosedMessage,
  LoopBrowserLease,
  LoopBrowserReadyMessage,
  LoopBrowserRequestMessage,
  LoopBrowserResultMessage,
} from '@shared/core/loops/loop-browser-contracts';
import {
  LOOP_BROWSER_DISPOSABLE_PARTITION_PREFIX,
  loopBrowserActionMessageSchema,
  loopBrowserClosedMessageSchema,
  loopBrowserReadyMessageSchema,
} from '@shared/core/loops/loop-browser-contracts';
import { previewServerUrl, type PreviewServer } from '@shared/core/preview-servers/types';
import type {
  VerificationActionExecution,
  VerificationCleanupResult,
} from './browser-webcontents-registry';

type LoopBrowserCloseReason = LoopBrowserClosedMessage['reason'];

export type NativeBrowserRegistryPort = {
  registerVerificationSession(lease: LoopBrowserLease): boolean;
  isVerificationSessionReady(lease: LoopBrowserLease, currentUrl: string): boolean;
  revokeVerificationSession(lease: LoopBrowserLease): boolean;
  performVerificationAction(
    lease: LoopBrowserLease,
    action: LoopBrowserAction
  ): Promise<VerificationActionExecution>;
  forceCleanupVerificationSession(lease: LoopBrowserLease): Promise<VerificationCleanupResult>;
};

export type NativeBrowserTransport = {
  emitRequest(message: LoopBrowserRequestMessage): void;
  emitAction(message: LoopBrowserActionMessage): void;
  emitResult(message: LoopBrowserResultMessage): void;
  emitClose(
    message: {
      type: 'close';
      reason: LoopBrowserCloseReason;
    } & LoopBrowserLease
  ): void;
  onReady(listener: (message: unknown) => void): () => void;
  onClosed(listener: (message: unknown) => void): () => void;
};

export type NativeBrowserVerificationStartInput = {
  verificationRunId: string;
  projectId: string;
  taskId: string;
  workspaceId: string;
  previewServerId?: string;
  signal?: AbortSignal;
};

export type NativeBrowserVerificationSession = {
  lease: LoopBrowserLease;
  previewServerId: string;
  previewUrl: string;
};

export type NativeBrowserVerificationError =
  | { kind: 'preview-timeout'; message: string }
  | { kind: 'preview-ambiguous'; message: string; previewServerIds: string[] }
  | { kind: 'preview-unavailable'; message: string }
  | { kind: 'session-collision'; message: string }
  | { kind: 'ready-timeout'; message: string }
  | { kind: 'cancelled'; message: string }
  | { kind: 'identity-mismatch'; message: string }
  | { kind: 'lease-closed'; message: string };

export type NativeBrowserResult<T> =
  | { success: true; data: T }
  | { success: false; error: NativeBrowserVerificationError };

export type NativeBrowserReconcileResult =
  | { kind: 'resumed'; session: NativeBrowserVerificationSession }
  | { kind: 'rotated'; session: NativeBrowserVerificationSession };

type ReplayEntry = {
  fingerprint: string;
  promise: Promise<VerificationActionExecution>;
};

type ActiveRecord = {
  session: NativeBrowserVerificationSession;
  state: 'preparing' | 'ready' | 'reconnecting' | 'closing';
  actionTail: Promise<void>;
  replays: Map<string, ReplayEntry>;
  closePromise?: Promise<LoopBrowserClosedMessage>;
};

type PreviewSelection = { server: PreviewServer; url: string };

const MAX_ACTION_REPLAYS = 256;

export class NativeBrowserVerificationService {
  private readonly active = new Map<string, ActiveRecord>();
  private readonly completedClose = new Map<string, LoopBrowserClosedMessage>();
  private readonly previewServers: {
    listForWorkspace(input: { projectId: string; workspaceId: string }): PreviewServer[];
  };
  private readonly registry: NativeBrowserRegistryPort;
  private readonly transport: NativeBrowserTransport;
  private readonly configurePartition: (partition: string, allowedOrigin: string) => boolean | void;
  private readonly idFactory: () => string;
  private readonly now: () => string;
  private readonly previewPollIntervalMs: number;
  private readonly previewTimeoutMs: number;
  private readonly readyTimeoutMs: number;
  private readonly closeTimeoutMs: number;

  constructor({
    previewServers,
    registry,
    transport,
    configurePartition,
    idFactory = randomUUID,
    now = () => new Date().toISOString(),
    previewPollIntervalMs = 50,
    previewTimeoutMs = 10_000,
    readyTimeoutMs = 15_000,
    closeTimeoutMs = 2_000,
  }: {
    previewServers: NativeBrowserVerificationService['previewServers'];
    registry: NativeBrowserRegistryPort;
    transport: NativeBrowserTransport;
    configurePartition: NativeBrowserVerificationService['configurePartition'];
    idFactory?: () => string;
    now?: () => string;
    previewPollIntervalMs?: number;
    previewTimeoutMs?: number;
    readyTimeoutMs?: number;
    closeTimeoutMs?: number;
  }) {
    this.previewServers = previewServers;
    this.registry = registry;
    this.transport = transport;
    this.configurePartition = configurePartition;
    this.idFactory = idFactory;
    this.now = now;
    this.previewPollIntervalMs = previewPollIntervalMs;
    this.previewTimeoutMs = previewTimeoutMs;
    this.readyTimeoutMs = readyTimeoutMs;
    this.closeTimeoutMs = closeTimeoutMs;
  }

  async start(
    input: NativeBrowserVerificationStartInput
  ): Promise<NativeBrowserResult<NativeBrowserVerificationSession>> {
    if (input.signal?.aborted) return failure('cancelled', 'Browser verification was cancelled');
    if (this.active.has(input.verificationRunId)) {
      return failure('session-collision', 'Browser verification run is already active');
    }

    const selection = await this.waitForPreview(input);
    if (!selection.success) return selection;

    const lease = this.createLease(input, selection.data.url);
    if (this.configurePartition(lease.partition, lease.allowedPreviewOrigin) === false) {
      return failure('session-collision', 'Browser verification partition is already owned');
    }
    if (!this.registry.registerVerificationSession(lease)) {
      return failure('session-collision', 'Browser verification identity is already owned');
    }

    const session: NativeBrowserVerificationSession = {
      lease,
      previewServerId: selection.data.server.id,
      previewUrl: selection.data.url,
    };
    const record: ActiveRecord = {
      session,
      state: 'preparing',
      actionTail: Promise.resolve(),
      replays: new Map(),
    };
    this.active.set(lease.verificationRunId, record);

    const ready = this.waitForReady(lease, input.signal);
    this.transport.emitRequest({
      type: 'request',
      ...lease,
      previewUrl: session.previewUrl,
      requestedAt: this.now(),
    });
    const readyResult = await ready;
    if (!readyResult.success) {
      await this.close(lease, readyResult.error.kind === 'cancelled' ? 'cancelled' : 'failed');
      return readyResult;
    }

    record.state = 'ready';
    return { success: true, data: session };
  }

  async performAction(message: LoopBrowserActionMessage): Promise<VerificationActionExecution> {
    const parsed = loopBrowserActionMessageSchema.safeParse(message);
    if (!parsed.success)
      return actionFailure('invalid-action', 'Browser action message is invalid');
    const record = this.active.get(parsed.data.verificationRunId);
    if (!record) return actionFailure('lease-closed', 'Browser verification lease is closed');
    if (!sameLease(record.session.lease, parsed.data)) {
      return actionFailure(
        'identity-mismatch',
        'Browser verification lease identity does not match'
      );
    }
    if (record.state !== 'ready') {
      return actionFailure(
        record.state === 'closing' ? 'lease-closed' : 'not-ready',
        record.state === 'closing'
          ? 'Browser verification lease is closed'
          : 'Browser verification is not ready'
      );
    }

    const fingerprint = JSON.stringify(parsed.data.action);
    const replay = record.replays.get(parsed.data.actionId);
    if (replay) {
      if (replay.fingerprint !== fingerprint) {
        return actionFailure('invalid-action', 'Action ID was reused with a different payload');
      }
      return await replay.promise;
    }

    const promise = record.actionTail.then(async () => {
      if (record.state !== 'ready') {
        return actionFailure('lease-closed', 'Browser verification lease is closed');
      }
      this.transport.emitAction(parsed.data);
      let execution: VerificationActionExecution;
      try {
        execution = await this.registry.performVerificationAction(
          record.session.lease,
          parsed.data.action
        );
      } catch {
        execution = actionFailure('action-failed', 'Browser action failed');
      }
      this.transport.emitResult({
        type: 'result',
        ...record.session.lease,
        actionId: parsed.data.actionId,
        result: execution.result,
      });
      return execution;
    });
    record.actionTail = promise.then(
      () => undefined,
      () => undefined
    );
    if (record.replays.size >= MAX_ACTION_REPLAYS) {
      record.replays.delete(record.replays.keys().next().value!);
    }
    record.replays.set(parsed.data.actionId, { fingerprint, promise });
    return await promise;
  }

  pauseForReconnect(lease: LoopBrowserLease): boolean {
    const record = this.active.get(lease.verificationRunId);
    if (!record || record.state !== 'ready' || !sameLease(record.session.lease, lease))
      return false;
    record.state = 'reconnecting';
    return true;
  }

  async reconcilePreview(
    lease: LoopBrowserLease
  ): Promise<NativeBrowserResult<NativeBrowserReconcileResult>> {
    const record = this.active.get(lease.verificationRunId);
    if (!record || !sameLease(record.session.lease, lease)) {
      return failure('identity-mismatch', 'Browser verification lease identity does not match');
    }
    if (record.state !== 'reconnecting') {
      return failure('lease-closed', 'Browser verification is not reconnecting');
    }

    const selected = await this.waitForPreview({
      verificationRunId: lease.verificationRunId,
      projectId: lease.projectId,
      taskId: lease.taskId,
      workspaceId: lease.workspaceId,
      previewServerId: record.session.previewServerId,
    });
    if (!selected.success) return selected;

    if (selected.data.url === record.session.previewUrl) {
      record.state = 'ready';
      return { success: true, data: { kind: 'resumed', session: record.session } };
    }
    const nextOrigin = new URL(selected.data.url).origin;
    if (nextOrigin === lease.allowedPreviewOrigin) {
      const navigation = await this.registry.performVerificationAction(lease, {
        kind: 'navigate',
        url: selected.data.url,
      });
      if (!navigation.result.ok) {
        return failure('preview-unavailable', 'Reconnected preview could not be loaded');
      }
      record.session = { ...record.session, previewUrl: selected.data.url };
      record.state = 'ready';
      return { success: true, data: { kind: 'resumed', session: record.session } };
    }

    await this.close(lease, 'origin-changed');
    const rotated = await this.start({
      verificationRunId: this.idFactory(),
      projectId: lease.projectId,
      taskId: lease.taskId,
      workspaceId: lease.workspaceId,
      previewServerId: selected.data.server.id,
    });
    if (!rotated.success) return rotated;
    return { success: true, data: { kind: 'rotated', session: rotated.data } };
  }

  async close(
    lease: LoopBrowserLease,
    reason: LoopBrowserCloseReason
  ): Promise<LoopBrowserClosedMessage> {
    const key = leaseKey(lease);
    const completed = this.completedClose.get(key);
    if (completed) return completed;
    const record = this.active.get(lease.verificationRunId);
    if (!record || !sameLease(record.session.lease, lease)) {
      return closedMessage(
        lease,
        reason,
        {
          partitionDataCleared: false,
          cleanupError: 'Browser verification lease is not active',
        },
        this.now()
      );
    }
    if (record.closePromise) return await record.closePromise;

    record.closePromise = this.closeRecord(record, reason);
    const result = await record.closePromise;
    this.completedClose.set(key, result);
    while (this.completedClose.size > 100) {
      this.completedClose.delete(this.completedClose.keys().next().value!);
    }
    return result;
  }

  private async closeRecord(
    record: ActiveRecord,
    reason: LoopBrowserCloseReason
  ): Promise<LoopBrowserClosedMessage> {
    const { lease } = record.session;
    record.state = 'closing';
    this.registry.revokeVerificationSession(lease);
    const closedAck = this.waitForClosed(lease, reason);
    this.transport.emitClose({ type: 'close', ...lease, reason });
    await closedAck;
    const cleanup = await this.registry.forceCleanupVerificationSession(lease);
    if (this.active.get(lease.verificationRunId) === record) {
      this.active.delete(lease.verificationRunId);
    }
    return closedMessage(lease, reason, cleanup, this.now());
  }

  private createLease(
    input: NativeBrowserVerificationStartInput,
    previewUrl: string
  ): LoopBrowserLease {
    const browserId = this.idFactory();
    const partitionId = this.idFactory().replace(/[^a-zA-Z0-9_-]+/g, '_');
    return {
      verificationRunId: input.verificationRunId,
      browserId,
      projectId: input.projectId,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      partition: `${LOOP_BROWSER_DISPOSABLE_PARTITION_PREFIX}${partitionId}`,
      allowedPreviewOrigin: new URL(previewUrl).origin,
    };
  }

  private async waitForPreview(
    input: NativeBrowserVerificationStartInput
  ): Promise<NativeBrowserResult<PreviewSelection>> {
    const deadline = Date.now() + this.previewTimeoutMs;
    while (true) {
      if (input.signal?.aborted) return failure('cancelled', 'Browser verification was cancelled');
      const selected = this.selectPreview(input);
      if (selected.success || selected.error.kind === 'preview-ambiguous') return selected;
      if (Date.now() >= deadline) {
        return failure('preview-timeout', 'Timed out waiting for a ready preview server');
      }
      await delay(this.previewPollIntervalMs, input.signal);
    }
  }

  private selectPreview(
    input: NativeBrowserVerificationStartInput
  ): NativeBrowserResult<PreviewSelection> {
    const servers = this.previewServers.listForWorkspace({
      projectId: input.projectId,
      workspaceId: input.workspaceId,
    });
    if (input.previewServerId) {
      const exact = servers.find((server) => server.id === input.previewServerId);
      const url = exact?.status.kind === 'ready' ? previewServerUrl(exact) : null;
      return exact && url
        ? { success: true, data: { server: exact, url } }
        : failure('preview-unavailable', 'Selected preview server is not ready');
    }

    const ready = servers.flatMap((server): PreviewSelection[] => {
      const url = server.status.kind === 'ready' ? previewServerUrl(server) : null;
      return url ? [{ server, url }] : [];
    });
    if (ready.length === 1) return { success: true, data: ready[0]! };
    if (ready.length > 1) {
      return {
        success: false,
        error: {
          kind: 'preview-ambiguous',
          message: 'Multiple preview servers are ready; select one explicitly',
          previewServerIds: ready.map(({ server }) => server.id),
        },
      };
    }
    return failure('preview-unavailable', 'No preview server is ready');
  }

  private waitForReady(
    lease: LoopBrowserLease,
    signal?: AbortSignal
  ): Promise<NativeBrowserResult<LoopBrowserReadyMessage>> {
    return new Promise((resolve) => {
      let settled = false;
      let off = () => {};
      const timer: { value?: ReturnType<typeof setTimeout> } = {};
      const finish = (result: NativeBrowserResult<LoopBrowserReadyMessage>) => {
        if (settled) return;
        settled = true;
        if (timer.value !== undefined) clearTimeout(timer.value);
        off();
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort = () => finish(failure('cancelled', 'Browser verification was cancelled'));
      const unsubscribe = this.transport.onReady((message) => {
        const parsed = loopBrowserReadyMessageSchema.safeParse(message);
        if (!parsed.success || !sameLease(lease, parsed.data)) return;
        if (!this.registry.isVerificationSessionReady(lease, parsed.data.currentUrl)) return;
        finish({ success: true, data: parsed.data });
      });
      off = unsubscribe;
      if (settled) {
        off();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      timer.value = setTimeout(
        () => finish(failure('ready-timeout', 'Timed out waiting for the browser host')),
        this.readyTimeoutMs
      );
    });
  }

  private waitForClosed(lease: LoopBrowserLease, reason: LoopBrowserCloseReason): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      let off = () => {};
      const timer: { value?: ReturnType<typeof setTimeout> } = {};
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer.value !== undefined) clearTimeout(timer.value);
        off();
        resolve();
      };
      const unsubscribe = this.transport.onClosed((message) => {
        const parsed = loopBrowserClosedMessageSchema.safeParse(message);
        if (!parsed.success || parsed.data.reason !== reason || !sameLease(lease, parsed.data))
          return;
        finish();
      });
      off = unsubscribe;
      if (settled) {
        off();
        return;
      }
      timer.value = setTimeout(finish, this.closeTimeoutMs);
    });
  }
}

function sameLease(expected: LoopBrowserLease, actual: LoopBrowserLease): boolean {
  return (
    expected.verificationRunId === actual.verificationRunId &&
    expected.browserId === actual.browserId &&
    expected.projectId === actual.projectId &&
    expected.taskId === actual.taskId &&
    expected.workspaceId === actual.workspaceId &&
    expected.partition === actual.partition &&
    expected.allowedPreviewOrigin === actual.allowedPreviewOrigin
  );
}

function leaseKey(lease: LoopBrowserLease): string {
  return [
    lease.verificationRunId,
    lease.browserId,
    lease.projectId,
    lease.taskId,
    lease.workspaceId,
    lease.partition,
    lease.allowedPreviewOrigin,
  ].join('\u0000');
}

function failure<K extends NativeBrowserVerificationError['kind']>(
  kind: K,
  message: string
): NativeBrowserResult<never> {
  return { success: false, error: { kind, message } as NativeBrowserVerificationError };
}

function actionFailure(
  kind: Extract<VerificationActionExecution['result'], { ok: false }>['error']['kind'],
  message: string
): VerificationActionExecution {
  return { result: { ok: false, error: { kind, message } } };
}

function closedMessage(
  lease: LoopBrowserLease,
  reason: LoopBrowserCloseReason,
  cleanup: VerificationCleanupResult,
  closedAt: string
): LoopBrowserClosedMessage {
  return {
    type: 'closed',
    ...lease,
    reason,
    partitionDataCleared: cleanup.partitionDataCleared,
    ...(cleanup.cleanupError ? { cleanupError: cleanup.cleanupError } : {}),
    closedAt,
  };
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timeout = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
    if (signal?.aborted) finish();
  });
}
