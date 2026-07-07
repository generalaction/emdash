import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LiveModelClient, LiveModelServer } from '../model';
import { createLiveMutationsClient } from './client';
import type { LiveMutationCaller } from './client';
import { defineLiveMutations } from './define';
import { liveMutation } from './handler';
import { liveModelRef } from './model-ref';
import { LiveBindingRegistry, LiveModelRegistry, stableStringify } from './registry';
import { MutationResultCache } from './result-cache';

const treeKeySchema = z.object({
  rootPath: z.string(),
  sessionId: z.string(),
});

const treeSchema = z.object({
  files: z.record(z.string(), z.string()),
});

const renameInputSchema = z.object({
  rootPath: z.string(),
  from: z.string(),
  to: z.string(),
});

const treeRef = liveModelRef('files.tree', treeKeySchema, treeSchema);

type Tree = z.infer<typeof treeSchema>;

function makeTree(files: Record<string, string> = {}): Tree {
  return { files };
}

function renameFile(tree: Tree, from: string, to: string): void {
  const content = tree.files[from];
  if (content === undefined) return;
  delete tree.files[from];
  tree.files[to] = content;
}

describe('mutation registries', () => {
  it('uses stable key identity independent of object property order', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe(stableStringify({ a: 1, b: 2 }));
  });

  it('resolves exact and partial model instances', () => {
    const registry = new LiveModelRegistry();
    const first = new LiveModelServer<Tree>(makeTree(), 1000);
    const second = new LiveModelServer<Tree>(makeTree(), 2000);

    registry.register(treeRef, { rootPath: '/repo', sessionId: 'a' }, first);
    registry.register(treeRef, { rootPath: '/repo', sessionId: 'b' }, second);

    expect(registry.resolve(treeRef, { rootPath: '/repo', sessionId: 'a' })).toBe(first);
    expect(registry.instances(treeRef, { rootPath: '/repo' })).toHaveLength(2);
    expect(registry.instances(treeRef, { rootPath: '/other' })).toHaveLength(0);
  });
});

describe('liveMutation', () => {
  it('captures cursors for every touched model instance', async () => {
    const registry = new LiveModelRegistry();
    const first = new LiveModelServer<Tree>(makeTree({ 'old.ts': 'a' }), 1000);
    const second = new LiveModelServer<Tree>(makeTree({ 'old.ts': 'b' }), 2000);
    registry.register(treeRef, { rootPath: '/repo', sessionId: 'a' }, first);
    registry.register(treeRef, { rootPath: '/repo', sessionId: 'b' }, second);

    const rename = liveMutation(
      registry,
      (ctx, input: z.infer<typeof renameInputSchema> & { mutationId?: string }) => {
        ctx.produceAll(treeRef, { rootPath: input.rootPath }, (draft) => {
          renameFile(draft, input.from, input.to);
        });
        return ok();
      }
    );

    const result = await rename({
      rootPath: '/repo',
      from: 'old.ts',
      to: 'new.ts',
      mutationId: 'm1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cursors).toHaveLength(2);
      expect(result.data.cursors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            model: 'files.tree',
            key: { rootPath: '/repo', sessionId: 'a' },
            cursor: { generation: 1000, sequence: 1 },
          }),
          expect.objectContaining({
            model: 'files.tree',
            key: { rootPath: '/repo', sessionId: 'b' },
            cursor: { generation: 2000, sequence: 1 },
          }),
        ])
      );
    }
    expect(first.snapshot().data.files).toEqual({ 'new.ts': 'a' });
    expect(second.snapshot().data.files).toEqual({ 'new.ts': 'b' });
  });

  it('returns handler rejection without cursors', async () => {
    const registry = new LiveModelRegistry();
    const rename = liveMutation(registry, () => err('denied'));

    await expect(rename({ mutationId: 'm1' })).resolves.toEqual({
      success: false,
      error: 'denied',
    });
  });
});

describe('MutationResultCache', () => {
  it('returns settled results for duplicate mutation IDs', async () => {
    const handler = vi.fn(async () => ok({ data: 'done', cursors: [] }));
    const cache = new MutationResultCache();

    const first = await cache.run('m1', handler);
    const second = await cache.run('m1', handler);

    expect(first).toEqual(second);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('shares in-flight executions for concurrent duplicate mutation IDs', async () => {
    const gate = deferred<ReturnType<typeof ok<{ data: string; cursors: [] }>>>();
    const handler = vi.fn(async () => gate.promise);
    const cache = new MutationResultCache();

    const first = cache.run('m1', handler);
    const second = cache.run('m1', handler);
    gate.resolve(ok({ data: 'done', cursors: [] }));

    await expect(Promise.all([first, second])).resolves.toEqual([
      ok({ data: 'done', cursors: [] }),
      ok({ data: 'done', cursors: [] }),
    ]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not cache thrown errors', async () => {
    const handler = vi
      .fn<() => Promise<ReturnType<typeof ok<{ data: string; cursors: [] }>>>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(ok({ data: 'done', cursors: [] }));
    const cache = new MutationResultCache();

    await expect(cache.run('m1', handler)).rejects.toThrow('boom');
    await expect(cache.run('m1', handler)).resolves.toEqual(ok({ data: 'done', cursors: [] }));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('evicts entries after ttl', async () => {
    let now = 0;
    const handler = vi.fn(async () => ok({ data: 'done', cursors: [] }));
    const cache = new MutationResultCache({ ttlMs: 10, now: () => now });

    await cache.run('m1', handler);
    now = 11;
    await cache.run('m1', handler);

    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('createLiveMutationsClient', () => {
  it('injects mutation IDs and settles against returned cursors', async () => {
    const defs = defineLiveMutations({
      rename: {
        input: renameInputSchema,
        error: z.string(),
        data: z.object({ renamed: z.boolean() }),
      },
    });
    const serverRegistry = new LiveModelRegistry();
    const bindingRegistry = new LiveBindingRegistry();
    const server = new LiveModelServer<Tree>(makeTree({ 'old.ts': 'content' }), 1000);
    const refetchSnapshot = vi.fn(async () => server.snapshot());
    const liveClient = new LiveModelClient<Tree>(treeSchema, refetchSnapshot, () => {});

    serverRegistry.register(treeRef, { rootPath: '/repo', sessionId: 'a' }, server);
    bindingRegistry.register(treeRef, { rootPath: '/repo', sessionId: 'a' }, liveClient);
    liveClient.seed(server.snapshot());
    server.subscribe((update) => liveClient.applyUpdate(update));

    const rename = liveMutation<z.infer<typeof renameInputSchema>, { renamed: boolean }, string>(
      serverRegistry,
      (ctx, input) => {
        expect(input.mutationId).toMatch(/^mutation_/);
        ctx.produce(treeRef, { rootPath: input.rootPath, sessionId: 'a' }, (draft) => {
          renameFile(draft, input.from, input.to);
        });
        return ok({ renamed: true });
      }
    );
    const caller: LiveMutationCaller<typeof defs> = async (name, input) => {
      expect(name).toBe('rename');
      return rename(input);
    };
    const client = createLiveMutationsClient(defs, caller, bindingRegistry);

    const invocation = await client.rename({
      rootPath: '/repo',
      from: 'old.ts',
      to: 'new.ts',
    });

    expect(invocation.result.success).toBe(true);
    if (invocation.result.success) {
      expect(invocation.result.data.data).toEqual({ renamed: true });
      expect(invocation.result.data.cursors).toHaveLength(1);
    }
    await expect(invocation.settled).resolves.toBeUndefined();
    expect(liveClient.getSnapshot()?.files).toEqual({ 'new.ts': 'content' });
  });

  it('settles immediately for unmatched local bindings', async () => {
    const defs = defineLiveMutations({
      rename: {
        input: renameInputSchema,
        error: z.string(),
        data: z.undefined(),
      },
    });
    const bindingRegistry = new LiveBindingRegistry();
    const caller: LiveMutationCaller<typeof defs> = async (_name, input) =>
      ok({
        data: undefined,
        cursors: [
          {
            model: 'files.tree',
            key: { rootPath: input.rootPath, sessionId: 'missing' },
            cursor: { generation: 1000, sequence: 1 },
          },
        ],
      });
    const client = createLiveMutationsClient(defs, caller, bindingRegistry);

    const invocation = await client.rename({
      rootPath: '/repo',
      from: 'old.ts',
      to: 'new.ts',
    });

    await expect(invocation.settled).resolves.toBeUndefined();
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
