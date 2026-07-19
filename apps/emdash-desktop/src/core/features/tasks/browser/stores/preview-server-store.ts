import { err } from '@emdash/shared';
import type { Disposable } from '@emdash/shared/concurrency';
import { remoteRuntimeUnavailable } from '@core/features/runtime-routing/api';
import type {
  ManualPreviewServerResult,
  PreviewServer,
  PreviewServerEvent,
  PreviewServerProtocol,
} from '@core/primitives/preview-servers/api';
import { previewServerUrl } from '@core/primitives/preview-servers/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { Resource } from '@renderer/lib/stores/resource';

type PreviewServerStoreOptions = {
  projectId: string;
  workspaceId: string;
  connectionId?: string;
};

type ManualForwardInput = {
  protocol: PreviewServerProtocol;
  remotePort: number;
  preferredLocalPort?: number;
};

export class PreviewServerStore implements Disposable {
  readonly serversResource: Resource<Map<string, PreviewServer>, PreviewServerEvent>;

  private readonly projectId: string;
  private readonly workspaceId: string;
  private readonly connectionId: string | undefined;
  private started = false;
  private unsubscribeEvents: (() => void) | undefined;

  constructor({ projectId, workspaceId, connectionId }: PreviewServerStoreOptions) {
    this.projectId = projectId;
    this.workspaceId = workspaceId;
    this.connectionId = connectionId;
    this.serversResource = new Resource<Map<string, PreviewServer>, PreviewServerEvent>(
      async () => {
        const client = await getDesktopWireClient();
        const servers = await client.previewServers.listForWorkspace({ projectId, workspaceId });
        return new Map(servers.map((server) => [server.id, server]));
      },
      [],
      { init: new Map(), refData: true }
    );
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.serversResource.start();
    void this.subscribeEvents();
  }

  get servers(): PreviewServer[] {
    return Array.from(this.serversResource.data?.values() ?? []).sort(comparePreviewServers);
  }

  get urls(): string[] {
    return this.servers
      .map((server) => previewServerUrl(server))
      .filter((url): url is string => url !== null);
  }

  async forwardManual(_input: ManualForwardInput): Promise<ManualPreviewServerResult> {
    if (!this.connectionId) {
      return err({
        type: 'not-ssh-workspace',
        message: 'Manual port forwarding requires a remote workspace',
      });
    }
    return err(remoteRuntimeUnavailable(this.connectionId, 'port-forwarding'));
  }

  async restart(_id: string): Promise<void> {
    // Forwarded preview records are retained for renderer reuse, but the data
    // plane will be reimplemented when the workspace-server client is available.
  }

  async stop(id: string): Promise<void> {
    const client = await getDesktopWireClient();
    await client.previewServers.stop({ id });
    const next = new Map(this.serversResource.data ?? []);
    next.delete(id);
    this.serversResource.setValue(next);
  }

  dispose(): void {
    this.started = false;
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = undefined;
    this.serversResource.dispose();
  }

  private async subscribeEvents(): Promise<void> {
    const client = await getDesktopWireClient();
    const unsubscribe = await client.previewServers.events.subscribe(undefined, {
      onEvent: (event) => {
        const next = new Map(this.serversResource.data ?? []);
        if (event.type === 'upsert') {
          if (
            event.server.projectId !== this.projectId ||
            event.server.workspaceId !== this.workspaceId
          ) {
            return;
          }
          next.set(event.server.id, event.server);
        } else {
          next.delete(event.id);
        }
        this.serversResource.setValue(next);
      },
      onGap: () => this.serversResource.invalidate(),
    });
    if (!this.started) {
      unsubscribe();
      return;
    }
    this.unsubscribeEvents = unsubscribe;
  }
}

function comparePreviewServers(a: PreviewServer, b: PreviewServer): number {
  const aPort = a.kind === 'forwarded' ? a.remotePort : a.port;
  const bPort = b.kind === 'forwarded' ? b.remotePort : b.port;
  if (aPort !== bPort) return aPort - bPort;
  return a.id.localeCompare(b.id);
}
