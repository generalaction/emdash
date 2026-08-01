import { ipcMain } from 'electron';
import { configureBrowserVerificationSession } from '@main/core/browser/browser-profile-session';
import {
  browserWebContentsRegistry,
  type VerificationActionExecution,
} from '@main/core/browser/browser-webcontents-registry';
import {
  NativeBrowserVerificationService,
  type NativeBrowserResult,
  type NativeBrowserVerificationSession,
} from '@main/core/browser/native-browser-verification-service';
import { previewServerService } from '@main/core/preview-servers/preview-server-service-instance';
import { events } from '@main/lib/events';
import type {
  LoopBrowserAction,
  LoopBrowserLease,
  LoopBrowserClosedMessage,
} from '@shared/core/loops/loop-browser-contracts';
import {
  loopBrowserActionChannel,
  loopBrowserClosedChannel,
  loopBrowserCloseChannel,
  loopBrowserReadyChannel,
  loopBrowserRequestChannel,
  loopBrowserResultChannel,
} from '@shared/events/loopBrowserEvents';

type TraceKind =
  | 'preview-registered'
  | 'host-request'
  | 'session-registered'
  | 'partition-configured'
  | 'renderer-ready'
  | 'ready-attested'
  | 'action-requested'
  | 'action-executed'
  | 'reconnect-paused'
  | 'close-requested'
  | 'renderer-closed'
  | 'session-cleaned'
  | 'start-cancelled';

type TraceEntry = {
  kind: TraceKind;
  verificationRunId?: string;
  browserId?: string;
  detail?: string;
};

type StartInput = {
  verificationRunId: string;
  projectId: string;
  taskId: string;
  workspaceId: string;
  previewServerId?: string;
};

type PendingStart = {
  controller: AbortController;
  result?: NativeBrowserResult<NativeBrowserVerificationSession>;
};

const trace: TraceEntry[] = [];
const pendingStarts = new Map<string, PendingStart>();
let registered = false;

const registry = {
  registerVerificationSession(lease: LoopBrowserLease): boolean {
    const success = browserWebContentsRegistry.registerVerificationSession(lease);
    if (success) record('session-registered', lease);
    return success;
  },
  isVerificationSessionReady(lease: LoopBrowserLease, currentUrl: string): boolean {
    const ready = browserWebContentsRegistry.isVerificationSessionReady(lease, currentUrl);
    if (ready) record('ready-attested', lease, currentUrl);
    return ready;
  },
  revokeVerificationSession: (lease: LoopBrowserLease): boolean =>
    browserWebContentsRegistry.revokeVerificationSession(lease),
  async performVerificationAction(
    lease: LoopBrowserLease,
    action: LoopBrowserAction
  ): Promise<VerificationActionExecution> {
    const result = await browserWebContentsRegistry.performVerificationAction(lease, action);
    record('action-executed', lease, action.kind);
    return result;
  },
  async forceCleanupVerificationSession(lease: LoopBrowserLease) {
    const result = await browserWebContentsRegistry.forceCleanupVerificationSession(lease);
    record(
      'session-cleaned',
      lease,
      result.partitionDataCleared ? 'partition-cleared' : 'retained'
    );
    return result;
  },
};

const service = new NativeBrowserVerificationService({
  previewServers: previewServerService,
  registry,
  transport: {
    emitRequest(message) {
      record('host-request', message, message.previewUrl);
      events.emit(loopBrowserRequestChannel, message);
    },
    emitAction(message) {
      record('action-requested', message, message.action.kind);
      events.emit(loopBrowserActionChannel, message);
    },
    emitResult: (message) => events.emit(loopBrowserResultChannel, message),
    emitClose(message) {
      record('close-requested', message, message.reason);
      events.emit(loopBrowserCloseChannel, message);
    },
    onReady: (listener) =>
      events.on(loopBrowserReadyChannel, (message) => {
        record('renderer-ready', message, message.currentUrl);
        listener(message);
      }),
    onClosed: (listener) =>
      events.on(loopBrowserClosedChannel, (message) => {
        record('renderer-closed', message, message.reason);
        listener(message);
      }),
  },
  configurePartition(partition, allowedOrigin) {
    const configured = configureBrowserVerificationSession(partition, allowedOrigin);
    if (configured !== false) {
      trace.push({ kind: 'partition-configured', detail: `${partition}:${allowedOrigin}` });
    }
    return configured;
  },
  previewPollIntervalMs: 25,
  previewTimeoutMs: 5_000,
  readyTimeoutMs: 10_000,
  closeTimeoutMs: 5_000,
});

export function registerLoopsElectronTestBridge(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle('loopsElectronTest.ping', () => ({ mode: 'loops-electron' as const }));
  ipcMain.handle(
    'loopsElectronTest.registerLocalPreview',
    async (
      _event,
      input: {
        projectId: string;
        workspaceId: string;
        port: number;
        urlPath?: string;
      }
    ) => {
      const server = await previewServerService.registerDetectedTarget({
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        transport: 'local',
        source: { kind: 'manual' },
        protocol: 'http:',
        host: '127.0.0.1',
        port: input.port,
        urlPath: input.urlPath ?? '/',
      });
      trace.push({ kind: 'preview-registered', detail: server.id });
      return server;
    }
  );
  ipcMain.handle('loopsElectronTest.start', (_event, input: StartInput) => service.start(input));
  ipcMain.handle('loopsElectronTest.beginStart', (_event, input: StartInput) => {
    if (pendingStarts.has(input.verificationRunId)) return false;
    const pending: PendingStart = { controller: new AbortController() };
    pendingStarts.set(input.verificationRunId, pending);
    void service
      .start({ ...input, signal: pending.controller.signal })
      .then((result) => (pending.result = result));
    return true;
  });
  ipcMain.handle('loopsElectronTest.cancelStart', (_event, verificationRunId: string) => {
    const pending = pendingStarts.get(verificationRunId);
    if (!pending) return false;
    record('start-cancelled', { verificationRunId });
    pending.controller.abort();
    return true;
  });
  ipcMain.handle('loopsElectronTest.getStartResult', (_event, verificationRunId: string) => {
    return pendingStarts.get(verificationRunId)?.result ?? null;
  });
  ipcMain.handle(
    'loopsElectronTest.performAction',
    (_event, input: { lease: LoopBrowserLease; actionId: string; action: LoopBrowserAction }) =>
      service.performAction({
        type: 'action',
        ...input.lease,
        actionId: input.actionId,
        action: input.action,
      })
  );
  ipcMain.handle('loopsElectronTest.pauseForReconnect', (_event, lease: LoopBrowserLease) => {
    const paused = service.pauseForReconnect(lease);
    if (paused) record('reconnect-paused', lease);
    return paused;
  });
  ipcMain.handle('loopsElectronTest.reconcilePreview', (_event, lease: LoopBrowserLease) =>
    service.reconcilePreview(lease)
  );
  ipcMain.handle(
    'loopsElectronTest.close',
    (_event, input: { lease: LoopBrowserLease; reason: LoopBrowserClosedMessage['reason'] }) =>
      service.close(input.lease, input.reason)
  );
  ipcMain.handle('loopsElectronTest.getTrace', () => [...trace]);
  ipcMain.handle('loopsElectronTest.clearTrace', () => {
    trace.length = 0;
  });
}

function record(
  kind: TraceKind,
  identity: Partial<Pick<LoopBrowserLease, 'verificationRunId' | 'browserId'>>,
  detail?: string
): void {
  trace.push({
    kind,
    verificationRunId: identity.verificationRunId,
    browserId: identity.browserId,
    detail,
  });
}
