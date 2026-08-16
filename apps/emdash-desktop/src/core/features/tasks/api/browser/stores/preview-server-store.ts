import { err } from '@emdash/shared';
import type { Disposable } from '@emdash/shared/concurrency';
import { computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import { getPreviewServersClient } from '@core/features/preview-servers/api/browser/client';
import {
  classifyLiveRuntimeObservation,
  type LiveRuntimeObservation,
} from '@core/features/projects/api/browser/live-runtime-observation';
import type { ProjectHostAccess } from '@core/features/projects/api/browser/stores/project-context';
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
  hostAccess?: ProjectHostAccess;
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
  readonly hostAccess: ProjectHostAccess | undefined;
  private started = false;
  private hasObserved = false;
  private unsubscribeEvents: (() => void) | undefined;
  private readonly disposeHostReaction: () => void;

  constructor({ projectId, workspaceId, connectionId, hostAccess }: PreviewServerStoreOptions) {
    this.projectId = projectId;
    this.workspaceId = workspaceId;
    this.connectionId = connectionId;
    this.hostAccess = hostAccess;
    this.serversResource = new Resource<Map<string, PreviewServer>, PreviewServerEvent>(
      async () => {
        if (this.hostAccess?.liveAction.kind === 'disabled') {
          throw new Error('Live preview data is unavailable for this Project.');
        }
        const client = await getPreviewServersClient();
        const result = await client.listForWorkspace({ projectId, workspaceId });
        if (!result.success) throw new Error(result.error.message);
        const servers = result.data;
        runInAction(() => {
          this.hasObserved = true;
        });
        return new Map(servers.map((server) => [server.id, server]));
      },
      [],
      { init: new Map(), refData: true }
    );
    makeObservable<PreviewServerStore, 'hasObserved'>(this, {
      hasObserved: observable,
      observation: computed,
    });
    this.disposeHostReaction = reaction(
      () => this.hostAccess?.state,
      (state) => {
        if (!this.started) return;
        if (state !== undefined && state.kind !== 'ready') {
          this.unsubscribeEvents?.();
          this.unsubscribeEvents = undefined;
          return;
        }
        void this.serversResource.load();
        if (!this.unsubscribeEvents) void this.subscribeEvents();
      }
    );
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.hostAccess?.liveAction.kind !== 'disabled') {
      void this.serversResource.load();
      void this.subscribeEvents();
    }
  }

  get servers(): PreviewServer[] {
    return Array.from(this.serversResource.data?.values() ?? []).sort(comparePreviewServers);
  }

  get urls(): string[] {
    return this.servers
      .map((server) => previewServerUrl(server))
      .filter((url): url is string => url !== null);
  }

  get observation(): LiveRuntimeObservation<PreviewServer[]> {
    return classifyLiveRuntimeObservation(
      this.hostAccess?.state ?? { kind: 'ready', hostGeneration: 0 },
      this.hasObserved ? this.servers : undefined
    );
  }

  async forwardManual(input: ManualForwardInput): Promise<ManualPreviewServerResult> {
    if (this.hostAccess?.liveAction.kind === 'disabled') {
      const state = this.hostAccess.liveAction.state;
      return err({
        type: 'project-unavailable',
        projectId: this.projectId,
        reason: state.kind !== 'ready' ? state.situation : state.kind,
        message: 'Live actions are unavailable for this Project.',
      });
    }
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
    if (this.hostAccess?.liveAction.kind === 'disabled') return;
    const client = await getPreviewServersClient();
    const result = await client.restart({ id });
    if (!result.success) throw new Error(result.error.message);
  }

  async stop(id: string): Promise<void> {
    if (this.hostAccess?.liveAction.kind === 'disabled') return;
    const client = await getPreviewServersClient();
    const result = await client.stop({ id });
    if (!result.success) throw new Error(result.error.message);
    const next = new Map(this.serversResource.data ?? []);
    next.delete(id);
    this.serversResource.setValue(next);
  }

  dispose(): void {
    this.disposeHostReaction();
    this.started = false;
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = undefined;
    this.serversResource.dispose();
  }

  private async subscribeEvents(): Promise<void> {
    if (this.hostAccess?.liveAction.kind === 'disabled') return;
    const client = await getPreviewServersClient();
    const unsubscribe = await client.events.subscribe(undefined, {
      onEvent: (event) => {
        runInAction(() => {
          this.hasObserved = true;
        });
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
