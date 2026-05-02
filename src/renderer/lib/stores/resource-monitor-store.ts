import { computed, makeObservable, observable, runInAction } from 'mobx';
import { resourceSnapshotChannel } from '@shared/events/resourceEvents';
import type { ResourcePtyEntry, ResourceSnapshot } from '@shared/resource-monitor';
import { events, rpc } from '@renderer/lib/ipc';

export class ResourceMonitorStore {
  snapshot: ResourceSnapshot | null = null;
  private started = false;

  constructor() {
    makeObservable(this, {
      snapshot: observable,
      totalCpuPercent: computed,
      totalMemoryBytes: computed,
      appMemoryBytes: computed,
      agentMemoryBytes: computed,
      entryCount: computed,
    });
  }

  /**
   * Total CPU usage as a fraction of the whole machine (0 - 100+%).
   * pidusage reports each PID as % of one core; divide by core count to
   * normalize against total CPU capacity.
   */
  get totalCpuPercent(): number {
    const snap = this.snapshot;
    if (!snap || snap.cpuCount === 0) return 0;
    let sum = snap.app?.cpuPercent ?? 0;
    for (const e of snap.entries) sum += e.cpu;
    return sum / snap.cpuCount;
  }

  get totalMemoryBytes(): number {
    return this.appMemoryBytes + this.agentMemoryBytes;
  }

  get appMemoryBytes(): number {
    return this.snapshot?.app?.memoryBytes ?? 0;
  }

  get agentMemoryBytes(): number {
    if (!this.snapshot) return 0;
    let sum = 0;
    for (const e of this.snapshot.entries) sum += e.memory;
    return sum;
  }

  get entryCount(): number {
    return this.snapshot?.entries.length ?? 0;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    events.on(resourceSnapshotChannel, (snap) => {
      runInAction(() => {
        this.snapshot = snap;
      });
    });
    rpc.resourceMonitor
      .getSnapshot()
      .then((res) => {
        if (!res?.success) return;
        runInAction(() => {
          this.snapshot = res.data;
        });
      })
      .catch(() => {});
  }

  /** Normalized CPU% (relative to all cores) for a single entry. */
  normalizedCpu(entry: ResourcePtyEntry): number {
    if (!this.snapshot || this.snapshot.cpuCount === 0) return 0;
    return entry.cpu / this.snapshot.cpuCount;
  }
}
