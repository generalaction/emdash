/** @vitest-environment jsdom */
import { deferred } from '@emdash/shared/testing';
import { createEventStreamHost } from '@emdash/wire/live';
import { createInProcessWire } from '@emdash/wire/rpc';
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateCard } from '@core/features/settings/browser/components/UpdateCard';
import type { UpdatesClient } from '@core/features/updates/api/browser/client';
import {
  updatesContract,
  type DesktopUpdateEvent,
  type DesktopUpdateState,
  type UpdateStateResult,
} from '@core/features/updates/api/contract';
import { UpdateStore } from '@core/features/updates/browser/update-store';

const mocks = vi.hoisted(() => ({ client: vi.fn<() => Promise<UpdatesClient>>(), store: vi.fn() }));
vi.mock('@core/features/updates/api/browser/client', () => ({ getUpdatesClient: mocks.client }));
vi.mock('@core/features/updates/contributions/app-stores', () => ({ getUpdateStore: mocks.store }));
vi.mock('@core/primitives/desktop-host/browser/host-client', () => ({
  getHostClient: async () => ({ events: { subscribe: async () => {} } }),
}));
vi.mock('@core/primitives/navigation/browser/navigation-selectors', () => ({
  getNavigation: vi.fn(),
}));
vi.mock('@core/features/settings/contributions/views', () => ({ settingsViewDef: vi.fn() }));
vi.mock('@emdash/ui/react/primitives', () => ({ toast: vi.fn() }));

let snapshot: DesktopUpdateState;
let store: UpdateStore;
const events = createEventStreamHost(updatesContract.events);
const check = vi.fn(async () => ({ success: true as const, result: {} }));
const download = vi.fn<() => Promise<UpdateStateResult>>();
const getState = vi.fn<() => Promise<UpdateStateResult>>();
let wire: ReturnType<typeof createInProcessWire<typeof updatesContract>>;

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}
function emit(event: DesktopUpdateEvent) {
  events.emit(undefined, event);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  snapshot = { status: 'available', currentVersion: '1.2.5', availableVersion: '1.2.6' };
  getState.mockImplementation(async () => ({ success: true, data: { ...snapshot } }));
  wire = createInProcessWire(updatesContract, { check, download, getState, events });
  mocks.client.mockResolvedValue(wire.client);
  store = new UpdateStore();
  mocks.store.mockReturnValue(store);
  store.start();
  await flush();
});
afterEach(async () => {
  cleanup();
  await wire.dispose();
  vi.useRealTimers();
});

describe('update state across requests and card lifetimes', () => {
  it('keeps progress on an externally started download and after reopening the card', async () => {
    snapshot.status = 'downloading';
    download.mockResolvedValue({ success: true, data: { ...snapshot } });
    await act(async () => {
      await store.download();
    });
    let view = render(createElement(UpdateCard));
    expect((view.getByRole('button', { name: 'Downloading…' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    view.unmount();
    view = render(createElement(UpdateCard));
    await act(async () => {
      emit({ type: 'progress', percent: 42, transferred: 42, total: 100, bytesPerSecond: 1 });
    });
    await flush();
    expect(view.getByRole('button', { name: 'Downloading… 42%' })).toBeTruthy();
    await act(async () => {
      emit({ type: 'downloaded', version: '1.2.6' });
    });
    await flush();
    expect(view.getByRole('button', { name: 'Restart' })).toBeTruthy();
  });

  it('coalesces repeated clicks while waiting for acceptance', async () => {
    const ack = deferred<UpdateStateResult>();
    download.mockReturnValue(ack.promise);
    const first = store.download();
    const second = store.download();
    await flush();
    expect(store.downloadRequested).toBe(true);
    expect(download).toHaveBeenCalledTimes(1);
    snapshot.status = 'downloading';
    ack.resolve({ success: true, data: { ...snapshot } });
    await act(async () => {
      await Promise.all([first, second]);
    });
    expect(store.state.status).toBe('downloading');
    expect(store.downloadRequested).toBe(false);
  });

  it('reconciles a timed-out acknowledgement without failing an active transfer', async () => {
    const ack = deferred<UpdateStateResult>();
    download.mockImplementation(() => {
      snapshot.status = 'downloading';
      return ack.promise;
    });
    const request = store.download();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
      await request;
    });
    expect(store.state.status).toBe('downloading');
    expect(store.downloadRequested).toBe(false);
    const view = render(createElement(UpdateCard));
    expect(view.getByRole('button', { name: 'Downloading…' })).toBeTruthy();
    expect(view.queryByRole('alert')).toBeNull();
    ack.resolve({ success: true, data: { ...snapshot } });
  });

  it('does not overwrite completion with a delayed download acknowledgement', async () => {
    const ack = deferred<UpdateStateResult>();
    download.mockReturnValue(ack.promise);
    const request = store.download();
    await flush();
    emit({ type: 'downloaded', version: '1.2.6' });
    await flush();
    ack.resolve({ success: true, data: { ...snapshot, status: 'downloading' } });
    await act(async () => {
      await request;
    });
    expect(store.state.status).toBe('downloaded');
  });

  it('keeps app identity when progress arrives during initial snapshot hydration', async () => {
    const hydration = deferred<UpdateStateResult>();
    getState.mockReturnValueOnce(hydration.promise);
    const reopened = new UpdateStore();
    reopened.start();
    await flush();
    emit({ type: 'progress', percent: 42, transferred: 42, total: 100, bytesPerSecond: 1 });
    await flush();
    hydration.resolve({ success: true, data: { ...snapshot, status: 'downloading' } });
    await flush();
    expect(reopened.currentVersion).toBe('1.2.5');
    expect(reopened.availableVersion).toBe('1.2.6');
    expect(reopened.state).toMatchObject({ status: 'downloading', progress: { percent: 42 } });
  });

  it('does not check again when a reopened renderer hydrates an active transfer', async () => {
    snapshot.status = 'downloading';
    const reopened = new UpdateStore();
    check.mockClear();
    reopened.start();
    await flush();
    expect(reopened.state.status).toBe('downloading');
    expect(check).not.toHaveBeenCalled();
  });
});
