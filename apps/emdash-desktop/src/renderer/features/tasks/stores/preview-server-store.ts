import { events, rpc } from '@renderer/lib/ipc';
import type { IDisposable } from '@renderer/lib/stores/lifecycle';
import { Resource } from '@renderer/lib/stores/resource';
import { previewServerEventChannel } from '@shared/core/preview-servers/events';
import type {
  ManualPreviewServerRequest,
  ManualPreviewServerResult,
  PreviewServer,
  PreviewServerEvent,
  PreviewServerProtocol,
} from '@shared/core/preview-servers/types';
import { previewServerUrl } from '@shared/core/preview-servers/types';
import { err } from '@shared/lib/result';

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

export class PreviewServerStore implements IDisposable {
  readonly serversResource: Resource<Map<string, PreviewServer>, PreviewServerEvent>;

  private readonly projectId: string;
  private readonly workspaceId: string;
  private readonly connectionId: string | undefined;
  private started = false;

  constructor({ projectId, workspaceId, connectionId }: PreviewServerStoreOptions) {
    this.projectId = projectId;
    this.workspaceId = workspaceId;
    this.connectionId = connectionId;
    this.serversResource = new Resource<Map<string, PreviewServer>, PreviewServerEvent>(
      async () => {
        const servers = await rpc.previewServers.listForWorkspace({ projectId, workspaceId });
        return new Map(servers.map((server) => [server.id, server]));
      },
      [
        {
          kind: 'event',
          subscribe: (handler) => events.on(previewServerEventChannel, handler),
          onEvent: (event, ctx) => {
            const next = new Map(ctx.data ?? []);
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
            ctx.set(next);
          },
        },
      ],
      { init: new Map(), refData: true }
    );
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.serversResource.start();
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
        message: 'Manual port forwarding requires an SSH workspace',
      });
    }
    const request: ManualPreviewServerRequest = {
      projectId: this.projectId,
      workspaceId: this.workspaceId,
      connectionId: this.connectionId,
      protocol: input.protocol,
      remotePort: input.remotePort,
      ...(input.preferredLocalPort ? { preferredLocalPort: input.preferredLocalPort } : {}),
    };
    const result = await rpc.previewServers.forwardManual(request);
    if (result.success) this.upsert(result.data);
    return result;
  }

  async restart(id: string): Promise<void> {
    const server = await rpc.previewServers.restart(id);
    if (server) this.upsert(server);
  }

  async stop(id: string): Promise<void> {
    await rpc.previewServers.stop(id);
    const next = new Map(this.serversResource.data ?? []);
    next.delete(id);
    this.serversResource.setValue(next);
  }

  dispose(): void {
    this.serversResource.dispose();
  }

  private upsert(server: PreviewServer): void {
    if (server.projectId !== this.projectId || server.workspaceId !== this.workspaceId) return;
    const next = new Map(this.serversResource.data ?? []);
    next.set(server.id, server);
    this.serversResource.setValue(next);
  }
}

function comparePreviewServers(a: PreviewServer, b: PreviewServer): number {
  const aPort = a.kind === 'forwarded' ? a.remotePort : a.port;
  const bPort = b.kind === 'forwarded' ? b.remotePort : b.port;
  if (aPort !== bPort) return aPort - bPort;
  return a.id.localeCompare(b.id);
}
