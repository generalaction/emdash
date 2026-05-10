import type { HostPreviewEvent } from '@shared/hostPreview';
import { hostPreviewBus } from '@main/core/terminals/host-preview-bus';

interface DevServerEntry {
  taskId: string;
  terminalId: string;
  url: string;
  detectedAt: number;
}

/**
 * Aggregates `hostPreviewBus` events into a queryable per-task map of
 * running dev server URLs. Used by the `workspace_dev_servers` MCP tool.
 *
 * One module-level instance keyed by terminalId; multiple URLs per task are
 * possible (one terminal per dev server). When the watcher emits `exit`,
 * the entry is dropped.
 */
export class DevServerTracker {
  private readonly entries = new Map<string, DevServerEntry>(); // key = terminalId
  private dispose: (() => void) | null = null;

  start(): void {
    if (this.dispose) return;
    this.dispose = hostPreviewBus.onEvent((event) => this.ingest(event));
  }

  stop(): void {
    this.dispose?.();
    this.dispose = null;
    this.entries.clear();
  }

  listForTask(taskId: string): DevServerEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.taskId === taskId);
  }

  private ingest(event: HostPreviewEvent): void {
    if (!event.terminalId) return;
    if (event.type === 'url' && event.url) {
      this.entries.set(event.terminalId, {
        taskId: event.taskId,
        terminalId: event.terminalId,
        url: event.url,
        detectedAt: Date.now(),
      });
      return;
    }
    if (event.type === 'exit') {
      this.entries.delete(event.terminalId);
    }
  }
}
