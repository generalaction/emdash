import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LiveModelClient } from '../model';
import { LiveBindingRegistry, stableStringify } from './registry';

const treeKeySchema = z.object({
  rootPath: z.string(),
  sessionId: z.string(),
});

const treeSchema = z.object({
  files: z.record(z.string(), z.string()),
});

const treeRef = {
  id: 'files.tree',
  keySchema: treeKeySchema,
  dataSchema: treeSchema,
};

describe('live binding registry', () => {
  it('uses stable key identity independent of object property order', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe(stableStringify({ a: 1, b: 2 }));
  });

  it('tracks live client bindings by ref and key', () => {
    const registry = new LiveBindingRegistry();
    const client = new LiveModelClient(treeSchema, vi.fn(), () => {});
    const key = { rootPath: '/repo', sessionId: 'a' };

    const unregister = registry.register(treeRef, key, client);

    expect(registry.find('files.tree', { sessionId: 'a', rootPath: '/repo' })).toBe(client);
    expect(registry.findByRef(treeRef, key)).toBe(client);

    unregister();

    expect(registry.findByRef(treeRef, key)).toBeUndefined();
  });
});
