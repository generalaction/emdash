import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resourceSnapshotChannel } from '@shared/events/resourceEvents';
import type { ResourceSnapshot } from '@shared/resource-monitor';

const setOpen = vi.fn();
let snapshotHandler: ((snap: ResourceSnapshot) => void) | null = null;
const offSnapshot = vi.fn(() => {
  snapshotHandler = null;
});

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    resourceMonitor: {
      setOpen,
      getSnapshot: vi.fn(),
    },
  },
  events: {
    on: vi.fn((channel: typeof resourceSnapshotChannel, cb: (snap: ResourceSnapshot) => void) => {
      if (channel === resourceSnapshotChannel) snapshotHandler = cb;
      return offSnapshot;
    }),
  },
}));

function snapshot(timestamp: number): ResourceSnapshot {
  return {
    timestamp,
    cpuCount: 1,
    totalMemoryBytes: 0,
    app: { memoryBytes: 0, cpuPercent: 0 },
    appProcesses: [],
    entries: [],
  };
}

describe('ResourceMonitorStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotHandler = null;
  });

  it('opens once and disposes idempotently with the same subscription', async () => {
    const { ResourceMonitorStore } = await import('./resource-monitor-store');
    const { rpc } = await import('@renderer/lib/ipc');
    vi.mocked(rpc.resourceMonitor.getSnapshot).mockResolvedValue({ success: true, data: null });

    const store = new ResourceMonitorStore();
    store.start();
    store.start();
    store.dispose();
    store.dispose();

    expect(setOpen).toHaveBeenCalledTimes(2);
    const clientId = setOpen.mock.calls[0]?.[0];
    const subscriptionId = setOpen.mock.calls[0]?.[1];
    expect(setOpen).toHaveBeenNthCalledWith(1, clientId, subscriptionId, true, 1);
    expect(setOpen).toHaveBeenNthCalledWith(2, clientId, subscriptionId, false, 2);
  });

  it('does not let an older fetched snapshot overwrite a newer event snapshot', async () => {
    const { ResourceMonitorStore } = await import('./resource-monitor-store');
    const { rpc } = await import('@renderer/lib/ipc');
    vi.mocked(rpc.resourceMonitor.getSnapshot).mockResolvedValue({
      success: true,
      data: snapshot(1),
    });

    const store = new ResourceMonitorStore();
    store.start();
    snapshotHandler?.(snapshot(2));
    await Promise.resolve();

    expect(store.snapshot?.timestamp).toBe(2);
  });
});
