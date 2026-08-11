import { err } from '@emdash/shared';
import type { Disposable } from '@emdash/shared/concurrency';
import { getPreviewServersClient } from '@core/features/preview-servers/api/browser/client';
import { Resource } from '@core/primitives/async-resource/browser/resource';
import type {
  ManualPreviewServerResult,
  PreviewServer,
  PreviewServerEvent,
  PreviewServerProtocol,
} from '@core/primitives/preview-servers/api';
import { previewServerUrl } from '@core/primitives/preview-servers/api';

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
        const client = await getPreviewServersClient();
        const servers = await client.listForWorkspace({ projectId, workspaceId });
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

  async forwardManual(input: ManualForwardInput): Promise<ManualPreviewServerResult> {
    if (!this.connectionId) {
      return err({
        type: 'not-ssh-workspace',
        message: 'Manual port forwarding requires a remote workspace',
      });
    }
    const client = await getPreviewServersClient();
    const result = await client.forwardManual({
      projectId: this.projectId,
      workspaceId: this.workspaceId,
      connectionId: this.connectionId,
      ...input,
    });
    if (result.success) {
      const next = new Map(this.serversResource.data ?? []);
      next.set(result.data.id, result.data);
      this.serversResource.setValue(next);
    }
    return result;
  }

  async restart(id: string): Promise<void> {
    const client = await getPreviewServersClient();
    await client.restart({ id });
  }

  async stop(id: string): Promise<void> {
    const client = await getPreviewServersClient();
    await client.stop({ id });
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
    const client = await getPreviewServersClient();
    const unsubscribe = await client.events.subscribe(undefined, {
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
