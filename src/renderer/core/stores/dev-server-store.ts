import { hostPreviewEventChannel } from '@shared/events/hostPreviewEvents';
import type { HostPreviewEvent } from '@shared/hostPreview';
import { events } from '@renderer/core/ipc';
import { Resource } from './resource';

export class DevServerStore {
  /**
   * Event-driven resource — starts empty, updated by `hostPreviewEventChannel`
   * events. Each event atomically replaces the map to trigger MobX reactivity.
   */
  readonly servers: Resource<Map<string, string>, HostPreviewEvent>;

  constructor(taskId: string, workspaceId: string) {
    this.servers = new Resource<Map<string, string>, HostPreviewEvent>(
      null,
      [
        {
          kind: 'event',
          subscribe: (handler) =>
            events.on(hostPreviewEventChannel, (event) => {
              if (event.taskId === taskId || event.taskId === workspaceId) {
                handler(event);
              }
            }),
          onEvent: (event, ctx) => {
            const next = new Map(ctx.data ?? []);
            if (event.type === 'url' && event.terminalId && event.url) {
              next.set(event.terminalId, event.url);
            } else if (event.type === 'exit' && event.terminalId) {
              next.delete(event.terminalId);
            }
            ctx.set(next);
          },
        },
      ],
      { init: new Map() }
    );

    this.servers.start();
  }

  get urls(): string[] {
    return Array.from(this.servers.data?.values() ?? []);
  }

  dispose(): void {
    this.servers.dispose();
  }
}
