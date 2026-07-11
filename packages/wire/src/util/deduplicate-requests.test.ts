import { describe, expect, it, vi } from 'vitest';
import { deferred } from '../testing';
import { compose } from './compose';
import { deduplicate, deduplicateRequests } from './deduplicate-requests';

describe('deduplicateRequests', () => {
  it('shares one in-flight execution for identical inputs', async () => {
    const gate = deferred<number>();
    const handler = vi.fn(async () => gate.promise);
    const deduped = deduplicateRequests(handler);

    const first = deduped({ id: 'same' });
    const second = deduped({ id: 'same' });

    expect(handler).toHaveBeenCalledTimes(1);
    gate.resolve(42);
    await expect(first).resolves.toBe(42);
    await expect(second).resolves.toBe(42);
  });

  it('uses stable JSON identity for object keys', async () => {
    const handler = vi.fn(async () => 'ok');
    const deduped = deduplicateRequests(handler);

    const first = deduped({ a: 1, b: 2 });
    const second = deduped({ b: 2, a: 1 });

    await expect(first).resolves.toBe('ok');
    await expect(second).resolves.toBe('ok');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not deduplicate different inputs', async () => {
    const handler = vi.fn(async (input: { id: string }) => input.id);
    const deduped = deduplicateRequests(handler);

    await expect(Promise.all([deduped({ id: 'a' }), deduped({ id: 'b' })])).resolves.toEqual([
      'a',
      'b',
    ]);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('does not cache rejections', async () => {
    const handler = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');
    const deduped = deduplicateRequests(handler);

    await expect(deduped({ id: 'same' })).rejects.toThrow('boom');
    await expect(deduped({ id: 'same' })).resolves.toBe('ok');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('supports custom keys', async () => {
    const handler = vi.fn(async (input: { id: string; version: number }) => input.id);
    const deduped = deduplicateRequests(handler, { key: (input) => input.id });

    await expect(
      Promise.all([deduped({ id: 'same', version: 1 }), deduped({ id: 'same', version: 2 })])
    ).resolves.toEqual(['same', 'same']);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('re-executes after a completed in-flight request clears', async () => {
    const handler = vi.fn(async (input: { id: string }) => input.id);
    const deduped = deduplicateRequests(handler);

    await expect(deduped({ id: 'same' })).resolves.toBe('same');
    await expect(deduped({ id: 'same' })).resolves.toBe('same');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('can be used as compose middleware', async () => {
    const gate = deferred<string>();
    const spy = vi.fn();
    const handler = async (input: { id: string }, _meta: { signal?: AbortSignal }) => {
      spy();
      await gate.promise;
      return input.id;
    };
    const deduped = compose(handler, [deduplicate()]);

    const first = deduped({ id: 'same' }, {});
    const second = deduped({ id: 'same' }, {});
    expect(spy).toHaveBeenCalledTimes(1);

    gate.resolve('done');
    await expect(Promise.all([first, second])).resolves.toEqual(['same', 'same']);
  });

  it('lets one waiting caller cancel without aborting shared work', async () => {
    const gate = deferred<string>();
    let sharedSignalAborted = false;
    const handler = async (_input: { id: string }, meta: { signal?: AbortSignal }) => {
      meta.signal?.addEventListener('abort', () => {
        sharedSignalAborted = true;
      });
      return gate.promise;
    };
    const deduped = compose(handler, [deduplicate()]);
    const abort = new AbortController();

    const first = deduped({ id: 'same' }, { signal: abort.signal });
    const second = deduped({ id: 'same' }, {});
    abort.abort(new Error('caller cancelled'));

    await expect(first).rejects.toThrow('caller cancelled');
    expect(sharedSignalAborted).toBe(false);
    gate.resolve('ok');
    await expect(second).resolves.toBe('ok');
  });

  it('can abort shared work when the final waiter leaves', async () => {
    let sharedSignalAborted = false;
    const handler = async (_input: { id: string }, meta: { signal?: AbortSignal }) => {
      meta.signal?.addEventListener('abort', () => {
        sharedSignalAborted = true;
      });
      await new Promise<never>(() => {});
    };
    const deduped = compose(handler, [deduplicate({ cancelWhenUnused: true })]);
    const abort = new AbortController();

    const pending = deduped({ id: 'same' }, { signal: abort.signal });
    abort.abort(new Error('gone'));

    await expect(pending).rejects.toThrow('gone');
    expect(sharedSignalAborted).toBe(true);
  });
});
