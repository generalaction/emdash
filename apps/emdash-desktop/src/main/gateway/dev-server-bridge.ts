import {
  formatHostRef,
  isLocalHostRef,
  type HostRef,
  type SerializedHostRef,
} from '@emdash/core/primitives/host/api';
import {
  runtimeResolveErrorAsError,
  type RuntimeBroker,
} from '@emdash/core/services/runtime-broker/api';
import { retry, retrySchedules } from '@emdash/shared/scheduling';
import { previewServerService } from '@core/features/preview-servers/api/node/preview-server-service-instance';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import { appScope } from '@main/bootstrap/core/app-scope';
import {
  createDevServerBridge,
  type DevServerBridge,
  type DevServerHostContext,
} from '@main/core/preview-servers/dev-server-bridge';
import type { HostAttachmentParticipant } from '@main/host/host-attachment-registry';
import { log } from '@main/lib/logger';

type CreateBridge = (
  client: Parameters<typeof createDevServerBridge>[0],
  hostContext: DevServerHostContext
) => Promise<DevServerBridge>;

type DevServerBridgeParticipantOptions = {
  readonly runtimes: Pick<RuntimeBroker, 'client'>;
  readonly createBridge: CreateBridge;
  readonly signal?: AbortSignal;
};

export function createDevServerBridgeParticipant({
  runtimes,
  createBridge,
  signal,
}: DevServerBridgeParticipantOptions): HostAttachmentParticipant {
  const bridges = new Map<SerializedHostRef, DevServerBridge>();

  const attachOnce = async (host: HostRef): Promise<DevServerBridge> => {
    const runtime = await runtimes.client(host);
    if (!runtime.success) throw runtimeResolveErrorAsError(runtime.error);
    return await createBridge(
      { terminals: runtime.data.terminals, scripts: runtime.data.scripts },
      hostContextFor(host)
    );
  };

  return {
    label: 'dev-server-bridge',
    async attach(host) {
      const key = formatHostRef(host);
      if (bridges.has(key)) return;

      const bridge = await retry(() => attachOnce(host), {
        schedule: retrySchedules.exponential({
          initialMs: 1_000,
          maxMs: 30_000,
          maxRetries: 2,
        }),
        signal,
        shouldRetry: isRetryableBridgeError,
        onRetry: ({ attempt, delayMs }) =>
          log.warn('Retrying dev-server bridge attach after error', {
            host: formatHostRef(host),
            attempt,
            delayMs,
          }),
      });
      bridges.set(key, bridge);
    },
    async detach(host) {
      const key = formatHostRef(host);
      const bridge = bridges.get(key);
      if (!bridge) return;
      bridges.delete(key);
      await bridge.dispose();
    },
  };
}

export function createDesktopDevServerBridgeParticipant(
  runtimes: Pick<RuntimeBroker, 'client'>,
  workspaceIdentity: Pick<WorkspaceIdentityService, 'findByPath'>
): HostAttachmentParticipant {
  return createDevServerBridgeParticipant({
    runtimes,
    signal: appScope.signal,
    createBridge: (client, hostContext) =>
      createDevServerBridge(
        client,
        {
          previewServers: previewServerService,
          resolveWorkspace: (workspacePath, host) =>
            workspaceIdentity.findByPath(workspacePath, host),
        },
        hostContext
      ),
  });
}

function hostContextFor(host: HostRef): DevServerHostContext {
  return isLocalHostRef(host)
    ? { transport: 'local' }
    : { transport: 'ssh', connectionId: host.id };
}

function isRetryableBridgeError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return status === undefined || status === 429 || status >= 500;
}
