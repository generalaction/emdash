import { autorun } from 'mobx';
import { describe, expect, it } from 'vitest';
import { Resource } from './resource';

describe('Resource', () => {
  it('queues event reloads that arrive during an in-flight load', async () => {
    let fetchCount = 0;
    let releaseFirst: (() => void) | undefined;
    let secondLoadComplete: (() => void) | undefined;
    let emitReload: (() => void) | undefined;
    const secondLoad = new Promise<void>((resolve) => {
      secondLoadComplete = resolve;
    });

    const resource = new Resource(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return 'stale';
      }
      secondLoadComplete?.();
      return 'fresh';
    }, [
      {
        kind: 'event',
        subscribe: (handler) => {
          emitReload = () => handler(undefined);
          return () => {};
        },
        onEvent: 'reload',
      },
    ]);

    resource.start();
    emitReload?.();
    releaseFirst?.();

    await secondLoad;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(fetchCount).toBe(2);
    expect(resource.data).toBe('fresh');
  });

  it('runs one fresh reload after an invalidation arrives during an in-flight load', async () => {
    let fetchCount = 0;
    let releaseFirst: (() => void) | undefined;
    let secondLoadComplete: (() => void) | undefined;
    const secondLoad = new Promise<void>((resolve) => {
      secondLoadComplete = resolve;
    });

    const resource = new Resource(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return 'stale';
      }
      secondLoadComplete?.();
      return 'fresh';
    }, []);

    const firstLoad = resource.load();
    resource.invalidate();
    releaseFirst?.();

    await firstLoad;
    await secondLoad;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(fetchCount).toBe(2);
    expect(resource.data).toBe('fresh');
  });

  it('keeps loading true between an in-flight load and its queued reload', async () => {
    let fetchCount = 0;
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;

    const resource = new Resource(async () => {
      fetchCount += 1;
      await new Promise<void>((resolve) => {
        if (fetchCount === 1) {
          releaseFirst = resolve;
        } else {
          releaseSecond = resolve;
        }
      });
      return fetchCount === 1 ? 'stale' : 'fresh';
    }, []);

    const loadingStates: boolean[] = [];
    const dispose = autorun(() => {
      loadingStates.push(resource.loading);
    });

    const firstLoad = resource.load();
    resource.invalidate();
    releaseFirst?.();
    await firstLoad;

    expect(fetchCount).toBe(2);
    expect(loadingStates).toEqual([false, true]);

    releaseSecond?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(resource.data).toBe('fresh');
    expect(loadingStates).toEqual([false, true, false]);
    dispose();
  });

  it('dedupes overlapping direct loads without queueing an extra reload', async () => {
    let fetchCount = 0;
    let releaseFirst: (() => void) | undefined;

    const resource = new Resource(async () => {
      fetchCount += 1;
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return 'loaded';
    }, []);

    const firstLoad = resource.load();
    const secondLoad = resource.load();
    releaseFirst?.();

    await Promise.all([firstLoad, secondLoad]);

    expect(fetchCount).toBe(1);
    expect(resource.data).toBe('loaded');
  });
});
