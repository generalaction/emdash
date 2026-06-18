import { observable, runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rpc } from '@renderer/lib/ipc';
import { SnapshotRegistry } from './snapshot-registry';

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    viewState: {
      get: vi.fn(),
      save: vi.fn(),
    },
  },
}));

const saveViewState = vi.mocked(rpc.viewState.save);

describe('SnapshotRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveViewState.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists debounced snapshot changes without saveNow', async () => {
    const registry = new SnapshotRegistry();
    const state = observable.box({ order: ['a'] });
    const dispose = registry.register('sidebar', () => state.get());

    state.set({ order: ['b'] });
    await vi.advanceTimersByTimeAsync(1000);

    expect(saveViewState).toHaveBeenCalledOnce();
    expect(saveViewState).toHaveBeenCalledWith('sidebar', { order: ['b'] });

    dispose();
  });

  it('skips the debounced write after saveNow saves the same snapshot', async () => {
    const registry = new SnapshotRegistry();
    const state = observable.box({ order: ['a'] });
    const dispose = registry.register('sidebar', () => state.get());

    runInAction(() => {
      state.set({ order: ['b'] });
      registry.saveNow('sidebar', state.get());
    });

    expect(saveViewState).toHaveBeenCalledOnce();
    expect(saveViewState).toHaveBeenCalledWith('sidebar', { order: ['b'] });

    await vi.advanceTimersByTimeAsync(1000);

    expect(saveViewState).toHaveBeenCalledOnce();

    dispose();
  });
});
