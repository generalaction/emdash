import { EventEmitter } from 'node:events';
import type { HostPreviewEvent } from '@shared/hostPreview';

/**
 * Main-process Node bus for host preview (dev server) events.
 *
 * The shared `events` channel is IPC main → renderer; main itself can't
 * listen. Modules that need to react to dev-server URLs from inside main
 * (e.g. the internal MCP loopback's `workspace_dev_servers` tool)
 * subscribe here. dev-server-watcher publishes to this bus alongside the
 * existing IPC emit.
 */
class HostPreviewBus extends EventEmitter {
  emitEvent(event: HostPreviewEvent): void {
    this.emit('event', event);
  }

  onEvent(cb: (event: HostPreviewEvent) => void): () => void {
    this.on('event', cb);
    return () => this.off('event', cb);
  }
}

export const hostPreviewBus = new HostPreviewBus();
hostPreviewBus.setMaxListeners(50);
