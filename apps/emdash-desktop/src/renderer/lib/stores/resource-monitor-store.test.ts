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

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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

  it('tracks initial loading until the first fetch resolves', async () => {
    const { ResourceMonitorStore } = await import('./resource-monitor-store');
    const { rpc } = await import('@renderer/lib/ipc');
    vi.mocked(rpc.resourceMonitor.getSnapshot).mockResolvedValue({ success: true, data: null });

    const store = new ResourceMonitorStore();
    store.start();

    expect(store.isLoadingInitialSnapshot).toBe(true);
    await flushPromises();

    expect(store.snapshot).toBeNull();
    expect(store.isLoadingInitialSnapshot).toBe(false);
  });

  it('stops initial loading when an event snapshot arrives first', async () => {
    const { ResourceMonitorStore } = await import('./resource-monitor-store');
    const { rpc } = await import('@renderer/lib/ipc');
    vi.mocked(rpc.resourceMonitor.getSnapshot).mockResolvedValue({
      success: true,
      data: snapshot(1),
    });

    const store = new ResourceMonitorStore();
    store.start();
    snapshotHandler?.(snapshot(2));
    await flushPromises();

    expect(store.snapshot?.timestamp).toBe(2);
    expect(store.isLoadingInitialSnapshot).toBe(false);
  });

  it('does not let a null fetched snapshot clear a newer event snapshot', async () => {
    const { ResourceMonitorStore } = await import('./resource-monitor-store');
    const { rpc } = await import('@renderer/lib/ipc');
    vi.mocked(rpc.resourceMonitor.getSnapshot).mockResolvedValue({ success: true, data: null });

    const store = new ResourceMonitorStore();
    store.start();
    snapshotHandler?.(snapshot(2));
    await flushPromises();

    expect(store.snapshot?.timestamp).toBe(2);
    expect(store.isLoadingInitialSnapshot).toBe(false);
  });

  it('ignores stale initial fetches from a previous open', async () => {
    const { ResourceMonitorStore } = await import('./resource-monitor-store');
    const { rpc } = await import('@renderer/lib/ipc');
    let resolveFirst!: (value: { success: true; data: ResourceSnapshot | null }) => void;
    let resolveSecond!: (value: { success: true; data: ResourceSnapshot | null }) => void;
    vi.mocked(rpc.resourceMonitor.getSnapshot)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        })
      );

    const store = new ResourceMonitorStore();
    store.start();
    store.dispose();
    store.start();

    resolveFirst({ success: true, data: snapshot(1) });
    await flushPromises();

    expect(store.snapshot).toBeNull();
    expect(store.isLoadingInitialSnapshot).toBe(true);

    resolveSecond({ success: true, data: null });
    await flushPromises();

    expect(store.snapshot).toBeNull();
    expect(store.isLoadingInitialSnapshot).toBe(false);
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
    await flushPromises();

    expect(store.snapshot?.timestamp).toBe(2);
  });

  it('does not let refresh overwrite a newer snapshot', async () => {
    const { ResourceMonitorStore } = await import('./resource-monitor-store');
    const { rpc } = await import('@renderer/lib/ipc');
    let resolveSnapshot!: (value: { success: true; data: ResourceSnapshot }) => void;
    vi.mocked(rpc.resourceMonitor.getSnapshot).mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      })
    );

    const store = new ResourceMonitorStore();
    const refreshing = store.refresh();
    store.snapshot = snapshot(2);
    resolveSnapshot({ success: true, data: snapshot(1) });
    await refreshing;

    expect(store.snapshot?.timestamp).toBe(2);
  });
});
